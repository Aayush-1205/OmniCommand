import type {
  AppSettings,
  CommandItem,
  EngineInfo,
  EngineType,
  ExecutionFinishedEvent,
  ExecutionRecord,
  GuardrailCheckResult,
  OutputBatchEvent,
  PathValidationResult,
  Project,
  SessionState,
} from "../types/omnicommand";
import { checkCommandGuardrails, validateLocalPathClient } from "./guardrails";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<{ name: string }>;
  }
}

export interface FolderPickResult {
  path: string | null;
  cancelled?: boolean;
  notice?: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

const STORAGE_KEYS = {
  projects: "omnicommand_projects_v1",
  commands: "omnicommand_commands_v1",
  settings: "omnicommand_settings_v2",
  executions: "omnicommand_executions_v1",
  session: "omnicommand_session_v1",
  logsPrefix: "omnicommand_log_",
  previewKeysPrefix: "omnicommand_preview_key_",
};

export function createDefaultSettings(): AppSettings {
  return {
    theme: "dark",
    launcherShortcut: "Shift+Space",
    closeToTray: true,
    unloadWebviewOnClose: false,
    agentPermissionMode: "ask",
    activeProviderId: "gemini-default",
    commandTimeoutSec: 120,
    providers: [
      {
        id: "gemini-default",
        name: "Google Gemini",
        providerType: "gemini",
        modelId: "gemini-2.5-flash",
        baseUrl: null,
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "claude-default",
        name: "Anthropic Claude",
        providerType: "claude",
        modelId: "claude-sonnet-4-20250514",
        baseUrl: null,
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "openai-default",
        name: "OpenAI",
        providerType: "openai",
        modelId: "gpt-4.1-mini",
        baseUrl: null,
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "grok-default",
        name: "xAI Grok",
        providerType: "grok",
        modelId: "grok-3-mini",
        baseUrl: null,
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "openrouter-default",
        name: "OpenRouter",
        providerType: "openrouter",
        modelId: "anthropic/claude-3.7-sonnet",
        baseUrl: "https://openrouter.ai/api/v1",
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "perplexity-default",
        name: "Perplexity",
        providerType: "perplexity",
        modelId: "sonar-pro",
        baseUrl: "https://api.perplexity.ai",
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "zai-default",
        name: "Z.ai",
        providerType: "zai",
        modelId: "glm-4.5",
        baseUrl: "https://api.z.ai/api/paas/v4",
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
      {
        id: "custom-local",
        name: "Direct / Custom API",
        providerType: "custom",
        modelId: "qwen2.5-coder:14b",
        baseUrl: "http://127.0.0.1:11434/v1",
        customHeaders: null,
        encryptedApiKey: null,
        secretStatus: "missing",
        secretError: null,
      },
    ],
  };
}

export function createDefaultSession(): SessionState {
  return {
    selectedProjectId: null,
    aiDrawerOpen: true,
    consoleHeight: 248,
    lastUsedGlobalBasePath: null,
    chatMessages: [],
  };
}

type OutputListener = (event: OutputBatchEvent) => void;
type FinishedListener = (event: ExecutionFinishedEvent) => void;

const previewOutputListeners = new Set<OutputListener>();
const previewFinishedListeners = new Set<FinishedListener>();
const previewRunningJobs = new Map<
  string,
  {
    timers: number[];
    cancelled: boolean;
    startedAt: number;
    logLines: string[];
    record: ExecutionRecord;
    stdinHandler?: (input: string) => void;
  }
>();

function safeReadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in sandboxed frames
  }
}

/**
 * Per-resource async FIFO write queue ensuring read-modify-write operations on
 * projects.json and commands.json are strictly serialized in both browser preview
 * and Tauri WebView2, preventing parallel tool calls from clobbering each other.
 */
