use crate::models::{
    AppSettings, CommandItem, EngineInfo, EngineType, ExecutionRecord, GuardrailCheckResult,
    PathValidationResult, Project, SecretStatus, SessionState, WorkspaceFileEntry,
    WorkspaceInspectionResult, WorkspaceManifestFile,
};
use crate::runner::{probe_available_engines, ProcessRunner};
use crate::security::{
    decrypt_secret_dpapi, encrypt_secret_dpapi, validate_command_guardrails, validate_local_path,
    validate_provider_url, SecretDecryptOutcome,
};
use crate::storage::AtomicJsonStore;
use std::fs::{self, File};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, State, WebviewWindow};

pub struct AppState {
    pub store: AtomicJsonStore,
    pub runner: ProcessRunner,
    pub pending_open_launcher: AtomicBool,
}

/// Reveals the hidden main window once React finishes its initial mount
/// (zero-flash cold start) and returns whether the Quick Launcher should open.
#[tauri::command]
pub fn reveal_main_window(window: WebviewWindow, state: State<'_, AppState>) -> bool {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    state.pending_open_launcher.swap(false, Ordering::SeqCst)
}

#[tauri::command]
pub fn get_projects(state: State<'_, AppState>) -> Vec<Project> {
    state.store.load_projects()
}

#[tauri::command]
pub async fn save_projects(
    state: State<'_, AppState>,
    projects: Vec<Project>,
) -> Result<(), String> {
    for p in &projects {
        let check = validate_local_path(&p.base_path, false);
        if !check.valid {
            return Err(check
                .blocked_reason
                .unwrap_or_else(|| "Invalid project basePath.".to_string()));
        }
    }
    state.store.save_projects(&projects).await
}

#[tauri::command]
pub async fn upsert_projects(
    state: State<'_, AppState>,
    projects: Vec<Project>,
) -> Result<Vec<Project>, String> {
    for p in &projects {
        let check = validate_local_path(&p.base_path, false);
        if !check.valid {
            return Err(check
                .blocked_reason
                .unwrap_or_else(|| "Invalid project basePath.".to_string()));
        }
    }
    state.store.upsert_projects(projects).await
}

#[tauri::command]
pub fn get_commands(state: State<'_, AppState>) -> Vec<CommandItem> {
    state.store.load_commands()
}

#[tauri::command]
pub async fn save_commands(
    state: State<'_, AppState>,
    commands: Vec<CommandItem>,
) -> Result<(), String> {
    state.store.save_commands(&commands).await
}

#[tauri::command]
pub async fn upsert_commands_batch(
    state: State<'_, AppState>,
    commands: Vec<CommandItem>,
) -> Result<Vec<CommandItem>, String> {
    for c in &commands {
        let guardrail = validate_command_guardrails(&c.command);
        if guardrail.blocked {
            return Err(guardrail
                .reason
                .unwrap_or_else(|| "Command blocked by security guardrails.".to_string()));
        }
    }
    state.store.upsert_commands_batch(commands).await
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.store.load_settings()
}

#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous_shortcut = state.store.load_settings().launcher_shortcut;
    for provider in &mut settings.providers {
        if let Some(ref url) = provider.base_url {
            if !url.trim().is_empty() {
                validate_provider_url(url)?;
            }
        }
        let outcome = decrypt_secret_dpapi(provider.encrypted_api_key.as_deref());
        let (status, err) = outcome.to_status();
        provider.secret_status = status;
        provider.secret_error = err;
    }
    state.store.save_settings(&settings).await?;
    if settings.launcher_shortcut != previous_shortcut {
        crate::rebind_global_shortcut(&app, &settings.launcher_shortcut);
    }
    Ok(settings)
}

#[tauri::command]
pub async fn set_provider_api_key(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> Result<AppSettings, String> {
    let mut settings = state.store.load_settings();
    let provider = settings
        .providers
        .iter_mut()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{provider_id}' not found."))?;

    if api_key.trim().is_empty() {
        provider.encrypted_api_key = None;
        provider.secret_status = SecretStatus::Missing;
        provider.secret_error = None;
    } else {
        let ciphertext = encrypt_secret_dpapi(api_key.trim())?;
        provider.encrypted_api_key = Some(ciphertext);
        provider.secret_status = SecretStatus::Configured;
        provider.secret_error = None;
    }

    state.store.save_settings(&settings).await?;
    Ok(settings)
}

/// Returns decrypted secret solely for in-memory Vercel AI SDK invocation in Tauri.
/// Never logged or persisted in plaintext.
#[tauri::command]
pub fn get_provider_decrypted_key(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Option<String>, String> {
    let settings = state.store.load_settings();
    let provider = settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("Provider '{provider_id}' not found."))?;

    match decrypt_secret_dpapi(provider.encrypted_api_key.as_deref()) {
        SecretDecryptOutcome::Decrypted(secret) => Ok(Some(secret)),
        SecretDecryptOutcome::Missing => Ok(None),
        SecretDecryptOutcome::Failed(msg) => Err(msg),
    }
}

#[tauri::command]
pub fn get_executions(state: State<'_, AppState>) -> Vec<ExecutionRecord> {
    state.store.load_executions()
}

#[tauri::command]
pub fn get_execution_log(
    state: State<'_, AppState>,
    execution_id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    state
        .store
        .read_execution_log(&execution_id, max_bytes.unwrap_or(64 * 1024))
}

#[tauri::command]
pub fn get_session_state(state: State<'_, AppState>) -> SessionState {
    state.store.load_session()
}

#[tauri::command]
pub async fn save_session_state(
    state: State<'_, AppState>,
    session: SessionState,
) -> Result<(), String> {
    state.store.save_session(&session).await
}

#[tauri::command]
pub async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    engine: EngineType,
    command_text: String,
    base_path: String,
    command_id: Option<String>,
    project_id: Option<String>,
    triggered_by: String,
) -> Result<ExecutionRecord, String> {
    let settings = state.store.load_settings();
    state
        .runner
        .spawn_command(
            app,
            engine,
            command_text,
            base_path,
            command_id,
            project_id,
            triggered_by,
            settings.command_timeout_sec,
        )
        .await
}

