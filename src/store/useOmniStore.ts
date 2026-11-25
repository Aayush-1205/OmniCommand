import { create } from "zustand";
import type {
  AgentPermissionMode,
  AppSettings,
  BasePathPickerRequest,
  ChatMentionItem,
  ChatMessage,
  CommandItem,
  ConfirmRunRequest,
  ConsoleLine,
  EngineInfo,
  EngineType,
  ExecutionFinishedEvent,
  ExecutionRecord,
  ExportedProjectTemplate,
  OptionPromptResponse,
  OutputBatchEvent,
  PendingApproval,
  PendingOptionPrompt,
  Project,
  ProviderConfig,
  ProviderType,
  ResolvedOptionCard,
  RiskLevel,
  RunPolicy,
  SessionState,
  SuggestedCommandItem,
  ToolTraceItem,
  VariablePromptRequest,
} from "../types/omnicommand";
import {
  createDefaultSettings,
  runtimeBridge,
} from "../lib/bridge";
import {
  interpolateCommandVariables,
  parseCommandVariables,
} from "../lib/variables";
import { runAgentTurn } from "../ai/agentRunner";
import { analyzeExecutionError } from "../ai/errorAnalyzer";
import { runCommandAdvisorSubagent } from "../ai/commandAdvisorSubagent";
import {
  testProviderConnection,
  type ConnectionTestResult,
} from "../ai/connectionTester";
import type { ToolExecutionContext } from "../ai/tools";

interface ToastNotice {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

interface OmniStore {
  initialized: boolean;
  storageRoot: string;
  projects: Project[];
  commands: CommandItem[];
  executions: ExecutionRecord[];
  engines: EngineInfo[];
  settings: AppSettings;

  // Session state persisted across tray unload
  selectedProjectId: string | null;
  activeEngineOverride: EngineType;
  aiDrawerOpen: boolean;
  consoleHeight: number;
  lastUsedGlobalBasePath: string | null;
  chatMessages: ChatMessage[];

  // Console state
  activeExecutionId: string | null;
  consoleTab: "console" | "history";
  consoleLinesByExec: Record<string, ConsoleLine[]>;

  // Search & UI modals
  commandSearchQuery: string;
  launcherOpen: boolean;
  settingsOpen: boolean;
  providerSetupModalOpen: boolean;
  providerSetupInitialPreset: ProviderType | null;
  projectModalState: { open: boolean; editing: Project | null };
  commandModalState: { open: boolean; editing: CommandItem | null };

  // Provider connection test results
  connectionTestResults: Record<string, ConnectionTestResult>;
  testingProviderIds: Record<string, boolean>;

  // Async interactive prompts
  pendingApprovals: PendingApproval[];
  pendingOptionPrompt: PendingOptionPrompt | null;
  basePathPicker: BasePathPickerRequest | null;
  confirmRunModal: ConfirmRunRequest | null;
  variablePromptModal: VariablePromptRequest | null;

  // AI loading & streaming state
  chatSessionId: number;
  activeAgentAbortController: AbortController | null;
  aiBusy: boolean;
  aiLiveTraces: ToolTraceItem[];
  aiStreamingText: string;
  aiLiveOptionCards: ResolvedOptionCard[];
  aiLiveSuggestions: SuggestedCommandItem[];
  aiLiveExportedTemplates: ExportedProjectTemplate[];

  // Notices
  toasts: ToastNotice[];

  // Actions
  initialize: () => Promise<() => void>;
  refreshWorkspace: () => Promise<void>;
  flushSession: () => Promise<void>;
  pushToast: (tone: ToastNotice["tone"], message: string) => void;
  dismissToast: (id: string) => void;

  // Navigation & UI
  selectProject: (projectId: string | null) => void;
  setActiveEngineOverride: (engine: EngineType) => void;
  setAiDrawerOpen: (open: boolean) => void;
  setConsoleHeight: (height: number) => void;
  setConsoleTab: (tab: "console" | "history") => void;
  setCommandSearchQuery: (q: string) => void;
  setLauncherOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openProviderSetupModal: (preset?: ProviderType | null) => void;
  closeProviderSetupModal: () => void;
  openProjectModal: (editing?: Project | null) => void;
  closeProjectModal: () => void;
  openCommandModal: (editing?: CommandItem | null) => void;
  closeCommandModal: () => void;

  // Projects CRUD
  createProject: (input: {
    name: string;
    basePath: string;
    defaultEngine: EngineType;
  }) => Promise<Project>;
  updateProject: (
    projectId: string,
    patch: Partial<Pick<Project, "name" | "basePath" | "defaultEngine">>
  ) => Promise<Project>;
  deleteProject: (projectId: string) => Promise<void>;

  // Commands CRUD
  createCommand: (input: {
    projectId: string | null;
    name: string;
    alias: string;
    command: string;
    engine: EngineType;
    riskLevel: RiskLevel;
    runPolicy: RunPolicy;
    aiAllowed: boolean;
    description: string;
  }) => Promise<CommandItem>;
  createCommandsBatch: (input: {
    projectId: string | null;
    commands: Array<{
      name: string;
      alias: string;
      command: string;
      engine: EngineType;
      riskLevel: RiskLevel;
      runPolicy: RunPolicy;
      aiAllowed: boolean;
      description: string;
    }>;
  }) => Promise<CommandItem[]>;
  updateCommand: (
    commandId: string,
    patch: Partial<Omit<CommandItem, "id" | "createdAt" | "updatedAt">>
  ) => Promise<CommandItem>;
  deleteCommand: (commandId: string) => Promise<void>;
  toggleCommandAiAllowed: (commandId: string) => Promise<void>;

  // Execution & Console
  runStoredCommandInteractive: (command: CommandItem, explicitBasePath?: string) => Promise<void>;
  runAdhocCommandInteractive: (params: {
    commandText: string;
    engine: EngineType;
    explicitBasePath?: string;
  }) => Promise<void>;
  executeDirect: (params: {
    engine: EngineType;
    commandText: string;
    basePath: string;
    commandId: string | null;
    projectId: string | null;
    triggeredBy: "user" | "ai";
  }) => Promise<ExecutionRecord>;
  stopActiveExecution: (executionId?: string) => Promise<void>;
  sendStdinToActive: (input: string) => Promise<void>;
  clearActiveConsole: () => void;
  inspectExecutionRecord: (executionId: string) => Promise<void>;