function createAsyncMutex() {
  let chain: Promise<void> = Promise.resolve();
  return async function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = chain;
    chain = prev.then(() => nextLock);
    await prev;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const projectsWriteLock = createAsyncMutex();
const commandsWriteLock = createAsyncMutex();

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const runtimeBridge = {
  isTauri: isTauriRuntime,

  async loadProjects(): Promise<Project[]> {
    if (isTauriRuntime()) {
      return tauriInvoke<Project[]>("get_projects");
    }
    return safeReadLocal<Project[]>(STORAGE_KEYS.projects, []);
  },

  async saveProjects(projects: Project[]): Promise<void> {
    return projectsWriteLock(async () => {
      if (isTauriRuntime()) {
        await tauriInvoke("save_projects", { projects });
        return;
      }
      safeWriteLocal(STORAGE_KEYS.projects, projects);
    });
  },

  async mutateProjects(updater: (current: Project[]) => Project[]): Promise<Project[]> {
    return projectsWriteLock(async () => {
      const current = isTauriRuntime()
        ? await tauriInvoke<Project[]>("get_projects")
        : safeReadLocal<Project[]>(STORAGE_KEYS.projects, []);
      const next = updater(current);
      if (isTauriRuntime()) {
        await tauriInvoke("save_projects", { projects: next });
      } else {
        safeWriteLocal(STORAGE_KEYS.projects, next);
      }
      return next;
    });
  },

  async upsertProjects(incoming: Project[]): Promise<Project[]> {
    return projectsWriteLock(async () => {
      if (isTauriRuntime()) {
        return tauriInvoke<Project[]>("upsert_projects", { projects: incoming });
      }
      const current = safeReadLocal<Project[]>(STORAGE_KEYS.projects, []);
      const next = [...current];
      for (const item of incoming) {
        const idx = next.findIndex((p) => p.id === item.id);
        if (idx >= 0) {
          next[idx] = item;
        } else {
          next.push(item);
        }
      }
      safeWriteLocal(STORAGE_KEYS.projects, next);
      return next;
    });
  },

  async loadCommands(): Promise<CommandItem[]> {
    if (isTauriRuntime()) {
      return tauriInvoke<CommandItem[]>("get_commands");
    }
    return safeReadLocal<CommandItem[]>(STORAGE_KEYS.commands, []);
  },

  async saveCommands(commands: CommandItem[]): Promise<void> {
    return commandsWriteLock(async () => {
      if (isTauriRuntime()) {
        await tauriInvoke("save_commands", { commands });
        return;
      }
      safeWriteLocal(STORAGE_KEYS.commands, commands);
    });
  },

  async mutateCommands(updater: (current: CommandItem[]) => CommandItem[]): Promise<CommandItem[]> {
    return commandsWriteLock(async () => {
      const current = isTauriRuntime()
        ? await tauriInvoke<CommandItem[]>("get_commands")
        : safeReadLocal<CommandItem[]>(STORAGE_KEYS.commands, []);
      const next = updater(current);
      if (isTauriRuntime()) {
        await tauriInvoke("save_commands", { commands: next });
      } else {
        safeWriteLocal(STORAGE_KEYS.commands, next);
      }
      return next;
    });
  },

  async upsertCommandsBatch(incoming: CommandItem[]): Promise<CommandItem[]> {
    return commandsWriteLock(async () => {
      if (isTauriRuntime()) {
        return tauriInvoke<CommandItem[]>("upsert_commands_batch", { commands: incoming });
      }
      const current = safeReadLocal<CommandItem[]>(STORAGE_KEYS.commands, []);
      const next = [...current];
      for (let i = incoming.length - 1; i >= 0; i--) {
        const item = incoming[i];
        const idx = next.findIndex((c) => c.id === item.id);
        if (idx >= 0) {
          next[idx] = item;
        } else {
          next.unshift(item);
        }
      }
      safeWriteLocal(STORAGE_KEYS.commands, next);
      return next;
    });
  },

  async loadSettings(): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return tauriInvoke<AppSettings>("get_settings");
    }
    const defaults = createDefaultSettings();
    const stored = safeReadLocal<Partial<AppSettings>>(STORAGE_KEYS.settings, {});
    return {
      ...defaults,
      ...stored,
      providers: stored.providers && stored.providers.length > 0 ? stored.providers : defaults.providers,
    };
  },

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return tauriInvoke<AppSettings>("save_settings", { settings });
    }
    safeWriteLocal(STORAGE_KEYS.settings, settings);
    return settings;
  },

  async setProviderApiKey(
    providerId: string,
    apiKey: string,
    options?: { allowKeylessLocal?: boolean }
  ): Promise<AppSettings> {
    if (isTauriRuntime()) {
      return tauriInvoke<AppSettings>("set_provider_api_key", { providerId, apiKey });
    }
    const trimmed = apiKey.trim();
    const isConfigured = Boolean(trimmed) || Boolean(options?.allowKeylessLocal);
    try {
      if (trimmed) {
        sessionStorage.setItem(`${STORAGE_KEYS.previewKeysPrefix}${providerId}`, trimmed);
      } else {
        sessionStorage.removeItem(`${STORAGE_KEYS.previewKeysPrefix}${providerId}`);
      }
    } catch {
      // Ignore storage restrictions
    }

    const current = await this.loadSettings();
    const updated: AppSettings = {
      ...current,
      providers: current.providers.map((p) =>
        p.id === providerId
          ? {
              ...p,
              encryptedApiKey: trimmed ? "dpapi-protected" : null,
              secretStatus: isConfigured ? "configured" : "missing",
              secretError: null,
            }
          : p
      ),
    };
    safeWriteLocal(STORAGE_KEYS.settings, updated);
    return updated;
  },

  async getProviderDecryptedKey(providerId: string): Promise<string | null> {
    if (isTauriRuntime()) {
      return tauriInvoke<string | null>("get_provider_decrypted_key", { providerId });
    }
    try {
      return sessionStorage.getItem(`${STORAGE_KEYS.previewKeysPrefix}${providerId}`);
    } catch {
      return null;
    }
  },

  async loadSession(): Promise<SessionState> {
    if (isTauriRuntime()) {
      return tauriInvoke<SessionState>("get_session_state");
    }
    const defaults = createDefaultSession();
    const stored = safeReadLocal<Partial<SessionState>>(STORAGE_KEYS.session, {});
    return { ...defaults, ...stored };
  },

  async saveSession(session: SessionState): Promise<void> {
    if (isTauriRuntime()) {
      await tauriInvoke("save_session_state", { session });
      return;
    }
    safeWriteLocal(STORAGE_KEYS.session, session);
  },

  async loadExecutions(): Promise<ExecutionRecord[]> {
    if (isTauriRuntime()) {
      return tauriInvoke<ExecutionRecord[]>("get_executions");
    }
    return safeReadLocal<ExecutionRecord[]>(STORAGE_KEYS.executions, []);
  },

  async getExecutionLog(executionId: string): Promise<string> {
    if (isTauriRuntime()) {
      return tauriInvoke<string>("get_execution_log", { executionId, maxBytes: 65536 });
    }
    return localStorage.getItem(`${STORAGE_KEYS.logsPrefix}${executionId}`) ?? "";
  },

  async validatePath(rawPath: string, requireExists = false): Promise<PathValidationResult> {
    if (isTauriRuntime()) {
      return tauriInvoke<PathValidationResult>("validate_path", { rawPath, requireExists });
    }
    return validateLocalPathClient(rawPath);
  },

  async checkGuardrails(commandText: string): Promise<GuardrailCheckResult> {
    if (isTauriRuntime()) {
      return tauriInvoke<GuardrailCheckResult>("check_guardrails", { commandText });
    }
    return checkCommandGuardrails(commandText);
  },

  async listAvailableEngines(): Promise<EngineInfo[]> {
    if (isTauriRuntime()) {
      return tauriInvoke<EngineInfo[]>("list_available_engines");
    }
    return [
      { engine: "powershell", label: "PowerShell", available: true, binaryPath: "pwsh.exe", version: "7.4.6" },
      { engine: "cmd", label: "CMD", available: true, binaryPath: "C:\\Windows\\System32\\cmd.exe", version: "10.0.22631" },
      { engine: "python", label: "Python", available: true, binaryPath: "python.exe", version: "3.12.7" },
      { engine: "linux", label: "Linux (WSL / Git Bash)", available: true, binaryPath: "wsl.exe", version: "Ubuntu 24.04" },
      { engine: "git", label: "Git", available: true, binaryPath: "git.exe", version: "2.47.0.windows.1" },
    ];
  },

  async getStorageRoot(): Promise<string> {
    if (isTauriRuntime()) {
      return tauriInvoke<string>("get_storage_root");
    }
    return "%LocalAppData%\\OmniCommand";
  },

  async pickFolderNative(options?: {
    title?: string;
    defaultPath?: string;
  }): Promise<FolderPickResult> {
    if (isTauriRuntime()) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: options?.title ?? "Select Folder",
        ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
      });
      if (typeof selected !== "string" || !selected.trim()) {
        return { path: null, cancelled: true };
      }
      const check = await this.validatePath(selected, false);
      return { path: check.canonicalPath ?? selected };
    }

    // Browser preview: use File System Access API when supported & permitted
    if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
      try {
        const handle = await window.showDirectoryPicker({ mode: "read" });
        const folderName = handle?.name?.trim();
        if (!folderName) {
          return { path: null, cancelled: true };
        }

        // Preserve existing drive/parent prefix if user already typed a base path
        let basePrefix = "C:\\Users\\Dev";
        const current = options?.defaultPath?.trim();
        if (current && /^[a-zA-Z]:[\\/]/.test(current)) {
          const normalized = current.replace(/\//g, "\\").replace(/\\+$/, "");
          const parts = normalized.split("\\");
          if (parts.length >= 2) {
            basePrefix = parts.slice(0, -1).join("\\");
          }
        }

        const candidate = `${basePrefix}\\${folderName}`;
        const check = validateLocalPathClient(candidate);
        return {
          path: check.canonicalPath ?? candidate,
          notice:
            "Browser sandbox only exposes the folder name—verify the parent Windows path above or run in the desktop app for full native paths.",
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return { path: null, cancelled: true };
        }
        return {
          path: null,
          notice:
            "Browser preview restricts native folder dialogs inside embedded frames. Type or paste a Windows path directly (native picker works automatically in the Tauri desktop app).",
        };
      }
    }

    return {
      path: null,
      notice:
        "This browser does not support showDirectoryPicker(). Type or paste a Windows path directly (native picker works automatically in the Tauri desktop app).",
    };
  },

  async subscribeExecutionEvents(
    onOutput: OutputListener,
    onFinished: FinishedListener
  ): Promise<() => void> {
    if (isTauriRuntime()) {
      const { listen } = await import("@tauri-apps/api/event");
      const unlistenOut = await listen<OutputBatchEvent>("execution:output", (e) => onOutput(e.payload));
      const unlistenFin = await listen<ExecutionFinishedEvent>("execution:finished", (e) =>
        onFinished(e.payload)
      );
      return () => {
        unlistenOut();
        unlistenFin();
      };
    }

    previewOutputListeners.add(onOutput);
    previewFinishedListeners.add(onFinished);
    return () => {
      previewOutputListeners.delete(onOutput);
      previewFinishedListeners.delete(onFinished);
    };
  },

  async runCommand(params: {
    engine: EngineType;
    commandText: string;
    basePath: string;
    commandId: string | null;
    projectId: string | null;
    triggeredBy: "user" | "ai";
    timeoutSec: number;
  }): Promise<ExecutionRecord> {
    const guardrail = await this.checkGuardrails(params.commandText);
    if (guardrail.blocked) {
      throw new Error(guardrail.reason ?? "Blocked by security guardrails.");
    }

    const pathCheck = await this.validatePath(params.basePath, true);
    if (!pathCheck.valid) {
      throw new Error(pathCheck.blockedReason ?? "Invalid execution basePath.");
    }

    if (isTauriRuntime()) {
      return tauriInvoke<ExecutionRecord>("run_command", {
        engine: params.engine,
        commandText: params.commandText,
        basePath: pathCheck.canonicalPath ?? params.basePath,
        commandId: params.commandId,
        projectId: params.projectId,
        triggeredBy: params.triggeredBy,
      });
    }

    return runPreviewSandboxCommand({
      ...params,
      basePath: pathCheck.canonicalPath ?? params.basePath,
    });
  },

  async stopExecution(executionId: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return tauriInvoke<boolean>("stop_execution", { executionId });
    }
    const job = previewRunningJobs.get(executionId);
    if (!job) return false;
    job.cancelled = true;
    job.timers.forEach((t) => window.clearTimeout(t));
    previewRunningJobs.delete(executionId);

    const now = new Date().toISOString();
    const killMsg = "\x1b[33m[Process Tree Terminated via Job Object / taskkill /F /T]\x1b[0m";
    job.logLines.push("[Process Tree Terminated]");
    emitPreviewBatch(executionId, [{ stream: "system", text: killMsg, timestamp: now }]);

    const durationMs = Date.now() - job.startedAt;
    finalizePreviewExecution(job.record, "killed", -1, durationMs, job.logLines);
    return true;
  },

  async sendStdin(executionId: string, input: string): Promise<void> {
    if (isTauriRuntime()) {
      await tauriInvoke("send_execution_stdin", { executionId, input });
      return;
    }
    const job = previewRunningJobs.get(executionId);
    if (!job) throw new Error("No active running process for stdin.");
    const now = new Date().toISOString();
    job.logLines.push(`> ${input}`);
    emitPreviewBatch(executionId, [{ stream: "system", text: `\x1b[90mstdin >\x1b[0m ${input}`, timestamp: now }]);
    job.stdinHandler?.(input);
  },
};

