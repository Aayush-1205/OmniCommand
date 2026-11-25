use crate::models::{
    EngineInfo, EngineType, ExecutionFinishedEvent, ExecutionRecord, ExecutionStatus,
    OutputBatchEvent, OutputChunkItem,
};
use crate::security::{validate_command_guardrails, validate_local_path};
use crate::storage::AtomicJsonStore;
use chrono::Utc;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const IPC_BATCH_INTERVAL_MS: u64 = 40;
const IPC_BATCH_MAX_BYTES: usize = 16 * 1024;

#[cfg(target_os = "windows")]
struct WindowsJobHandle(windows::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsJobHandle {}
#[cfg(target_os = "windows")]
unsafe impl Sync for WindowsJobHandle {}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}

struct RunningProcess {
    pid: Option<u32>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
    #[cfg(target_os = "windows")]
    job_handle: Option<WindowsJobHandle>,
}

#[derive(Clone)]
pub struct ProcessRunner {
    running: Arc<Mutex<HashMap<String, RunningProcess>>>,
    store: AtomicJsonStore,
}

impl ProcessRunner {
    pub fn new(store: AtomicJsonStore) -> Self {
        Self {
            running: Arc::new(Mutex::new(HashMap::new())),
            store,
        }
    }

    pub async fn spawn_command(
        &self,
        app: AppHandle,
        engine: EngineType,
        command_text: String,
        base_path: String,
        command_id: Option<String>,
        project_id: Option<String>,
        triggered_by: String,
        timeout_sec: u64,
    ) -> Result<ExecutionRecord, String> {
        let guardrail = validate_command_guardrails(&command_text);
        if guardrail.blocked {
            return Err(guardrail
                .reason
                .unwrap_or_else(|| "Blocked by Rust security guardrail.".to_string()));
        }

        let path_check = validate_local_path(&base_path, true);
        if !path_check.valid {
            return Err(path_check
                .blocked_reason
                .unwrap_or_else(|| "Invalid execution directory.".to_string()));
        }
        let canonical_dir = path_check.canonical_path.unwrap_or(base_path);

        let exec_id = Uuid::new_v4().to_string();
        let started_at = Utc::now().to_rfc3339();
        let log_path = self.store.log_file_path(&exec_id);

        let record = ExecutionRecord {
            id: exec_id.clone(),
            command_id,
            project_id,
            engine: engine.clone(),
            command_text: command_text.clone(),
            base_path: canonical_dir.clone(),
            status: ExecutionStatus::Running,
            exit_code: None,
            duration_ms: 0,
            triggered_by,
            log_file_path: log_path.to_string_lossy().to_string(),
            started_at,
        };
        self.store.append_or_update_execution(record.clone()).await?;

        let mut cmd = build_engine_command(&engine, &command_text, &canonical_dir);
        cmd.current_dir(&canonical_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn {:?} process: {e}", engine))?;

        let pid = child.id();

        #[cfg(target_os = "windows")]
        let job_handle = pid.and_then(|child_pid| attach_to_kill_on_close_job(child_pid).ok());

        let stdin = Arc::new(Mutex::new(child.stdin.take()));
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();

        {
            let mut map = self.running.lock().await;
            map.insert(
                exec_id.clone(),
                RunningProcess {
                    pid,
                    stdin,
                    cancel_tx: Some(cancel_tx),
                    #[cfg(target_os = "windows")]
                    job_handle,
                },
            );
        }

        let (chunk_tx, mut chunk_rx) = mpsc::unbounded_channel::<OutputChunkItem>();

        if let Some(out) = stdout {
            let tx = chunk_tx.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(out).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let _ = tx.send(OutputChunkItem {
                        stream: "stdout".to_string(),
                        text: line,
                        timestamp: Utc::now().to_rfc3339(),
                    });
                }
            });
        }

        if let Some(err) = stderr {
            let tx = chunk_tx.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(err).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    let _ = tx.send(OutputChunkItem {
                        stream: "stderr".to_string(),
                        text: line,
                        timestamp: Utc::now().to_rfc3339(),
                    });
                }
            });
        }
        drop(chunk_tx);

        // ~40ms IPC batching + raw UTF-8 disk log writer
        let batch_app = app.clone();
        let batch_exec_id = exec_id.clone();
        let batch_log_path = log_path.clone();
        let batch_task = tokio::spawn(async move {
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&batch_log_path)
                .ok();
            let mut pending: Vec<OutputChunkItem> = Vec::new();
            let mut pending_bytes: usize = 0;
            let mut ticker = tokio::time::interval(Duration::from_millis(IPC_BATCH_INTERVAL_MS));

            loop {
                tokio::select! {
                    maybe_chunk = chunk_rx.recv() => {
                        match maybe_chunk {
                            Some(chunk) => {
                                if let Some(ref mut f) = log_file {
                                    let _ = writeln!(f, "{}", chunk.text);
                                }
                                pending_bytes += chunk.text.len();
                                pending.push(chunk);
                                if pending_bytes >= IPC_BATCH_MAX_BYTES {
                                    let _ = batch_app.emit("execution:output", OutputBatchEvent {
                                        execution_id: batch_exec_id.clone(),
                                        chunks: std::mem::take(&mut pending),
                                    });
                                    pending_bytes = 0;
                                }
                            }
                            None => {
                                if !pending.is_empty() {
                                    let _ = batch_app.emit("execution:output", OutputBatchEvent {
                                        execution_id: batch_exec_id.clone(),
                                        chunks: std::mem::take(&mut pending),
                                    });
                                }
                                break;
                            }
                        }
                    }
                    _ = ticker.tick() => {
                        if !pending.is_empty() {
                            let _ = batch_app.emit("execution:output", OutputBatchEvent {
                                execution_id: batch_exec_id.clone(),
                                chunks: std::mem::take(&mut pending),
                            });
                            pending_bytes = 0;
                        }
                    }
                }
            }
        });

        let running_map = self.running.clone();
        let store = self.store.clone();
        let mut final_record = record.clone();

        tokio::spawn(async move {
            let start = Instant::now();
            let timeout = Duration::from_secs(timeout_sec.max(5));

            let (status, exit_code) = tokio::select! {
                wait_res = child.wait() => {
                    match wait_res {
                        Ok(exit) => {
                            let code = exit.code();
                            if code == Some(0) {
                                (ExecutionStatus::Completed, code)
                            } else {
                                (ExecutionStatus::Failed, code)
                            }
                        }
                        Err(_) => (ExecutionStatus::Failed, Some(-1)),
                    }
                }
                _ = &mut cancel_rx => {
                    terminate_process_tree(pid).await;
                    let _ = child.kill().await;
                    (ExecutionStatus::Killed, Some(-1))
                }
                _ = tokio::time::sleep(timeout) => {
                    terminate_process_tree(pid).await;
                    let _ = child.kill().await;
                    (ExecutionStatus::Killed, Some(124))
                }
            };

            let _ = batch_task.await;
            let duration_ms = start.elapsed().as_millis() as u64;

            // Dropping RunningProcess also closes its Windows Job Object handle
            // (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) ensuring zero orphaned children.
            {
                let mut map = running_map.lock().await;
                map.remove(&final_record.id);
            }

            final_record.status = status.clone();
            final_record.exit_code = exit_code;
            final_record.duration_ms = duration_ms;
            let _ = store.append_or_update_execution(final_record.clone()).await;

            let _ = app.emit(
                "execution:finished",
                ExecutionFinishedEvent {
                    execution_id: final_record.id,
                    status,
                    exit_code,
                    duration_ms,
                },
            );
        });

        Ok(record)
    }

    pub async fn stop_execution(&self, execution_id: &str) -> Result<bool, String> {
        let proc_entry = {
            let mut map = self.running.lock().await;
            map.remove(execution_id)
        };

        if let Some(mut entry) = proc_entry {
            if let Some(tx) = entry.cancel_tx.take() {
                let _ = tx.send(());
            }
            // Explicit taskkill /F /T fallback plus Job Object drop on Windows
            terminate_process_tree(entry.pid).await;
            drop(entry);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn write_stdin(&self, execution_id: &str, input: &str) -> Result<(), String> {
        let stdin_arc = {
            let map = self.running.lock().await;
            map.get(execution_id).map(|p| p.stdin.clone())
        }
        .ok_or_else(|| "Process is no longer running.".to_string())?;

        let mut guard = stdin_arc.lock().await;
        if let Some(ref mut writer) = *guard {
            writer
                .write_all(format!("{input}\n").as_bytes())
                .await
                .map_err(|e| format!("Failed writing to stdin: {e}"))?;
            writer
                .flush()
                .await
                .map_err(|e| format!("Failed flushing stdin: {e}"))?;
            Ok(())
        } else {
            Err("Standard input is closed.".to_string())
        }
    }
}

fn build_engine_command(engine: &EngineType, command_text: &str, base_path: &str) -> Command {
    match engine {
        EngineType::Cmd => {
            let mut cmd = Command::new("cmd.exe");
            cmd.args(["/d", "/s", "/c", &format!("chcp 65001>nul & {command_text}")]);
            cmd
        }
        EngineType::Powershell => {
            let shell = if which_exists("pwsh.exe") {
                "pwsh.exe"
            } else {
                "powershell.exe"
            };
            let mut cmd = Command::new(shell);
            cmd.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!(
                    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8; {command_text}"
                ),
            ]);
            cmd
        }
        EngineType::Python => {
            let mut cmd = Command::new("python.exe");
            cmd.env("PYTHONIOENCODING", "utf-8");
            cmd.args(["-u", "-c", command_text]);
            cmd
        }
        EngineType::Linux => {
            if which_exists("wsl.exe") {
                let mut cmd = Command::new("wsl.exe");
                cmd.args(["--cd", base_path, "--", "bash", "-lc", command_text]);
                cmd
            } else {
                let mut cmd = Command::new("bash.exe");
                cmd.args(["-lc", command_text]);
                cmd
            }
        }
        EngineType::Git => {
            let mut cmd = Command::new("cmd.exe");
            cmd.env("GIT_TERMINAL_PROMPT", "0");
            let trimmed = command_text.trim();
            let normalized = if trimmed.to_lowercase().starts_with("git ") || trimmed.eq_ignore_ascii_case("git") {
                trimmed.to_string()
            } else {
                format!("git {trimmed}")
            };
            cmd.args(["/d", "/s", "/c", &format!("chcp 65001>nul & {normalized}")]);
            cmd
        }
    }
}