  // Async dialogs
  requestGlobalBasePath: (req: {
    title: string;
    commandName?: string;
  }) => Promise<string | null>;
  resolveGlobalBasePath: (path: string | null) => void;
  requestConfirmRun: (req: Omit<ConfirmRunRequest, "resolve">) => Promise<boolean>;
  resolveConfirmRun: (confirmed: boolean) => void;
  requestCommandVariables: (
    req: Omit<VariablePromptRequest, "resolve">
  ) => Promise<Record<string, string> | null>;
  resolveCommandVariables: (values: Record<string, string> | null) => void;
  resolveApproval: (approvalId: string, approved: boolean | string[]) => void;
  resolveApprovalBatch: (approvedIds: string[], rejectedIds: string[]) => void;
  resolveUserOptions: (response: OptionPromptResponse) => void;

  // Settings, Theme & Providers
  toggleTheme: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setAgentPermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  setActiveProviderId: (providerId: string) => Promise<void>;
  saveProviderConfig: (provider: ProviderConfig) => Promise<void>;
  deleteCustomProvider: (providerId: string) => Promise<void>;
  saveProviderApiKey: (
    providerId: string,
    apiKey: string,
    options?: { allowKeylessLocal?: boolean }
  ) => Promise<void>;
  saveAndConnectProvider: (params: {
    provider: ProviderConfig;
    apiKey: string;
    allowKeylessLocal?: boolean;
    testResult?: ConnectionTestResult;
  }) => Promise<void>;
  testProviderById: (providerId: string, apiKeyOverride?: string) => Promise<ConnectionTestResult>;

  // AI Assistant
  sendChatMessage: (text: string, mentions?: ChatMentionItem[]) => Promise<void>;
  stopAgentTurn: () => void;
  explainExecutionError: (executionId: string) => Promise<void>;
  clearChatHistory: () => void;
}

function applyThemeClass(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function buildSessionSnapshot(s: OmniStore): SessionState {
  return {
    selectedProjectId: s.selectedProjectId,
    aiDrawerOpen: s.aiDrawerOpen,
    consoleHeight: s.consoleHeight,
    lastUsedGlobalBasePath: s.lastUsedGlobalBasePath,
    chatMessages: s.chatMessages.slice(-60),
  };
}

let sessionSaveTimer: number | null = null;
function scheduleSessionPersist(get: () => OmniStore) {
  if (sessionSaveTimer !== null) {
    window.clearTimeout(sessionSaveTimer);
  }
  sessionSaveTimer = window.setTimeout(() => {
    void runtimeBridge.saveSession(buildSessionSnapshot(get()));
  }, 220);
}

export const useOmniStore = create<OmniStore>((set, get) => ({
  initialized: false,
  storageRoot: "%LocalAppData%\\OmniCommand",
  projects: [],
  commands: [],
  executions: [],
  engines: [],
  settings: createDefaultSettings(),

  selectedProjectId: null,
  activeEngineOverride: "powershell",
  aiDrawerOpen: true,
  consoleHeight: 248,
  lastUsedGlobalBasePath: null,
  chatMessages: [],

  activeExecutionId: null,
  consoleTab: "console",
  consoleLinesByExec: {},

  commandSearchQuery: "",
  launcherOpen: false,
  settingsOpen: false,
  providerSetupModalOpen: false,
  providerSetupInitialPreset: null,
  projectModalState: { open: false, editing: null },
  commandModalState: { open: false, editing: null },

  connectionTestResults: {},
  testingProviderIds: {},

  pendingApprovals: [],
  pendingOptionPrompt: null,
  basePathPicker: null,
  confirmRunModal: null,
  variablePromptModal: null,

  chatSessionId: 1,
  activeAgentAbortController: null,
  aiBusy: false,
  aiLiveTraces: [],
  aiStreamingText: "",
  aiLiveOptionCards: [],
  aiLiveSuggestions: [],
  aiLiveExportedTemplates: [],
  toasts: [],

  initialize: async () => {
    const [projects, commands, settings, executions, session, engines, storageRoot] =
      await Promise.all([
        runtimeBridge.loadProjects(),
        runtimeBridge.loadCommands(),
        runtimeBridge.loadSettings(),
        runtimeBridge.loadExecutions(),
        runtimeBridge.loadSession(),
        runtimeBridge.listAvailableEngines(),
        runtimeBridge.getStorageRoot(),
      ]);

    const resolvedSelectedId =
      session.selectedProjectId && projects.some((p) => p.id === session.selectedProjectId)
        ? session.selectedProjectId
        : null;
    const activeProject = projects.find((p) => p.id === resolvedSelectedId);

    applyThemeClass(settings.theme);

    set({
      initialized: true,
      storageRoot,
      projects,
      commands,
      settings,
      executions,
      engines,
      selectedProjectId: resolvedSelectedId,
      activeEngineOverride: activeProject?.defaultEngine ?? "powershell",
      aiDrawerOpen: session.aiDrawerOpen ?? true,
      consoleHeight: session.consoleHeight || 248,
      lastUsedGlobalBasePath: session.lastUsedGlobalBasePath ?? null,
      chatMessages: Array.isArray(session.chatMessages) ? session.chatMessages : [],
      activeExecutionId: executions[0]?.id ?? null,
    });

    const unsubEvents = await runtimeBridge.subscribeExecutionEvents(
      (batch: OutputBatchEvent) => {
        set((state) => {
          const prev = state.consoleLinesByExec[batch.executionId] ?? [];
          const incoming: ConsoleLine[] = batch.chunks.map((c, idx) => ({
            id: `${batch.executionId}_${prev.length + idx}`,
            executionId: batch.executionId,
            stream: c.stream,
            text: c.text,
            timestamp: c.timestamp,
          }));
          const merged = [...prev, ...incoming];
          const bounded = merged.length > 25000 ? merged.slice(merged.length - 25000) : merged;
          return {
            consoleLinesByExec: {
              ...state.consoleLinesByExec,
              [batch.executionId]: bounded,
            },
          };
        });
      },
      (finished: ExecutionFinishedEvent) => {
        set((state) => ({
          executions: state.executions.map((ex) =>
            ex.id === finished.executionId
              ? {
                  ...ex,
                  status: finished.status,
                  exitCode: finished.exitCode,
                  durationMs: finished.durationMs,
                }
              : ex
          ),
        }));
      }
    );

    const handleBeforeUnload = () => {
      void runtimeBridge.saveSession(buildSessionSnapshot(get()));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    let unlistenTauriUnload: (() => void) | null = null;
    let unlistenTauriLauncher: (() => void) | null = null;
    if (runtimeBridge.isTauri()) {
      const { listen } = await import("@tauri-apps/api/event");
      unlistenTauriUnload = await listen("omnicommand:before-unload", () => {
        void get().flushSession();
      });
      unlistenTauriLauncher = await listen("omnicommand:open-launcher", () => {
        set({ launcherOpen: true });
      });
    }

    return () => {
      unsubEvents();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unlistenTauriUnload?.();
      unlistenTauriLauncher?.();
    };
  },

  refreshWorkspace: async () => {
    const [projects, commands] = await Promise.all([
      runtimeBridge.loadProjects(),
      runtimeBridge.loadCommands(),
    ]);
    set((s) => {
      const selectedStillExists =
        s.selectedProjectId !== null && projects.some((p) => p.id === s.selectedProjectId);
      return {
        projects,
        commands,
        selectedProjectId: selectedStillExists ? s.selectedProjectId : null,
      };
    });
  },

  flushSession: async () => {
    await runtimeBridge.saveSession(buildSessionSnapshot(get()));
  },

  pushToast: (tone, message) => {
    const id = `toast_${crypto.randomUUID().slice(0, 8)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, message }] }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, 4500);
  },

  dismissToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  selectProject: (projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    set({
      selectedProjectId: projectId,
      activeEngineOverride: project?.defaultEngine ?? get().activeEngineOverride,
      commandSearchQuery: "",
    });
    scheduleSessionPersist(get);
  },

  setActiveEngineOverride: (engine) => set({ activeEngineOverride: engine }),

  setAiDrawerOpen: (open) => {
    const hasConfigured = get().settings.providers.some((p) => p.secretStatus === "configured");
    set({
      aiDrawerOpen: open,
      ...(open && !hasConfigured
        ? { providerSetupModalOpen: true, providerSetupInitialPreset: null }
        : {}),
    });
    scheduleSessionPersist(get);
  },

  setConsoleHeight: (height) => {
    const clamped = Math.max(150, Math.min(540, height));
    set({ consoleHeight: clamped });
    scheduleSessionPersist(get);
  },

  setConsoleTab: (tab) => set({ consoleTab: tab }),
  setCommandSearchQuery: (q) => set({ commandSearchQuery: q }),
  setLauncherOpen: (open) => set({ launcherOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openProviderSetupModal: (preset = null) =>
    set({ providerSetupModalOpen: true, providerSetupInitialPreset: preset }),
  closeProviderSetupModal: () =>
    set({ providerSetupModalOpen: false, providerSetupInitialPreset: null }),
  openProjectModal: (editing = null) => set({ projectModalState: { open: true, editing } }),
  closeProjectModal: () => set({ projectModalState: { open: false, editing: null } }),
  openCommandModal: (editing = null) => set({ commandModalState: { open: true, editing } }),
  closeCommandModal: () => set({ commandModalState: { open: false, editing: null } }),

  createProject: async (input) => {
    const check = await runtimeBridge.validatePath(input.basePath, false);
    if (!check.valid) {
      throw new Error(check.blockedReason ?? "Invalid Windows base path.");
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: `proj_${crypto.randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      basePath: check.canonicalPath ?? input.basePath.trim(),
      defaultEngine: input.defaultEngine,
      createdAt: now,
      updatedAt: now,
    };
    await runtimeBridge.upsertProjects([project]);
    set((state) => ({
      projects: [...state.projects.filter((p) => p.id !== project.id), project],
      selectedProjectId: project.id,
      activeEngineOverride: project.defaultEngine,
    }));
    scheduleSessionPersist(get);
    get().pushToast("success", `Created project "${project.name}".`);
    return project;
  },

  updateProject: async (projectId, patch) => {
    const existing = get().projects.find((p) => p.id === projectId);
    if (!existing) throw new Error("Project not found.");
    let canonicalPath = existing.basePath;
    if (patch.basePath && patch.basePath !== existing.basePath) {
      const check = await runtimeBridge.validatePath(patch.basePath, false);
      if (!check.valid) throw new Error(check.blockedReason ?? "Invalid path.");
      canonicalPath = check.canonicalPath ?? patch.basePath.trim();
    }
    const updated: Project = {
      ...existing,
      name: patch.name?.trim() || existing.name,
      basePath: canonicalPath,
      defaultEngine: patch.defaultEngine ?? existing.defaultEngine,
      updatedAt: new Date().toISOString(),
    };
    await runtimeBridge.upsertProjects([updated]);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? updated : p)),
      activeEngineOverride:
        state.selectedProjectId === projectId && patch.defaultEngine
          ? patch.defaultEngine
          : state.activeEngineOverride,
    }));
    get().pushToast("success", `Updated project "${updated.name}".`);
    return updated;
  },