function emitPreviewBatch(
  executionId: string,
  chunks: Array<{ stream: "stdout" | "stderr" | "system"; text: string; timestamp: string }>
) {
  const evt: OutputBatchEvent = { executionId, chunks };
  previewOutputListeners.forEach((fn) => fn(evt));
}

function finalizePreviewExecution(
  record: ExecutionRecord,
  status: ExecutionRecord["status"],
  exitCode: number | null,
  durationMs: number,
  logLines: string[]
) {
  const updated: ExecutionRecord = { ...record, status, exitCode, durationMs };
  const list = safeReadLocal<ExecutionRecord[]>(STORAGE_KEYS.executions, []);
  const next = [updated, ...list.filter((r) => r.id !== record.id)].slice(0, 500);
  safeWriteLocal(STORAGE_KEYS.executions, next);
  try {
    localStorage.setItem(`${STORAGE_KEYS.logsPrefix}${record.id}`, logLines.join("\n"));
  } catch {
    // ignore quota
  }

  const finEvt: ExecutionFinishedEvent = {
    executionId: record.id,
    status,
    exitCode,
    durationMs,
  };
  previewFinishedListeners.forEach((fn) => fn(finEvt));
}

/**
 * Interactive browser preview multi-engine runner with ~40ms batched ANSI
 * streaming, stdin echo, Kill Process Tree support, and realistic exit codes.
 */
