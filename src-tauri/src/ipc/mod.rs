use crate::models::{
    AppSettings, CommandItem, EngineInfo, EngineType, ExecutionRecord, GuardrailCheckResult,
    PathValidationResult, Project, SecretStatus, SessionState,
};
use crate::runner::{probe_available_engines, ProcessRunner};
use crate::security::{
    decrypt_secret_dpapi, encrypt_secret_dpapi, validate_command_guardrails, validate_local_path,
    validate_provider_url, SecretDecryptOutcome,
};
use crate::storage::AtomicJsonStore;
use tauri::{AppHandle, State};

pub struct AppState {
    pub store: AtomicJsonStore,
    pub runner: ProcessRunner,
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
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
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