#[tauri::command]
pub async fn stop_execution(
    state: State<'_, AppState>,
    execution_id: String,
) -> Result<bool, String> {
    state.runner.stop_execution(&execution_id).await
}

#[tauri::command]
pub async fn send_execution_stdin(
    state: State<'_, AppState>,
    execution_id: String,
    input: String,
) -> Result<(), String> {
    state.runner.write_stdin(&execution_id, &input).await
}

#[tauri::command]
pub fn validate_path(raw_path: String, require_exists: bool) -> PathValidationResult {
    validate_local_path(&raw_path, require_exists)
}

#[tauri::command]
pub fn check_guardrails(command_text: String) -> GuardrailCheckResult {
    validate_command_guardrails(&command_text)
}

#[tauri::command]
pub fn list_available_engines() -> Vec<EngineInfo> {
    probe_available_engines()
}

#[tauri::command]
pub fn get_storage_root(state: State<'_, AppState>) -> String {
    state.store.root_dir().to_string_lossy().to_string()
}

const ALLOWED_MANIFEST_FILES: &[&str] = &[
    "package.json",
    "cargo.toml",
    "pyproject.toml",
    "requirements.txt",
    "makefile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "readme.md",
];

fn is_blocked_secret_filename(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    lower.starts_with(".env")
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.starts_with("credentials")
        || lower == "settings.json"
}

fn is_allowed_manifest_filename(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    ALLOWED_MANIFEST_FILES.iter().any(|allowed| *allowed == lower)
}

#[tauri::command]
pub fn inspect_workspace_files(
    base_path: String,
    manifest_file: Option<String>,
) -> Result<WorkspaceInspectionResult, String> {
    let check = validate_local_path(&base_path, true);
    if !check.valid {
        return Err(check
            .blocked_reason
            .unwrap_or_else(|| "Invalid or blocked project basePath.".to_string()));
    }

    let raw_canonical = check.canonical_path.unwrap_or(base_path);
    let canonical_base = dunce::canonicalize(&raw_canonical)
        .map_err(|e| format!("Unable to resolve project basePath: {e}"))?;

    if !canonical_base.is_dir() {
        return Err("Project basePath is not a directory.".to_string());
    }

    let mut entries: Vec<WorkspaceFileEntry> = Vec::new();
    let dir_iter = fs::read_dir(&canonical_base)
        .map_err(|e| format!("Failed reading workspace directory: {e}"))?;

    for entry in dir_iter.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let blocked_secret = !is_dir && is_blocked_secret_filename(&name);
        let readable_manifest = !is_dir && !blocked_secret && is_allowed_manifest_filename(&name);
        entries.push(WorkspaceFileEntry {
            name,
            kind: if is_dir { "dir".to_string() } else { "file".to_string() },
            readable_manifest,
            blocked_secret,
        });
    }

    entries.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    if entries.len() > 100 {
        entries.truncate(100);
    }

    let manifest = if let Some(requested_raw) = manifest_file {
        let requested = requested_raw.trim();
        if requested.is_empty() {
            None
        } else {
            if requested.contains("..") || requested.contains('/') || requested.contains('\\') {
                return Err("Manifest filename must be a single top-level filename without path traversal.".to_string());
            }
            if is_blocked_secret_filename(requested) {
                return Err(format!("Access denied: '{requested}' is blocked by secret-file guardrails."));
            }
            if !is_allowed_manifest_filename(requested) {
                return Err(format!(
                    "Unsupported manifest '{requested}'. Only safe top-level manifests (package.json, Cargo.toml, pyproject.toml, requirements.txt, Makefile, docker-compose.yml, README.md) may be read."
                ));
            }

            let joined = canonical_base.join(requested);
            let canonical_target = dunce::canonicalize(&joined)
                .map_err(|e| format!("Manifest file '{requested}' not found or unreadable: {e}"))?;

            // Symlink / NTFS junction escape guard
            if !canonical_target.starts_with(&canonical_base) {
                return Err("Path escapes project basePath".to_string());
            }

            let file = File::open(&canonical_target)
                .map_err(|e| format!("Failed opening manifest '{requested}': {e}"))?;
            let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
            let truncated = file_len > 8192;

            let mut buf = Vec::with_capacity(8192);
            file.take(8192)
                .read_to_end(&mut buf)
                .map_err(|e| format!("Failed reading manifest '{requested}': {e}"))?;

            let raw_text = String::from_utf8_lossy(&buf).to_string();
            let content = raw_text.strip_prefix('\u{FEFF}').unwrap_or(&raw_text).to_string();

            Some(WorkspaceManifestFile {
                filename: requested.to_string(),
                content,
                truncated,
            })
        }
    } else {
        None
    };

    Ok(WorkspaceInspectionResult {
        base_path: canonical_base.to_string_lossy().to_string(),
        entries,
        manifest,
        simulated: false,
    })
}
