use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    Cmd,
    Powershell,
    Python,
    Linux,
    Git,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunPolicy {
    Inherit,
    Auto,
    Ask,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentPermissionMode {
    Ask,
    Selected,
    Auto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderType {
    Gemini,
    Claude,
    Openai,
    Grok,
    Openrouter,
    Perplexity,
    Zai,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecretStatus {
    Configured,
    Missing,
    DecryptFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub provider_type: ProviderType,
    pub model_id: String,
    pub base_url: Option<String>,
    pub custom_headers: Option<HashMap<String, String>>,
    /// Base64-encoded Windows DPAPI ciphertext (CurrentUser scope). Never plaintext.
    pub encrypted_api_key: Option<String>,
    /// Derived at runtime during DPAPI validation; never stored as plaintext key.
    #[serde(default = "default_secret_status")]
    pub secret_status: SecretStatus,
    pub secret_error: Option<String>,
}

fn default_secret_status() -> SecretStatus {
    SecretStatus::Missing
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub base_path: String,
    pub default_engine: EngineType,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandItem {
    pub id: String,
    /// `None` means Global Root (universal command with no fixed basePath)
    pub project_id: Option<String>,
    pub name: String,
    pub alias: String,
    pub command: String,
    pub engine: EngineType,
    pub risk_level: RiskLevel,
    pub run_policy: RunPolicy,
    pub ai_allowed: bool,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus {
    Running,
    Completed,
    Failed,
    Killed,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub command_id: Option<String>,
    pub project_id: Option<String>,
    pub engine: EngineType,
    pub command_text: String,
    pub base_path: String,
    pub status: ExecutionStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub triggered_by: String,
    pub log_file_path: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub launcher_shortcut: String,
    pub close_to_tray: bool,
    pub unload_webview_on_close: bool,
    pub agent_permission_mode: AgentPermissionMode,
    pub active_provider_id: String,
    pub providers: Vec<ProviderConfig>,
    pub command_timeout_sec: u64,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            launcher_shortcut: "Shift+Space".to_string(),
            close_to_tray: true,
            unload_webview_on_close: false,
            agent_permission_mode: AgentPermissionMode::Ask,
            active_provider_id: "gemini-default".to_string(),
            providers: vec![
                ProviderConfig {
                    id: "gemini-default".to_string(),
                    name: "Google Gemini".to_string(),
                    provider_type: ProviderType::Gemini,
                    model_id: "gemini-2.5-flash".to_string(),
                    base_url: None,
                    custom_headers: None,
                    encrypted_api_key: None,
                    secret_status: SecretStatus::Missing,
                    secret_error: None,
                },
                ProviderConfig {
                    id: "claude-default".to_string(),
                    name: "Anthropic Claude".to_string(),
                    provider_type: ProviderType::Claude,
                    model_id: "claude-sonnet-4-20250514".to_string(),
                    base_url: None,
                    custom_headers: None,
                    encrypted_api_key: None,
                    secret_status: SecretStatus::Missing,
                    secret_error: None,
                },
                ProviderConfig {
                    id: "openai-default".to_string(),
                    name: "OpenAI".to_string(),
                    provider_type: ProviderType::Openai,
                    model_id: "gpt-4.1-mini".to_string(),
                    base_url: None,
                    custom_headers: None,
                    encrypted_api_key: None,
                    secret_status: SecretStatus::Missing,
                    secret_error: None,
                },
                ProviderConfig {
                    id: "grok-default".to_string(),
                    name: "xAI Grok".to_string(),
                    provider_type: ProviderType::Grok,
                    model_id: "grok-3-mini".to_string(),
                    base_url: None,
                    custom_headers: None,
                    encrypted_api_key: None,
                    secret_status: SecretStatus::Missing,
                    secret_error: None,
                },
            ],
            command_timeout_sec: 120,
        }
    }
}

/// Persisted right before `unloadWebviewOnClose` destroys WebView2 so chat and
/// project context survive tray residency without losing user state.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    pub selected_project_id: Option<String>,
    pub ai_drawer_open: bool,
    pub console_height: u32,
    pub last_used_global_base_path: Option<String>,
    pub chat_messages: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub engine: EngineType,
    pub label: String,
    pub available: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidationResult {
    pub valid: bool,
    pub exists: bool,
    pub canonical_path: Option<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardrailCheckResult {
    pub allowed: bool,
    pub blocked: bool,
    pub requires_confirmation: bool,
    pub matched_rule: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunkItem {
    pub stream: String,
    pub text: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputBatchEvent {
    pub execution_id: String,
    pub chunks: Vec<OutputChunkItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionFinishedEvent {
    pub execution_id: String,
    pub status: ExecutionStatus,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
}