function runPreviewSandboxCommand(params: {
  engine: EngineType;
  commandText: string;
  basePath: string;
  commandId: string | null;
  projectId: string | null;
  triggeredBy: "user" | "ai";
  timeoutSec: number;
}): ExecutionRecord {
  const id = `exec_${crypto.randomUUID().slice(0, 10)}`;
  const startedAt = new Date().toISOString();
  const record: ExecutionRecord = {
    id,
    commandId: params.commandId,
    projectId: params.projectId,
    engine: params.engine,
    commandText: params.commandText,
    basePath: params.basePath,
    status: "running",
    exitCode: null,
    durationMs: 0,
    triggeredBy: params.triggeredBy,
    logFilePath: `%LocalAppData%\\OmniCommand\\logs\\${id}.log`,
    startedAt,
  };

  const existing = safeReadLocal<ExecutionRecord[]>(STORAGE_KEYS.executions, []);
  safeWriteLocal(STORAGE_KEYS.executions, [record, ...existing].slice(0, 500));

  const plan = buildPreviewExecutionPlan(params.engine, params.commandText, params.basePath);
  const startedMs = Date.now();
  const job = {
    timers: [] as number[],
    cancelled: false,
    startedAt: startedMs,
    logLines: [] as string[],
    record,
    stdinHandler: (input: string) => {
      const ts = new Date().toISOString();
      const reply = `Received input: "${input}"`;
      job.logLines.push(reply);
      emitPreviewBatch(id, [{ stream: "stdout", text: reply, timestamp: ts }]);
    },
  };
  previewRunningJobs.set(id, job);

  // Batch frames at ~40ms cadence matching the Rust IPC batching behavior
  let delay = 40;
  for (const batch of plan.batches) {
    const t = window.setTimeout(() => {
      if (job.cancelled) return;
      const now = new Date().toISOString();
      const chunks = batch.lines.map((l) => {
        job.logLines.push(l.text.replace(/\x1b\[[0-9;]*m/g, ""));
        return { stream: l.stream, text: l.text, timestamp: now };
      });
      emitPreviewBatch(id, chunks);
    }, delay);
    job.timers.push(t);
    delay += batch.delayAfterMs;
  }

  const finishTimer = window.setTimeout(() => {
    if (job.cancelled) return;
    previewRunningJobs.delete(id);
    const durationMs = Date.now() - startedMs;
    finalizePreviewExecution(
      record,
      plan.exitCode === 0 ? "completed" : "failed",
      plan.exitCode,
      durationMs,
      job.logLines
    );
  }, delay + 30);
  job.timers.push(finishTimer);

  // Enforce configured command timeout
  const timeoutTimer = window.setTimeout(() => {
    if (!previewRunningJobs.has(id)) return;
    void runtimeBridge.stopExecution(id);
  }, Math.max(5, params.timeoutSec) * 1000);
  job.timers.push(timeoutTimer);

  return record;
}

interface PreviewBatch {
  delayAfterMs: number;
  lines: Array<{ stream: "stdout" | "stderr" | "system"; text: string }>;
}

function buildPreviewExecutionPlan(
  engine: EngineType,
  rawCmd: string,
  basePath: string
): { batches: PreviewBatch[]; exitCode: number } {
  const cmd = rawCmd.trim();
  const lower = cmd.toLowerCase();

  // Streaming stress test command to demonstrate 40ms batching + virtualized console
  if (lower.includes("--stress") || lower.startsWith("seq ") || lower.includes("range(500")) {
    const batches: PreviewBatch[] = [];
    for (let b = 0; b < 25; b++) {
      const lines: Array<{ stream: "stdout" | "stderr" | "system"; text: string }> = [];
      for (let i = 1; i <= 40; i++) {
        const lineNum = b * 40 + i;
        lines.push({
          stream: "stdout",
          text: `\x1b[90m[${String(lineNum).padStart(4, "0")}]\x1b[0m Compiling module target_${lineNum}.rs \x1b[32mok\x1b[0m`,
        });
      }
      batches.push({ delayAfterMs: 40, lines });
    }
    batches.push({
      delayAfterMs: 40,
      lines: [{ stream: "stdout", text: `\x1b[32m✓ Streamed 1,000 lines in 40ms batches (DOM virtualized)\x1b[0m` }],
    });
    return { batches, exitCode: 0 };
  }

  // Long-running watch/ping command so user can test Kill Process Tree & stdin
  if (
    lower.startsWith("ping ") ||
    lower.includes("--watch") ||
    lower.includes("sleep") ||
    lower.includes("start-sleep")
  ) {
    const batches: PreviewBatch[] = [
      {
        delayAfterMs: 650,
        lines: [
          { stream: "system", text: `\x1b[90m[${engine}] cwd: ${basePath} (CREATE_NO_WINDOW, UTF-8)\x1b[0m` },
          { stream: "stdout", text: `Process running — use "Kill Process Tree" or send stdin below...` },
        ],
      },
    ];
    for (let i = 1; i <= 12; i++) {
      batches.push({
        delayAfterMs: 900,
        lines: [
          {
            stream: "stdout",
            text: `\x1b[36mheartbeat #${i}\x1b[0m  reply=127.0.0.1  time=${(1.1 + (i % 4) * 0.3).toFixed(1)}ms`,
          },
        ],
      });
    }
    return { batches, exitCode: 0 };
  }

  // Realistic failure cases for immediate "Explain Error" testing
  if (
    lower.includes("fail") ||
    lower.includes("error") ||
    lower.includes("exit 1") ||
    lower.includes("nonexistent") ||
    lower.includes("broken") ||
    lower.includes("missing_module")
  ) {
    if (engine === "python") {
      return {
        exitCode: 1,
        batches: [
          {
            delayAfterMs: 90,
            lines: [
              { stream: "system", text: `\x1b[90m[python -u] cwd: ${basePath}\x1b[0m` },
              { stream: "stderr", text: `\x1b[31mTraceback (most recent call last):\x1b[0m` },
              { stream: "stderr", text: `  File "<string>", line 1, in <module>` },
              {
                stream: "stderr",
                text: `\x1b[31mModuleNotFoundError: No module named 'nonexistent_pkg'\x1b[0m`,
              },
            ],
          },
        ],
      };
    }
    return {
      exitCode: 1,
      batches: [
        {
          delayAfterMs: 80,
          lines: [
            { stream: "system", text: `\x1b[90m[${engine}] cwd: ${basePath}\x1b[0m` },
            { stream: "stdout", text: `Executing: ${cmd}` },
            {
              stream: "stderr",
              text: `\x1b[31mERR! Command failed with exit code 1 (ENOENT / missing dependency or invalid target).\x1b[0m`,
            },
            {
              stream: "stderr",
              text: `\x1b[33mHint:\x1b[0m Click "Explain Error" to inspect this execution trace with AI.`,
            },
          ],
        },
      ],
    };
  }

  if (engine === "git" || lower.startsWith("git ")) {
    if (lower.includes("status")) {
      return {
        exitCode: 0,
        batches: [
          {
            delayAfterMs: 70,
            lines: [
              { stream: "system", text: `\x1b[90m[git] cwd: ${basePath}\x1b[0m` },
              { stream: "stdout", text: `On branch \x1b[32mmain\x1b[0m` },
              { stream: "stdout", text: `Your branch is up to date with 'origin/main'.` },
              { stream: "stdout", text: `nothing to commit, working tree clean` },
            ],
          },
        ],
      };
    }
    if (lower.includes("log")) {
      return {
        exitCode: 0,
        batches: [
          {
            delayAfterMs: 70,
            lines: [
              { stream: "system", text: `\x1b[90m[git] cwd: ${basePath}\x1b[0m` },
              { stream: "stdout", text: `\x1b[33m9f4a21c\x1b[0m feat: wire Job Object process-tree cleanup` },
              { stream: "stdout", text: `\x1b[33m4c1d88a\x1b[0m perf: batch stdout IPC every 40ms` },
              { stream: "stdout", text: `\x1b[33m1b9e02f\x1b[0m chore: initialize OmniCommand Tauri v2 workspace` },
            ],
          },
        ],
      };
    }
  }

  if (lower.startsWith("echo ") || lower.startsWith("write-output ")) {
    const msg = cmd.replace(/^(echo|write-output)\s+/i, "").replace(/^["']|["']$/g, "");
    return {
      exitCode: 0,
      batches: [
        {
          delayAfterMs: 50,
          lines: [
            { stream: "system", text: `\x1b[90m[${engine}] cwd: ${basePath}\x1b[0m` },
            { stream: "stdout", text: msg },
          ],
        },
      ],
    };
  }

  if (lower === "dir" || lower === "ls" || lower === "get-childitem" || lower === "gci") {
    return {
      exitCode: 0,
      batches: [
        {
          delayAfterMs: 70,
          lines: [
            { stream: "system", text: `\x1b[90m[${engine}] Directory: ${basePath}\x1b[0m` },
            { stream: "stdout", text: `\x1b[34mMode                 LastWriteTime         Length Name\x1b[0m` },
            { stream: "stdout", text: `d-----        2026-11-25   07:10                src` },
            { stream: "stdout", text: `d-----        2026-11-25   07:10                src-tauri` },
            { stream: "stdout", text: `-a----        2026-11-25   07:14           1420 package.json` },
            { stream: "stdout", text: `-a----        2026-11-25   07:15           4096 README.md` },
          ],
        },
      ],
    };
  }

  if (lower.startsWith("npm ") || lower.startsWith("pnpm ") || lower.startsWith("cargo ")) {
    return {
      exitCode: 0,
      batches: [
        {
          delayAfterMs: 120,
          lines: [
            { stream: "system", text: `\x1b[90m[${engine}] cwd: ${basePath} (UTF-8)\x1b[0m` },
            { stream: "stdout", text: `\x1b[36m>\x1b[0m ${cmd}` },
          ],
        },
        {
          delayAfterMs: 180,
          lines: [
            { stream: "stdout", text: `Resolving workspace targets...` },
            { stream: "stdout", text: `Building modules cleanly (0 warnings, 0 errors)` },
          ],
        },
        {
          delayAfterMs: 80,
          lines: [{ stream: "stdout", text: `\x1b[32m✓ Completed successfully\x1b[0m` }],
        },
      ],
    };
  }

  return {
    exitCode: 0,
    batches: [
      {
        delayAfterMs: 60,
        lines: [
          { stream: "system", text: `\x1b[90m[${engine}] cwd: ${basePath} (CREATE_NO_WINDOW, UTF-8)\x1b[0m` },
          { stream: "stdout", text: `\x1b[32m✓\x1b[0m Executed "${cmd}"` },
        ],
      },
    ],
  };
}