#[cfg(target_os = "windows")]
fn attach_to_kill_on_close_job(pid: u32) -> Result<WindowsJobHandle, String> {
    use std::mem::size_of;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    unsafe {
        let job = CreateJobObjectW(None, None).map_err(|e| format!("CreateJobObjectW failed: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| {
            let _ = CloseHandle(job);
            format!("SetInformationJobObject failed: {e}")
        })?;

        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)
            .map_err(|e| {
                let _ = CloseHandle(job);
                format!("OpenProcess failed: {e}")
            })?;

        let assigned = AssignProcessToJobObject(job, process);
        let _ = CloseHandle(process);
        if let Err(e) = assigned {
            let _ = CloseHandle(job);
            return Err(format!("AssignProcessToJobObject failed: {e}"));
        }

        Ok(WindowsJobHandle(job))
    }
}

async fn terminate_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut kill_cmd = Command::new("taskkill.exe");
        kill_cmd
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = kill_cmd.status().await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .await;
    }
}

fn which_exists(binary: &str) -> bool {
    std::process::Command::new("where")
        .arg(binary)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn probe_available_engines() -> Vec<EngineInfo> {
    let specs = [
        (EngineType::Cmd, "CMD", "cmd.exe"),
        (EngineType::Powershell, "PowerShell", "pwsh.exe"),
        (EngineType::Python, "Python", "python.exe"),
        (EngineType::Linux, "Linux (WSL / Git Bash)", "wsl.exe"),
        (EngineType::Git, "Git", "git.exe"),
    ];

    specs
        .into_iter()
        .map(|(engine, label, bin)| {
            let available = if matches!(engine, EngineType::Powershell) {
                which_exists("pwsh.exe") || which_exists("powershell.exe")
            } else if matches!(engine, EngineType::Linux) {
                which_exists("wsl.exe") || which_exists("bash.exe")
            } else {
                which_exists(bin)
            };

            EngineInfo {
                engine,
                label: label.to_string(),
                available,
                binary_path: if available { Some(bin.to_string()) } else { None },
                version: None,
            }
        })
        .collect()
}