  deleteProject: async (projectId) => {
    const existing = get().projects.find((p) => p.id === projectId);
    if (!existing) return;
    await Promise.all([
      runtimeBridge.mutateProjects((curr) => curr.filter((p) => p.id !== projectId)),
      runtimeBridge.mutateCommands((curr) => curr.filter((c) => c.projectId !== projectId)),
    ]);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      commands: state.commands.filter((c) => c.projectId !== projectId),
      selectedProjectId: state.selectedProjectId === projectId ? null : state.selectedProjectId,
    }));
    scheduleSessionPersist(get);
    get().pushToast("info", `Deleted project "${existing.name}".`);
  },

  createCommand: async (input) => {
    const guardrail = await runtimeBridge.checkGuardrails(input.command);
    if (guardrail.blocked) {
      throw new Error(guardrail.reason ?? "Command blocked by security guardrails.");
    }
    const now = new Date().toISOString();
    const cmd: CommandItem = {
      id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
      projectId: input.projectId,
      name: input.name.trim(),
      alias: input.alias.trim() || input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      command: input.command.trim(),
      engine: input.engine,
      riskLevel: input.riskLevel,
      runPolicy: input.runPolicy,
      aiAllowed: input.aiAllowed,
      description: input.description.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await runtimeBridge.upsertCommandsBatch([cmd]);
    set((state) => ({
      commands: [cmd, ...state.commands.filter((c) => c.id !== cmd.id)],
    }));
    get().pushToast("success", `Saved command "${cmd.name}".`);
    return cmd;
  },

  createCommandsBatch: async (input) => {
    if (input.commands.length === 0) return [];
    for (const item of input.commands) {
      const guardrail = await runtimeBridge.checkGuardrails(item.command);
      if (guardrail.blocked) {
        throw new Error(
          `Blocked "${item.name}": ${guardrail.reason ?? "Command blocked by security guardrails."}`
        );
      }
    }
    const now = new Date().toISOString();
    const created: CommandItem[] = input.commands.map((item) => ({
      id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
      projectId: input.projectId,
      name: item.name.trim(),
      alias:
        item.alias.trim() ||
        item.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-"),
      command: item.command.trim(),
      engine: item.engine,
      riskLevel: item.riskLevel,
      runPolicy: item.runPolicy,
      aiAllowed: item.aiAllowed,
      description: item.description.trim(),
      createdAt: now,
      updatedAt: now,
    }));

    await runtimeBridge.upsertCommandsBatch(created);
    const createdIds = new Set(created.map((c) => c.id));
    set((state) => ({
      commands: [...created, ...state.commands.filter((c) => !createdIds.has(c.id))],
    }));
    get().pushToast(
      "success",
      `Saved ${created.length} command${created.length === 1 ? "" : "s"}.`
    );
    return created;
  },

  updateCommand: async (commandId, patch) => {
    const existing = get().commands.find((c) => c.id === commandId);
    if (!existing) throw new Error("Command not found.");
    if (patch.command) {
      const guardrail = await runtimeBridge.checkGuardrails(patch.command);
      if (guardrail.blocked) {
        throw new Error(guardrail.reason ?? "Command blocked by security guardrails.");
      }
    }
    const updated: CommandItem = {
      ...existing,
      ...patch,
      name: patch.name?.trim() ?? existing.name,
      alias: patch.alias?.trim() ?? existing.alias,
      command: patch.command?.trim() ?? existing.command,
      description: patch.description?.trim() ?? existing.description,
      updatedAt: new Date().toISOString(),
    };
    await runtimeBridge.upsertCommandsBatch([updated]);
    set((state) => ({
      commands: state.commands.map((c) => (c.id === commandId ? updated : c)),
    }));
    get().pushToast("success", `Updated command "${updated.name}".`);
    return updated;
  },

  deleteCommand: async (commandId) => {
    const existing = get().commands.find((c) => c.id === commandId);
    if (!existing) return;
    await runtimeBridge.mutateCommands((curr) => curr.filter((c) => c.id !== commandId));
    set((state) => ({
      commands: state.commands.filter((c) => c.id !== commandId),
    }));
    get().pushToast("info", `Deleted command "${existing.name}".`);
  },

  toggleCommandAiAllowed: async (commandId) => {
    const existing = get().commands.find((c) => c.id === commandId);
    if (!existing) return;
    await get().updateCommand(commandId, { aiAllowed: !existing.aiAllowed });
  },

  runStoredCommandInteractive: async (command, explicitBasePath) => {
    let finalCommand = command.command;
    const parsedVars = parseCommandVariables(command.command);
    if (parsedVars.length > 0) {
      const values = await get().requestCommandVariables({
        title: "Fill Command Variables",
        commandName: command.name,
        commandTemplate: command.command,
        engine: command.engine,
        variables: parsedVars,
      });
      if (!values) return;
      finalCommand = interpolateCommandVariables(command.command, values);
    }

    // Always run Guardrail Validator on the final interpolated command
    const guardrail = await runtimeBridge.checkGuardrails(finalCommand);
    if (guardrail.blocked) {
      get().pushToast("error", guardrail.reason ?? "Blocked by security guardrail.");
      return;
    }

    let basePath = explicitBasePath ?? null;
    if (!basePath && command.projectId) {
      basePath = get().projects.find((p) => p.id === command.projectId)?.basePath ?? null;
    }
    if (!basePath && get().selectedProjectId) {
      basePath = get().projects.find((p) => p.id === get().selectedProjectId)?.basePath ?? null;
    }

    if (!basePath) {
      basePath = await get().requestGlobalBasePath({
        title: `Choose directory for "${command.name}"`,
        commandName: command.name,
      });
      if (!basePath) return;
    }

    if (command.riskLevel === "high") {
      const confirmed = await get().requestConfirmRun({
        title: `Confirm High-Risk Command: ${command.name}`,
        commandText: finalCommand,
        engine: command.engine,
        basePath,
        riskLevel: "high",
        warningReason:
          "This command is marked High Risk and always requires explicit confirmation before execution.",
      });
      if (!confirmed) return;
    }

    try {
      await get().executeDirect({
        engine: command.engine,
        commandText: finalCommand,
        basePath,
        commandId: command.id,
        projectId: command.projectId,
        triggeredBy: "user",
      });
    } catch (err) {
      get().pushToast("error", err instanceof Error ? err.message : String(err));
    }
  },

  runAdhocCommandInteractive: async ({ commandText, engine, explicitBasePath }) => {
    const trimmed = commandText.trim();
    if (!trimmed) return;

    let finalCommand = trimmed;
    const parsedVars = parseCommandVariables(trimmed);
    if (parsedVars.length > 0) {
      const values = await get().requestCommandVariables({
        title: "Fill Command Variables",
        commandName: "Ad-hoc command",
        commandTemplate: trimmed,
        engine,
        variables: parsedVars,
      });
      if (!values) return;
      finalCommand = interpolateCommandVariables(trimmed, values);
    }

    // Always run Guardrail Validator on the final interpolated command
    const guardrail = await runtimeBridge.checkGuardrails(finalCommand);
    if (guardrail.blocked) {
      get().pushToast("error", guardrail.reason ?? "Blocked by security guardrail.");
      return;
    }

    let basePath = explicitBasePath ?? null;
    if (!basePath && get().selectedProjectId) {
      basePath = get().projects.find((p) => p.id === get().selectedProjectId)?.basePath ?? null;
    }

    if (!basePath) {
      basePath = await get().requestGlobalBasePath({
        title: "Choose directory for ad-hoc command",
        commandName: finalCommand,
      });
      if (!basePath) return;
    }

    try {
      await get().executeDirect({
        engine,
        commandText: finalCommand,
        basePath,
        commandId: null,
        projectId: get().selectedProjectId,
        triggeredBy: "user",
      });
    } catch (err) {
      get().pushToast("error", err instanceof Error ? err.message : String(err));
    }
  },

  executeDirect: async (params) => {
    const record = await runtimeBridge.runCommand({
      ...params,
      timeoutSec: get().settings.commandTimeoutSec,
    });

    set((state) => ({
      executions: [record, ...state.executions.filter((e) => e.id !== record.id)].slice(0, 500),
      activeExecutionId: record.id,
      consoleTab: "console",
      lastUsedGlobalBasePath:
        params.projectId === null ? params.basePath : state.lastUsedGlobalBasePath,
      consoleLinesByExec: {
        ...state.consoleLinesByExec,
        [record.id]: [],
      },
    }));
    scheduleSessionPersist(get);
    return record;
  },

  stopActiveExecution: async (executionId) => {
    const targetId = executionId ?? get().activeExecutionId;
    if (!targetId) return;
    const stopped = await runtimeBridge.stopExecution(targetId);
    if (stopped) {
      get().pushToast("warning", "Process tree terminated.");
    }
  },

  sendStdinToActive: async (input) => {
    const targetId = get().activeExecutionId;
    if (!targetId) return;
    try {
      await runtimeBridge.sendStdin(targetId, input);
    } catch (err) {
      get().pushToast("error", err instanceof Error ? err.message : String(err));
    }
  },

  clearActiveConsole: () => {
    const activeId = get().activeExecutionId;
    if (!activeId) return;
    set((s) => ({
      consoleLinesByExec: {
        ...s.consoleLinesByExec,
        [activeId]: [],
      },
    }));
  },

  inspectExecutionRecord: async (executionId) => {
    set({ activeExecutionId: executionId, consoleTab: "console" });
    const existing = get().consoleLinesByExec[executionId];
    if (!existing || existing.length === 0) {
      const raw = await runtimeBridge.getExecutionLog(executionId);
      const lines: ConsoleLine[] = raw
        ? raw.split(/\r?\n/).map((text, idx) => ({
            id: `${executionId}_hist_${idx}`,
            executionId,
            stream: "stdout",
            text,
            timestamp: "",
          }))
        : [];
      set((s) => ({
        consoleLinesByExec: {
          ...s.consoleLinesByExec,
          [executionId]: lines,
        },
      }));
    }
  },

  requestGlobalBasePath: (req) => {
    return new Promise<string | null>((resolve) => {
      set({
        basePathPicker: {
          title: req.title,
          commandName: req.commandName,
          suggestedPath: get().lastUsedGlobalBasePath,
          resolve,
        },
      });
    });
  },

  resolveGlobalBasePath: (selectedPath) => {
    const picker = get().basePathPicker;
    if (picker) {
      set({ basePathPicker: null });
      if (selectedPath) {
        set({ lastUsedGlobalBasePath: selectedPath });
        scheduleSessionPersist(get);
      }
      picker.resolve(selectedPath);
    }
  },

  requestConfirmRun: (req) => {
    return new Promise<boolean>((resolve) => {
      set({
        confirmRunModal: {
          ...req,
          resolve,
        },
      });
    });
  },

  resolveConfirmRun: (confirmed) => {
    const modal = get().confirmRunModal;
    if (modal) {
      set({ confirmRunModal: null });
      modal.resolve(confirmed);
    }
  },

  requestCommandVariables: (req) => {
    return new Promise<Record<string, string> | null>((resolve) => {
      set({
        variablePromptModal: {
          ...req,
          resolve,
        },
      });
    });
  },

  resolveCommandVariables: (values) => {
    const modal = get().variablePromptModal;
    if (modal) {
      set({ variablePromptModal: null });
      modal.resolve(values);
    }
  },

  resolveApproval: (approvalId, approved) => {
    const target = get().pendingApprovals.find((a) => a.id === approvalId);
    if (!target) return;
    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter((a) => a.id !== approvalId),
    }));
    target.resolve(approved);
  },

  resolveApprovalBatch: (approvedIds, rejectedIds) => {
    const approveSet = new Set(approvedIds);
    const rejectSet = new Set(rejectedIds);
    const current = get().pendingApprovals;
    const toResolve = current.filter((a) => approveSet.has(a.id) || rejectSet.has(a.id));
    if (toResolve.length === 0) return;

    set((s) => ({
      pendingApprovals: s.pendingApprovals.filter(
        (a) => !approveSet.has(a.id) && !rejectSet.has(a.id)
      ),
    }));

    for (const item of toResolve) {
      if (item.batchCommands && item.batchCommands.length > 0) {
        item.resolve(approveSet.has(item.id) ? item.batchCommands.map((c) => c.id) : []);
      } else {
        item.resolve(approveSet.has(item.id));
      }
    }
  },

  resolveUserOptions: (response) => {
    const prompt = get().pendingOptionPrompt;
    if (!prompt) return;
    set({ pendingOptionPrompt: null });
    prompt.resolve(response);
  },

  toggleTheme: async () => {
    const nextTheme = get().settings.theme === "dark" ? "light" : "dark";
    await get().updateSettings({ theme: nextTheme });
  },

  updateSettings: async (patch) => {
    const merged: AppSettings = { ...get().settings, ...patch };
    applyThemeClass(merged.theme);
    const saved = await runtimeBridge.saveSettings(merged);
    set({ settings: saved });
  },

  setAgentPermissionMode: async (mode) => {
    await get().updateSettings({ agentPermissionMode: mode });
  },

  setActiveProviderId: async (providerId) => {
    await get().updateSettings({ activeProviderId: providerId });
  },

  saveProviderConfig: async (provider) => {
    const exists = get().settings.providers.some((p) => p.id === provider.id);
    const providers = exists
      ? get().settings.providers.map((p) => (p.id === provider.id ? provider : p))
      : [...get().settings.providers, provider];
    await get().updateSettings({ providers });
    get().pushToast("success", `Saved provider "${provider.name}".`);
  },

  deleteCustomProvider: async (providerId) => {
    const remaining = get().settings.providers.filter((p) => p.id !== providerId);
    if (remaining.length === 0) return;
    const activeProviderId =
      get().settings.activeProviderId === providerId
        ? remaining[0].id
        : get().settings.activeProviderId;
    await get().updateSettings({ providers: remaining, activeProviderId });
  },

  saveProviderApiKey: async (providerId, apiKey, options) => {
    const saved = await runtimeBridge.setProviderApiKey(providerId, apiKey, options);
    set({ settings: saved });
    get().pushToast(
      "success",
      apiKey.trim()
        ? "API key saved."
        : options?.allowKeylessLocal
          ? "Local endpoint connected."
          : "API key cleared."
    );
  },

  saveAndConnectProvider: async ({ provider, apiKey, allowKeylessLocal, testResult }) => {
    const exists = get().settings.providers.some((p) => p.id === provider.id);
    const providers = exists
      ? get().settings.providers.map((p) => (p.id === provider.id ? provider : p))
      : [...get().settings.providers, provider];

    await get().updateSettings({
      providers,
      activeProviderId: provider.id,
    });
    const savedWithKey = await runtimeBridge.setProviderApiKey(provider.id, apiKey, {
      allowKeylessLocal,
    });

    set((s) => ({
      settings: { ...savedWithKey, activeProviderId: provider.id },
      providerSetupModalOpen: false,
      providerSetupInitialPreset: null,
      connectionTestResults: testResult
        ? { ...s.connectionTestResults, [provider.id]: testResult }
        : s.connectionTestResults,
    }));
    await runtimeBridge.saveSettings({ ...savedWithKey, activeProviderId: provider.id });
    get().pushToast("success", `Connected ${provider.name} (${provider.modelId}).`);
  },

  testProviderById: async (providerId, apiKeyOverride) => {
    const provider = get().settings.providers.find((p) => p.id === providerId);
    if (!provider) {
      return { ok: false, latencyMs: 0, message: "Provider not found" };
    }

    set((s) => ({
      testingProviderIds: { ...s.testingProviderIds, [providerId]: true },
    }));

    try {
      const storedKey =
        apiKeyOverride !== undefined
          ? apiKeyOverride
          : (await runtimeBridge.getProviderDecryptedKey(providerId)) ?? "";

      const result = await testProviderConnection(provider, storedKey);
      set((s) => ({
        connectionTestResults: { ...s.connectionTestResults, [providerId]: result },
      }));
      return result;
    } finally {
      set((s) => ({
        testingProviderIds: { ...s.testingProviderIds, [providerId]: false },
      }));
    }
  },

  sendChatMessage: async (text, explicitMentions = []) => {
    const trimmed = text.trim();
    if (!trimmed || get().aiBusy) return;

    const activeProvider =
      get().settings.providers.find((p) => p.id === get().settings.activeProviderId) ??
      get().settings.providers[0];

    if (!activeProvider || activeProvider.secretStatus !== "configured") {
      set({
        aiDrawerOpen: true,
        providerSetupModalOpen: true,
        providerSetupInitialPreset: activeProvider?.providerType ?? "gemini",
      });
      return;
    }

    // Resolve both explicitly picked @ mentions and any manually typed @Name tokens against live workspace state
    const currentProjects = get().projects;
    const currentCommands = get().commands;
    const resolvedMap = new Map<string, ChatMentionItem>();

    for (const m of explicitMentions) {
      resolvedMap.set(`${m.kind}:${m.id}`, m);
    }

    const tokenRegex = /(?:^|\s)@([A-Za-z0-9._-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(trimmed)) !== null) {
      const token = match[1].toLowerCase();
      const matchedProject = currentProjects.find((p) => p.name.toLowerCase() === token);
      if (matchedProject && !resolvedMap.has(`project:${matchedProject.id}`)) {
        resolvedMap.set(`project:${matchedProject.id}`, {
          id: matchedProject.id,
          kind: "project",
          label: matchedProject.name,
          projectId: matchedProject.id,
          basePath: matchedProject.basePath,
          defaultEngine: matchedProject.defaultEngine,
        });
        continue;
      }
      const matchedCmd = currentCommands.find(
        (c) => c.name.toLowerCase() === token || c.alias.toLowerCase() === token
      );
      if (matchedCmd && !resolvedMap.has(`command:${matchedCmd.id}`)) {
        const parentProj = matchedCmd.projectId
          ? currentProjects.find((p) => p.id === matchedCmd.projectId)
          : null;
        resolvedMap.set(`command:${matchedCmd.id}`, {
          id: matchedCmd.id,
          kind: "command",
          label: matchedCmd.name,
          projectId: matchedCmd.projectId,
          commandId: matchedCmd.id,
          commandText: matchedCmd.command,
          engine: matchedCmd.engine,
          riskLevel: matchedCmd.riskLevel,
          parentProjectName: parentProj?.name ?? "Global Root",
        });
      }
    }

    const resolvedMentions = Array.from(resolvedMap.values());

    const userMsg: ChatMessage = {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
      mentions: resolvedMentions.length > 0 ? resolvedMentions : undefined,
    };

    const abortController = new AbortController();
    const sessionId = get().chatSessionId;

    const historyBefore = get().chatMessages;
    set({
      chatMessages: [...historyBefore, userMsg],
      activeAgentAbortController: abortController,
      aiBusy: true,
      aiLiveTraces: [],
      aiStreamingText: "",
      aiLiveOptionCards: [],
      aiLiveSuggestions: [],
      aiLiveExportedTemplates: [],
      pendingOptionPrompt: null,
      aiDrawerOpen: true,
    });
    scheduleSessionPersist(get);

    const waitForExecution = (executionId: string): Promise<ExecutionRecord> => {
      const existing = get().executions.find((e) => e.id === executionId);
      if (existing && existing.status !== "running") {
        return Promise.resolve(existing);
      }

      return new Promise<ExecutionRecord>((resolve) => {
        let settled = false;
        let unsubscribe: (() => void) | null = null;
        let safetyTimer: number | null = null;

        const finish = (rec: ExecutionRecord) => {
          if (settled) return;
          settled = true;
          if (unsubscribe) unsubscribe();
          if (safetyTimer !== null) window.clearTimeout(safetyTimer);
          abortController.signal.removeEventListener("abort", onAbort);
          resolve(rec);
        };

        const onAbort = () => {
          void runtimeBridge.stopExecution(executionId);
          const current = get().executions.find((e) => e.id === executionId);
          finish(
            current
              ? { ...current, status: "killed", exitCode: -1 }
              : {
                  id: executionId,
                  commandId: null,
                  projectId: null,
                  engine: "powershell",
                  commandText: "",
                  basePath: "",
                  status: "killed",
                  exitCode: -1,
                  durationMs: 0,
                  triggeredBy: "ai",
                  logFilePath: "",
                  startedAt: new Date().toISOString(),
                }
          );
        };

        abortController.signal.addEventListener("abort", onAbort, { once: true });

        unsubscribe = useOmniStore.subscribe((state) => {
          const match = state.executions.find((e) => e.id === executionId);
          if (match && match.status !== "running") {
            finish(match);
          }
        });

        const timeoutMs = (Math.max(10, get().settings.commandTimeoutSec) + 5) * 1000;
        safetyTimer = window.setTimeout(() => {
          const match = get().executions.find((e) => e.id === executionId);
          finish(
            match ?? {
              id: executionId,
              commandId: null,
              projectId: null,
              engine: "powershell",
              commandText: "",
              basePath: "",
              status: "killed",
              exitCode: -1,
              durationMs: timeoutMs,
              triggeredBy: "ai",
              logFilePath: "",
              startedAt: new Date().toISOString(),
            }
          );
        }, timeoutMs);
      });
    };

    const runBackgroundAdvisor = (advisorParams: {
      messageId: string;
      projectId: string | null;
      projectName: string;
      basePath: string;
      engine: EngineType;
      userGoal: string;
      provider: ProviderConfig;
    }) => {
      void (async () => {
        try {
          if (get().chatSessionId !== sessionId) return;
          const existingInStore = get()
            .commands.filter((c) => c.projectId === advisorParams.projectId)
            .flatMap((c) => [c.name, c.command]);

          const suggestions = await runCommandAdvisorSubagent({
            projectId: advisorParams.projectId,
            projectName: advisorParams.projectName,
            basePath: advisorParams.basePath,
            engine: advisorParams.engine,
            existingCommands: existingInStore,
            userGoal: advisorParams.userGoal,
            provider: advisorParams.provider,
          });

          if (get().chatSessionId !== sessionId) return;
          if (suggestions.length > 0) {
            set((s) => {
              if (s.chatSessionId !== sessionId) return s;
              if (!s.chatMessages.some((m) => m.id === advisorParams.messageId)) return s;
              return {
                chatMessages: s.chatMessages.map((m) =>
                  m.id === advisorParams.messageId
                    ? { ...m, suggestions, suggestionsLoading: false }
                    : m
                ),
              };
            });
          }
        } catch {
          // Silently ignore 429 rate-limits, network errors, or aborts
        } finally {
          if (get().chatSessionId === sessionId) {
            set((s) => {
              if (s.chatSessionId !== sessionId) return s;
              if (!s.chatMessages.some((m) => m.id === advisorParams.messageId)) return s;
              return {
                chatMessages: s.chatMessages.map((m) =>
                  m.id === advisorParams.messageId && m.suggestionsLoading
                    ? { ...m, suggestionsLoading: false }
                    : m
                ),
              };
            });
            scheduleSessionPersist(get);
          }
        }
      })();
    };

    const toolCtx: ToolExecutionContext = {
      getState: () => {
        const s = get();
        const provider =
          s.settings.providers.find((p) => p.id === s.settings.activeProviderId) ??
          s.settings.providers[0];
        return {
          projects: s.projects,
          commands: s.commands,
          executions: s.executions,
          engines: s.engines,
          selectedProjectId: s.selectedProjectId,
          agentPermissionMode: s.settings.agentPermissionMode,
          activeProvider: provider,
          commandTimeoutSec: s.settings.commandTimeoutSec,
        };
      },
      createProject: (input) => get().createProject(input),
      updateProject: (id, patch) => get().updateProject(id, patch),
      deleteProject: (id) => get().deleteProject(id),
      createCommand: (input) => get().createCommand(input),
      createCommandsBatch: (input) => get().createCommandsBatch(input),
      updateCommand: (id, patch) => get().updateCommand(id, patch),
      deleteCommand: (id) => get().deleteCommand(id),
      executeCommand: (params) => get().executeDirect(params),
      waitForExecution,
      requestApproval: (req) =>
        new Promise<boolean>((resolve) => {
          const item: PendingApproval = {
            ...req,
            id: `apr_${crypto.randomUUID().slice(0, 8)}`,
            resolve: (res) => resolve(Boolean(res)),
          };
          set((s) => ({
            pendingApprovals: [...s.pendingApprovals, item],
            aiDrawerOpen: true,
          }));
        }),
      requestBatchCommandApproval: (req) =>
        new Promise<string[]>((resolve) => {
          const item: PendingApproval = {
            ...req,
            id: `apr_${crypto.randomUUID().slice(0, 8)}`,
            resolve: (res) => {
              if (Array.isArray(res)) {
                resolve(res);
              } else {
                resolve(res ? req.batchCommands.map((c) => c.id) : []);
              }
            },
          };
          set((s) => ({
            pendingApprovals: [...s.pendingApprovals, item],
            aiDrawerOpen: true,
          }));
        }),
      requestScaffoldApproval: (req) =>
        new Promise<string[]>((resolve) => {
          const item: PendingApproval = {
            ...req,
            id: `apr_${crypto.randomUUID().slice(0, 8)}`,
            resolve: (res) => {
              if (Array.isArray(res)) {
                resolve(res);
              } else {
                resolve(res ? req.batchCommands.map((c) => c.id) : []);
              }
            },
          };
          set((s) => ({
            pendingApprovals: [...s.pendingApprovals, item],
            aiDrawerOpen: true,
          }));
        }),
      requestSequenceApproval: (req) =>
        new Promise<boolean>((resolve) => {
          const item: PendingApproval = {
            ...req,
            id: `apr_${crypto.randomUUID().slice(0, 8)}`,
            resolve: (res) => resolve(Boolean(res)),
          };
          set((s) => ({
            pendingApprovals: [...s.pendingApprovals, item],
            aiDrawerOpen: true,
          }));
        }),
      requestGlobalBasePath: (req) => get().requestGlobalBasePath(req),
      requestCommandVariables: (req) => get().requestCommandVariables(req),
      requestUserOptions: (req) =>
        new Promise<OptionPromptResponse>((resolve) => {
          set({
            pendingOptionPrompt: {
              ...req,
              id: `opt_${crypto.randomUUID().slice(0, 8)}`,
              resolve,
            },
            aiDrawerOpen: true,
          });
        }),
      onOptionCardResolved: (card) => {
        set((s) => ({
          aiLiveOptionCards: [...s.aiLiveOptionCards, card],
        }));
      },
      onTemplateExported: (tpl) => {
        set((s) => ({
          aiLiveExportedTemplates: [...s.aiLiveExportedTemplates, tpl],
        }));
      },
    };

    try {
      const result = await runAgentTurn({
        history: historyBefore,
        userText: trimmed,
        mentions: resolvedMentions,
        provider: activeProvider,
        ctx: toolCtx,
        signal: abortController.signal,
        onTraceUpdate: (traces) => set({ aiLiveTraces: traces }),
        onStreamText: (streamedText) => set({ aiStreamingText: streamedText }),
      });

      // Re-sync persisted projects & commands from storage to guarantee UI reflects durable state
      await get().refreshWorkspace();

      // If user clicked New Chat while the turn was running, discard stale completion cleanly
      if (get().chatSessionId !== sessionId) {
        set({
          activeAgentAbortController: null,
          aiBusy: false,
          aiLiveTraces: [],
          aiStreamingText: "",
          aiLiveOptionCards: [],
          aiLiveSuggestions: [],
          aiLiveExportedTemplates: [],
          pendingOptionPrompt: null,
        });
        return;
      }

      const shouldRunAdvisor = Boolean(result.advisorTrigger) && !result.aborted;
      const messageId = `msg_${crypto.randomUUID().slice(0, 8)}`;

      const assistantMsg: ChatMessage = {
        id: messageId,
        role: "assistant",
        content: result.text,
        timestamp: new Date().toISOString(),
        toolTraces: result.traces.length > 0 ? result.traces : undefined,
        optionCards: result.optionCards.length > 0 ? result.optionCards : undefined,
        completionChips:
          result.completionChips.length > 0 ? result.completionChips : undefined,
        exportedTemplates:
          result.exportedTemplates.length > 0 ? result.exportedTemplates : undefined,
        suggestionsLoading: shouldRunAdvisor || undefined,
      };

      set((s) => ({
        chatMessages: [...s.chatMessages, assistantMsg],
        activeAgentAbortController: null,
        aiBusy: false,
        aiLiveTraces: [],
        aiStreamingText: "",
        aiLiveOptionCards: [],
        aiLiveSuggestions: [],
        aiLiveExportedTemplates: [],
        pendingOptionPrompt: null,
      }));
      scheduleSessionPersist(get);

      // Fire Advisor Sub-Agent asynchronously in background without blocking the primary turn
      if (shouldRunAdvisor && result.advisorTrigger) {
        runBackgroundAdvisor({
          messageId,
          projectId: result.advisorTrigger.projectId,
          projectName: result.advisorTrigger.projectName,
          basePath: result.advisorTrigger.basePath,
          engine: result.advisorTrigger.engine,
          userGoal: result.advisorTrigger.userGoal,
          provider: activeProvider,
        });
      }
    } catch (err) {
      if (get().chatSessionId !== sessionId) {
        set({
          activeAgentAbortController: null,
          aiBusy: false,
          aiLiveTraces: [],
          aiStreamingText: "",
          aiLiveOptionCards: [],
          aiLiveSuggestions: [],
          aiLiveExportedTemplates: [],
          pendingOptionPrompt: null,
        });
        return;
      }

      const errText = err instanceof Error ? err.message : String(err);
      const errMsg: ChatMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: "assistant",
        content: `Error: ${errText}`,
        timestamp: new Date().toISOString(),
        toolTraces: get().aiLiveTraces.length > 0 ? get().aiLiveTraces : undefined,
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, errMsg],
        activeAgentAbortController: null,
        aiBusy: false,
        aiLiveTraces: [],
        aiStreamingText: "",
        aiLiveOptionCards: [],
        aiLiveSuggestions: [],
        aiLiveExportedTemplates: [],
        pendingOptionPrompt: null,
      }));
      scheduleSessionPersist(get);
    }
  },

  stopAgentTurn: () => {
    const controller = get().activeAgentAbortController;
    if (controller) {
      controller.abort();
    }

    // Unblock any pending approval cards or option prompts cleanly when user hits Stop
    const approvals = get().pendingApprovals;
    if (approvals.length > 0) {
      set({ pendingApprovals: [] });
      for (const item of approvals) {
        if (item.batchCommands && item.batchCommands.length > 0) {
          item.resolve([]);
        } else {
          item.resolve(false);
        }
      }
    }

    const optPrompt = get().pendingOptionPrompt;
    if (optPrompt) {
      set({ pendingOptionPrompt: null });
      optPrompt.resolve({ selectedIds: [], selectedLabels: [], cancelled: true });
    }
  },

  explainExecutionError: async (executionId) => {
    const execution = get().executions.find((e) => e.id === executionId);
    if (!execution || get().aiBusy) return;

    const activeProvider =
      get().settings.providers.find((p) => p.id === get().settings.activeProviderId) ??
      get().settings.providers[0];

    if (!activeProvider || activeProvider.secretStatus !== "configured") {
      set({
        aiDrawerOpen: true,
        providerSetupModalOpen: true,
        providerSetupInitialPreset: activeProvider?.providerType ?? "gemini",
      });
      return;
    }

    const sessionId = get().chatSessionId;
    set({ aiDrawerOpen: true, aiBusy: true });

    const lines = get().consoleLinesByExec[executionId];
    const rawOutput =
      lines && lines.length > 0
        ? lines.map((l) => l.text.replace(/\x1b\[[0-9;]*m/g, "")).join("\n")
        : await runtimeBridge.getExecutionLog(executionId);

    const userMsg: ChatMessage = {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      role: "user",
      content: `Explain error for execution \`${execution.commandText}\` (exit code ${execution.exitCode ?? "?"})`,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ chatMessages: [...s.chatMessages, userMsg] }));

    try {
      const analysis = await analyzeExecutionError({
        execution,
        rawOutput,
        provider: activeProvider,
      });

      if (get().chatSessionId !== sessionId) {
        set({ aiBusy: false });
        return;
      }

      const replyId = `msg_${crypto.randomUUID().slice(0, 8)}`;
      const reply: ChatMessage = {
        id: replyId,
        role: "assistant",
        content: analysis,
        timestamp: new Date().toISOString(),
        suggestionsLoading: true,
        toolTraces: [
          {
            id: `trace_${crypto.randomUUID().slice(0, 8)}`,
            toolName: "analyze_execution_error",
            args: { executionId },
            status: "completed",
            summary: `Analyzed exit code ${execution.exitCode ?? "?"} inside untrusted-output isolation`,
          },
        ],
      };

      set((s) => ({
        chatMessages: [...s.chatMessages, reply],
        aiBusy: false,
      }));
      scheduleSessionPersist(get);

      // Run background Advisor Sub-Agent for follow-up fix/diagnostic commands
      const proj = execution.projectId
        ? get().projects.find((p) => p.id === execution.projectId)
        : null;
      void (async () => {
        try {
          if (get().chatSessionId !== sessionId) return;
          const existingInStore = get()
            .commands.filter((c) => c.projectId === execution.projectId)
            .flatMap((c) => [c.name, c.command]);

          const suggestions = await runCommandAdvisorSubagent({
            projectId: execution.projectId,
            projectName: proj?.name ?? "Global Root",
            basePath: proj?.basePath ?? execution.basePath,
            engine: execution.engine,
            existingCommands: existingInStore,
            userGoal: `Fix or diagnose failed command "${execution.commandText}" (exit code ${execution.exitCode ?? "?"})`,
            provider: activeProvider,
          });

          if (get().chatSessionId !== sessionId) return;
          if (suggestions.length > 0) {
            set((s) => {
              if (s.chatSessionId !== sessionId) return s;
              if (!s.chatMessages.some((m) => m.id === replyId)) return s;
              return {
                chatMessages: s.chatMessages.map((m) =>
                  m.id === replyId ? { ...m, suggestions, suggestionsLoading: false } : m
                ),
              };
            });
          }
        } catch {
          // Silent fallback on 429 or transient error
        } finally {
          if (get().chatSessionId === sessionId) {
            set((s) => {
              if (s.chatSessionId !== sessionId) return s;
              if (!s.chatMessages.some((m) => m.id === replyId)) return s;
              return {
                chatMessages: s.chatMessages.map((m) =>
                  m.id === replyId && m.suggestionsLoading
                    ? { ...m, suggestionsLoading: false }
                    : m
                ),
              };
            });
            scheduleSessionPersist(get);
          }
        }
      })();
    } catch (err) {
      if (get().chatSessionId !== sessionId) {
        set({ aiBusy: false });
        return;
      }
      const errReply: ChatMessage = {
        id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        role: "assistant",
        content: `Error analyzing execution: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toISOString(),
      };
      set((s) => ({
        chatMessages: [...s.chatMessages, errReply],
        aiBusy: false,
      }));
      scheduleSessionPersist(get);
    }
  },

  clearChatHistory: () => {
    get().stopAgentTurn();
    set((s) => ({
      chatSessionId: s.chatSessionId + 1,
      activeAgentAbortController: null,
      aiBusy: false,
      chatMessages: [],
      aiLiveTraces: [],
      aiStreamingText: "",
      aiLiveOptionCards: [],
      aiLiveSuggestions: [],
      aiLiveExportedTemplates: [],
      pendingOptionPrompt: null,
    }));
    scheduleSessionPersist(get);
  },
}));
