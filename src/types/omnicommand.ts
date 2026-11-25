export type EngineType = "cmd" | "powershell" | "python" | "linux" | "git";

export type RiskLevel = "low" | "medium" | "high";

export type RunPolicy = "inherit" | "auto" | "ask";

export type AgentPermissionMode = "ask" | "selected" | "auto";

export type ProviderType =
  | "gemini"
  | "claude"
  | "openai"
  | "grok"
  | "openrouter"
  | "perplexity"
  | "zai"
  | "custom";

export type SecretStatus = "configured" | "missing" | "decrypt_failed";

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: ProviderType;
  modelId: string;
  baseUrl?: string | null;
  customHeaders?: Record<string, string> | null;
  /** Ciphertext stored in Rust via DPAPI (never plaintext). */
  encryptedApiKey?: string | null;
  secretStatus: SecretStatus;
  secretError?: string | null;
}

export interface Project {
  id: string;
  name: string;
  basePath: string;
  defaultEngine: EngineType;
  createdAt: string;
  updatedAt: string;
}

export interface CommandItem {
  id: string;
  /** null = Global Root (universal command with no fixed directory) */
  projectId: string | null;
  name: string;
  alias: string;
  command: string;
  engine: EngineType;
  riskLevel: RiskLevel;
  runPolicy: RunPolicy;
  aiAllowed: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type ExecutionStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "blocked";

export interface ExecutionRecord {
  id: string;
  commandId: string | null;
  projectId: string | null;
  engine: EngineType;
  commandText: string;
  basePath: string;
  status: ExecutionStatus;
  exitCode: number | null;
  durationMs: number;
  triggeredBy: "user" | "ai";
  logFilePath: string;
  startedAt: string;
}

export interface ConsoleLine {
  id: string;
  executionId: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  timestamp: string;
}

export interface OutputBatchEvent {
  executionId: string;
  chunks: Array<{
    stream: "stdout" | "stderr" | "system";
    text: string;
    timestamp: string;
  }>;
}

export interface ExecutionFinishedEvent {
  executionId: string;
  status: ExecutionStatus;
  exitCode: number | null;
  durationMs: number;
}

export interface EngineInfo {
  engine: EngineType;
  label: string;
  available: boolean;
  binaryPath?: string | null;
  version?: string | null;
}

export interface PathValidationResult {
  valid: boolean;
  exists: boolean;
  canonicalPath: string | null;
  blockedReason: string | null;
}

export interface GuardrailCheckResult {
  allowed: boolean;
  blocked: boolean;
  requiresConfirmation: boolean;
  matchedRule: string | null;
  reason: string | null;
}

export interface AppSettings {
  theme: "dark" | "light";
  launcherShortcut: string;
  closeToTray: boolean;
  unloadWebviewOnClose: boolean;
  agentPermissionMode: AgentPermissionMode;
  activeProviderId: string;
  providers: ProviderConfig[];
  commandTimeoutSec: number;
}

export interface ToolTraceItem {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status:
    | "pending_approval"
    | "running"
    | "completed"
    | "rejected"
    | "blocked"
    | "cancelled"
    | "error";
  summary?: string;
  error?: string;
}

export interface OptionChoiceItem {
  id: string;
  label: string;
  description?: string;
}

export interface OptionPromptResponse {
  selectedIds: string[];
  selectedLabels: string[];
  customValue?: string;
  cancelled?: boolean;
}

export interface PendingOptionPrompt {
  id: string;
  question: string;
  selectionType: "single" | "multiple";
  displayAs: "buttons" | "select";
  options: OptionChoiceItem[];
  allowCustomInput?: boolean;
  resolve: (response: OptionPromptResponse) => void;
}

export interface ResolvedOptionCard {
  id: string;
  question: string;
  selectedLabels: string[];
  customValue?: string;
  cancelled?: boolean;
}

export interface CompletionChip {
  id: string;
  kind: "project" | "commands" | "execution";
  label: string;
  projectId?: string | null;
  commandId?: string;
  executionId?: string;
}

export interface SuggestedCommandItem {
  id: string;
  name: string;
  alias: string;
  command: string;
  engine: EngineType;
  riskLevel: RiskLevel;
  explanation: string;
  projectId: string | null;
  projectName?: string;
}

export interface ChatMentionItem {
  id: string;
  kind: "project" | "command";
  label: string;
  projectId: string | null;
  basePath?: string;
  defaultEngine?: EngineType;
  commandId?: string;
  commandText?: string;
  engine?: EngineType;
  riskLevel?: RiskLevel;
  parentProjectName?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolTraces?: ToolTraceItem[];
  optionCards?: ResolvedOptionCard[];
  completionChips?: CompletionChip[];
  suggestions?: SuggestedCommandItem[];
  mentions?: ChatMentionItem[];
}

export interface SessionState {
  selectedProjectId: string | null;
  aiDrawerOpen: boolean;
  consoleHeight: number;
  lastUsedGlobalBasePath: string | null;
  chatMessages: ChatMessage[];
}

export interface BatchApprovalCommandPreview {
  id: string;
  name: string;
  alias: string;
  command: string;
  engine: EngineType;
  riskLevel: RiskLevel;
  description?: string;
}

export interface PendingApproval {
  id: string;
  toolName: string;
  title: string;
  commandText?: string;
  engine?: EngineType;
  basePath?: string;
  riskLevel: RiskLevel;
  reason: string;
  details: Record<string, unknown>;
  /** Populated for `create_commands_batch` so one Batch Approval Card lets users select individual commands. */
  batchCommands?: BatchApprovalCommandPreview[];
  resolve: (approved: boolean | string[]) => void;
}

export interface BasePathPickerRequest {
  title: string;
  commandName?: string;
  suggestedPath?: string | null;
  resolve: (selectedPath: string | null) => void;
}

export interface ConfirmRunRequest {
  title: string;
  commandText: string;
  engine: EngineType;
  basePath: string;
  riskLevel: RiskLevel;
  warningReason?: string;
  resolve: (confirmed: boolean) => void;
}

export interface VariablePromptItem {
  name: string;
  rawToken: string;
  kind: "directory" | "text";
  defaultValue?: string;
  occurrences: number;
}

export interface VariablePromptRequest {
  title: string;
  commandName?: string;
  commandTemplate: string;
  engine: EngineType;
  variables: VariablePromptItem[];
  initialValues?: Record<string, string>;
  resolve: (values: Record<string, string> | null) => void;
}

export const ENGINE_LABELS: Record<EngineType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  python: "Python",
  linux: "Linux",
  git: "Git",
};

export const ENGINE_ORDER: EngineType[] = [
  "powershell",
  "cmd",
  "python",
  "linux",
  "git",
];
