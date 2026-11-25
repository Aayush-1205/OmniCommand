use crate::models::{AppSettings, CommandItem, ExecutionRecord, Project, SessionState};
use crate::security::decrypt_secret_dpapi;
use serde::{de::DeserializeOwned, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

const MAX_EXECUTIONS: usize = 500;
const MAX_BACKUPS_PER_FILE: usize = 5;

#[derive(Clone)]
pub struct AtomicJsonStore {
    root_dir: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

impl AtomicJsonStore {
    pub fn new() -> Result<Self, String> {
        let base = dirs::data_local_dir()
            .ok_or_else(|| "Unable to resolve %LocalAppData% directory".to_string())?;
        let root_dir = base.join("OmniCommand");
        fs::create_dir_all(root_dir.join("logs"))
            .map_err(|e| format!("Failed to create logs directory: {e}"))?;
        fs::create_dir_all(root_dir.join("backups"))
            .map_err(|e| format!("Failed to create backups directory: {e}"))?;

        Ok(Self {
            root_dir,
            write_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn root_dir(&self) -> &PathBuf {
        &self.root_dir
    }

    pub fn log_file_path(&self, exec_id: &str) -> PathBuf {
        self.root_dir.join("logs").join(format!("{exec_id}.log"))
    }

    fn read_json_or_default<T: DeserializeOwned + Default>(&self, filename: &str) -> T {
        let path = self.root_dir.join(filename);
        if !path.exists() {
            return T::default();
        }
        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => T::default(),
        }
    }

    /// Single-mutex write -> temp file -> sync_all -> atomic rename -> rotating `.bak`.
    async fn write_atomic_json<T: Serialize>(
        &self,
        filename: &str,
        value: &T,
        rotate_backup: bool,
    ) -> Result<(), String> {
        let _guard = self.write_lock.lock().await;
        self.write_atomic_json_unlocked(filename, value, rotate_backup)
    }

    fn write_atomic_json_unlocked<T: Serialize>(
        &self,
        filename: &str,
        value: &T,
        rotate_backup: bool,
    ) -> Result<(), String> {
        let target_path = self.root_dir.join(filename);
        let temp_path = self.root_dir.join(format!("{filename}.tmp"));

        if rotate_backup && target_path.exists() {
            self.rotate_backups(filename, &target_path);
        }

        let serialized = serde_json::to_string_pretty(value)
            .map_err(|e| format!("JSON serialization failed for {filename}: {e}"))?;

        {
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_path)
                .map_err(|e| format!("Failed to open temp file for {filename}: {e}"))?;
            file.write_all(serialized.as_bytes())
                .map_err(|e| format!("Failed writing temp file for {filename}: {e}"))?;
            file.sync_all()
                .map_err(|e| format!("Failed fsync on temp file for {filename}: {e}"))?;
        }

        fs::rename(&temp_path, &target_path)
            .map_err(|e| format!("Atomic rename failed for {filename}: {e}"))?;

        Ok(())
    }

    fn rotate_backups(&self, filename: &str, current_path: &PathBuf) {
        let backups_dir = self.root_dir.join("backups");
        for idx in (1..MAX_BACKUPS_PER_FILE).rev() {
            let older = backups_dir.join(format!("{filename}.{idx}.bak"));
            let next = backups_dir.join(format!("{filename}.{}.bak", idx + 1));
            if older.exists() {
                let _ = fs::rename(&older, &next);
            }
        }
        let first_bak = backups_dir.join(format!("{filename}.1.bak"));
        let _ = fs::copy(current_path, first_bak);
    }

    pub fn load_projects(&self) -> Vec<Project> {
        self.read_json_or_default("projects.json")
    }

    pub async fn save_projects(&self, projects: &[Project]) -> Result<(), String> {
        self.write_atomic_json("projects.json", &projects, true).await
    }

    /// Atomic mutex-guarded read-modify-write for projects.json so concurrent calls never overwrite each other.
    pub async fn upsert_projects(&self, incoming: Vec<Project>) -> Result<Vec<Project>, String> {
        let _guard = self.write_lock.lock().await;
        let mut current: Vec<Project> = self.read_json_or_default("projects.json");
        for item in incoming {
            if let Some(pos) = current.iter().position(|p| p.id == item.id) {
                current[pos] = item;
            } else {
                current.push(item);
            }
        }
        self.write_atomic_json_unlocked("projects.json", &current, true)?;
        Ok(current)
    }

    pub fn load_commands(&self) -> Vec<CommandItem> {
        self.read_json_or_default("commands.json")
    }

    pub async fn save_commands(&self, commands: &[CommandItem]) -> Result<(), String> {
        self.write_atomic_json("commands.json", &commands, true).await
    }

    /// Atomic mutex-guarded read-modify-write for commands.json so parallel create_command calls never lose items.
    pub async fn upsert_commands_batch(
        &self,
        incoming: Vec<CommandItem>,
    ) -> Result<Vec<CommandItem>, String> {
        let _guard = self.write_lock.lock().await;
        let mut current: Vec<CommandItem> = self.read_json_or_default("commands.json");
        for item in incoming.into_iter().rev() {
            if let Some(pos) = current.iter().position(|c| c.id == item.id) {
                current[pos] = item;
            } else {
                current.insert(0, item);
            }
        }
        self.write_atomic_json_unlocked("commands.json", &current, true)?;
        Ok(current)
    }

    /// Loads `settings.json` and non-fatally validates every DPAPI-encrypted
    /// provider key so migrated settings never crash startup.
    pub fn load_settings(&self) -> AppSettings {
        let mut settings: AppSettings = self.read_json_or_default("settings.json");
        for provider in &mut settings.providers {
            let outcome = decrypt_secret_dpapi(provider.encrypted_api_key.as_deref());
            let (status, err) = outcome.to_status();
            provider.secret_status = status;
            provider.secret_error = err;
        }
        settings
    }

    pub async fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.write_atomic_json("settings.json", settings, true).await
    }

    pub fn load_executions(&self) -> Vec<ExecutionRecord> {
        self.read_json_or_default("executions.json")
    }

    pub async fn append_or_update_execution(&self, record: ExecutionRecord) -> Result<(), String> {
        let mut list = self.load_executions();
        if let Some(pos) = list.iter().position(|r| r.id == record.id) {
            list[pos] = record;
        } else {
            list.insert(0, record);
        }
        if list.len() > MAX_EXECUTIONS {
            list.truncate(MAX_EXECUTIONS);
        }
        self.write_atomic_json("executions.json", &list, false).await
    }

    pub fn load_session(&self) -> SessionState {
        self.read_json_or_default("session.json")
    }

    pub async fn save_session(&self, session: &SessionState) -> Result<(), String> {
        self.write_atomic_json("session.json", session, false).await
    }

    pub fn read_execution_log(&self, exec_id: &str, max_bytes: usize) -> Result<String, String> {
        let path = self.log_file_path(exec_id);
        if !path.exists() {
            return Ok(String::new());
        }
        let bytes = fs::read(&path).map_err(|e| format!("Failed reading log file: {e}"))?;
        if bytes.len() <= max_bytes {
            Ok(String::from_utf8_lossy(&bytes).to_string())
        } else {
            let slice = &bytes[bytes.len() - max_bytes..];
            Ok(String::from_utf8_lossy(slice).to_string())
        }
    }

    /// Waits briefly for any in-flight atomic JSON write lock to finish before
    /// exiting from the system tray without risking a Tokio runtime panic.
    pub fn flush_checkpoint_sync(&self) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        while std::time::Instant::now() < deadline {
            if let Ok(_guard) = self.write_lock.try_lock() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
}
