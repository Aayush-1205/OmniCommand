import { tool } from "ai";
import type {
  AgentPermissionMode,
  BatchApprovalCommandPreview,
  CommandItem,
  CompletionChip,
  EngineType,
  ExecutionRecord,
  OptionChoiceItem,
  OptionPromptResponse,
  Project,
  ProviderConfig,
  ResolvedOptionCard,
  RiskLevel,
  RunPolicy,
  SuggestedCommandItem,
  VariablePromptItem,
} from "../types/omnicommand";
import { runtimeBridge } from "../lib/bridge";
import {
  interpolateCommandVariables,
  parseCommandVariables,
  saveLastVariableValues,
} from "../lib/variables";
import { evaluateToolPolicy } from "./policyGate";
import { analyzeExecutionError } from "./errorAnalyzer";
import { runCommandAdvisorSubagent } from "./commandAdvisorSubagent";
import {
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  type OmniToolName,
} from "./toolSchemas";

export { TOOL_SCHEMAS, TOOL_DESCRIPTIONS, type OmniToolName };

export interface ToolExecutionContext {
  getState: () => {
    projects: Project[];
    commands: CommandItem[];
    executions: ExecutionRecord[];
    selectedProjectId: string | null;
    agentPermissionMode: AgentPermissionMode;
    activeProvider: ProviderConfig;
    commandTimeoutSec: number;
  };
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
  executeCommand: (params: {
    engine: EngineType;
    commandText: string;
    basePath: string;
    commandId: string | null;
    projectId: string | null;
    triggeredBy: "ai";
  }) => Promise<ExecutionRecord>;
  requestApproval: (req: {
    toolName: string;
    title: string;
    commandText?: string;
    engine?: EngineType;
    basePath?: string;
    riskLevel: RiskLevel;
    reason: string;
    details: Record<string, unknown>;
  }) => Promise<boolean>;
  requestBatchCommandApproval: (req: {
    toolName: string;
    title: string;
    basePath?: string;
    riskLevel: RiskLevel;
    reason: string;
    details: Record<string, unknown>;
    batchCommands: BatchApprovalCommandPreview[];
  }) => Promise<string[]>;
  requestGlobalBasePath: (req: {
    title: string;
    commandName?: string;
  }) => Promise<string | null>;
  requestCommandVariables: (req: {
    title: string;
    commandName?: string;
    commandTemplate: string;
    engine: EngineType;
    variables: VariablePromptItem[];
    initialValues?: Record<string, string>;
  }) => Promise<Record<string, string> | null>;
  requestUserOptions: (req: {
    question: string;
    selectionType: "single" | "multiple";
    displayAs: "buttons" | "select";
    options: OptionChoiceItem[];
    allowCustomInput?: boolean;
  }) => Promise<OptionPromptResponse>;
  onToolEvent?: (evt: {
    traceId?: string;
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
  }) => void;
  onOptionCardResolved?: (card: ResolvedOptionCard) => void;
  onCompletionEvent?: (chip: CompletionChip) => void;
  onSuggestionsGenerated?: (suggestions: SuggestedCommandItem[]) => void;
}

/**
 * Unified executor for all 16 OmniCommand AI tools, shared by both
 * Vercel AI SDK (Tauri desktop) and the dev preview function-calling loop.
 * Never swallows tool errors — returns structured `{ success: false, error }`
 * and surfaces errors inline in the chat trace UI.
 */
export async function executeOmniTool(
  toolName: OmniToolName,
  rawArgs: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<Record<string, unknown>> {
  const state = ctx.getState();
  const traceId = `trace_${crypto.randomUUID().slice(0, 8)}`;

  const report = (
    status:
      | "pending_approval"
      | "running"
      | "completed"
      | "rejected"
      | "blocked"
      | "cancelled"
      | "error",
    summary?: string,
    error?: string
  ) => ctx.onToolEvent?.({ traceId, toolName, args: rawArgs, status, summary, error });

  try {
    switch (toolName) {
      case "list_projects": {
        report("completed", `Returned ${state.projects.length} project(s)`);
        return { success: true, projects: state.projects };
      }

      case "validate_local_path": {
        const parsed = TOOL_SCHEMAS.validate_local_path.parse(rawArgs);
        const res = await runtimeBridge.validatePath(parsed.path, false);
        report("completed", res.valid ? "Valid path" : res.blockedReason ?? "Invalid path");
        return { success: res.valid, ...res };
      }

      case "list_commands": {
        const parsed = TOOL_SCHEMAS.list_commands.parse(rawArgs);
        let cmds = state.commands;
        if (parsed.projectId === "global") {
          cmds = cmds.filter((c) => c.projectId === null);
        } else if (parsed.projectId) {
          cmds = cmds.filter((c) => c.projectId === parsed.projectId);
        }
        if (parsed.engine) {
          cmds = cmds.filter((c) => c.engine === parsed.engine);
        }
        report("completed", `Returned ${cmds.length} command(s)`);
        return { success: true, commands: cmds };
      }

      case "list_available_engines": {
        const engines = await runtimeBridge.listAvailableEngines();
        report("completed", `${engines.filter((e) => e.available).length} engines available`);
        return { success: true, engines };
      }

      case "ask_user_options": {
        const parsed = TOOL_SCHEMAS.ask_user_options.parse(rawArgs);
        report("pending_approval", `Waiting for selection: ${parsed.question}`);
        const response = await ctx.requestUserOptions({
          question: parsed.question,
          selectionType: parsed.selectionType,
          displayAs: parsed.displayAs,
          options: parsed.options,
          allowCustomInput: parsed.allowCustomInput,
        });

        ctx.onOptionCardResolved?.({
          id: `opt_${crypto.randomUUID().slice(0, 8)}`,
          question: parsed.question,
          selectedLabels: response.selectedLabels,
          customValue: response.customValue,
          cancelled: response.cancelled,
        });

        if (response.cancelled) {
          report("cancelled", "User dismissed options");
          return {
            success: false,
            status: "cancelled",
            reason: "User dismissed the options prompt.",
          };
        }

        const labelSummary = response.customValue
          ? response.customValue
          : response.selectedLabels.join(", ");
        report("completed", `Selected: ${labelSummary}`);
        return {
          success: true,
          status: "selected",
          selectedIds: response.selectedIds,
          selectedLabels: response.selectedLabels,
          ...(response.customValue ? { customValue: response.customValue } : {}),
        };
      }

      case "create_project": {
        const parsed = TOOL_SCHEMAS.create_project.parse(rawArgs);
        const pathCheck = await runtimeBridge.validatePath(parsed.basePath, false);
        if (!pathCheck.valid) {
          const reason = pathCheck.blockedReason ?? "Invalid or blocked basePath.";
          report("error", reason, reason);
          return { success: false, status: "blocked", error: reason };
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: state.agentPermissionMode,
          riskLevel: "low",
        });
        if (policy.decision === "ask") {
          report("pending_approval", `Create Project: ${parsed.name}`);
          const approved = await ctx.requestApproval({
            toolName,
            title: `Create Project: ${parsed.name}`,
            engine: parsed.defaultEngine,
            basePath: pathCheck.canonicalPath ?? parsed.basePath,
            riskLevel: "low",
            reason: policy.reason,
            details: parsed,
          });
          if (!approved) {
            report("rejected", `Rejected project "${parsed.name}"`);
            return {
              success: false,
              status: "rejected",
              error: "User rejected create_project.",
            };
          }
        }

        report("running", `Creating project "${parsed.name}"...`);
        const project = await ctx.createProject({
          name: parsed.name,
          basePath: pathCheck.canonicalPath ?? parsed.basePath,
          defaultEngine: parsed.defaultEngine,
        });

        ctx.onCompletionEvent?.({
          id: `chip_proj_${project.id}`,
          kind: "project",
          label: `Project: ${project.name}`,
          projectId: project.id,
        });
        report("completed", `Created project "${project.name}" (${project.id})`);
        return {
          success: true,
          status: "created",
          projectId: project.id,
          project,
        };
      }

      case "update_project": {
        const parsed = TOOL_SCHEMAS.update_project.parse(rawArgs);
        const existing = state.projects.find((p) => p.id === parsed.projectId);
        if (!existing) {
          const err = `Project "${parsed.projectId}" not found.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }
        if (parsed.basePath) {
          const check = await runtimeBridge.validatePath(parsed.basePath, false);
          if (!check.valid) {
            const reason = check.blockedReason ?? "Blocked path";
            report("error", reason, reason);
            return { success: false, status: "blocked", error: reason };
          }
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: state.agentPermissionMode,
          riskLevel: "low",
        });
        if (policy.decision === "ask") {
          report("pending_approval", `Update Project: ${existing.name}`);
          const approved = await ctx.requestApproval({
            toolName,
            title: `Update Project: ${existing.name}`,
            engine: parsed.defaultEngine ?? existing.defaultEngine,
            basePath: parsed.basePath ?? existing.basePath,
            riskLevel: "low",
            reason: policy.reason,
            details: parsed,
          });
          if (!approved) {
            report("rejected", "User rejected project update");
            return { success: false, status: "rejected", error: "User rejected update_project." };
          }
        }

        report("running", `Updating project "${existing.name}"...`);
        const updated = await ctx.updateProject(parsed.projectId, {
          name: parsed.name,
          basePath: parsed.basePath,
          defaultEngine: parsed.defaultEngine,
        });

        ctx.onCompletionEvent?.({
          id: `chip_proj_${updated.id}`,
          kind: "project",
          label: `Project: ${updated.name}`,
          projectId: updated.id,
        });
        report("completed", `Updated project "${updated.name}"`);
        return { success: true, status: "updated", project: updated };
      }

      case "delete_project": {
        const parsed = TOOL_SCHEMAS.delete_project.parse(rawArgs);
        const existing = state.projects.find((p) => p.id === parsed.projectId);
        if (!existing) {
          const err = `Project "${parsed.projectId}" not found.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        report("pending_approval", `Delete Project: ${existing.name}`);
        const approved = await ctx.requestApproval({
          toolName,
          title: `Delete Project: ${existing.name}`,
          basePath: existing.basePath,
          riskLevel: "high",
          reason: "Deleting a project always requires explicit confirmation.",
          details: parsed,
        });
        if (!approved) {
          report("rejected", "User rejected project deletion");
          return { success: false, status: "rejected", error: "User rejected delete_project." };
        }

        await ctx.deleteProject(parsed.projectId);
        report("completed", `Deleted project "${existing.name}"`);
        return { success: true, status: "deleted", projectId: parsed.projectId };
      }

      case "create_command": {
        const parsed = TOOL_SCHEMAS.create_command.parse(rawArgs);
        const guardrail = await runtimeBridge.checkGuardrails(parsed.command);
        if (guardrail.blocked) {
          const reason = guardrail.reason ?? "Blocked by security guardrail.";
          report("blocked", reason, reason);
          return { success: false, status: "blocked", error: reason };
        }

        // Re-read fresh state so a project created in an earlier step is immediately visible!
        const freshState = ctx.getState();
        const targetProjectId =
          parsed.projectId === "global" || !parsed.projectId ? null : parsed.projectId;
        const targetProject = freshState.projects.find((p) => p.id === targetProjectId);

        if (targetProjectId && !targetProject) {
          const err = `Project "${targetProjectId}" does not exist. Create the project first or pass projectId: null for Global Root.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: freshState.agentPermissionMode,
          riskLevel: parsed.riskLevel,
        });
        if (policy.decision === "ask") {
          report("pending_approval", `Add Command: ${parsed.name}`);
          const approved = await ctx.requestApproval({
            toolName,
            title: `Add Command: ${parsed.name}`,
            commandText: parsed.command,
            engine: parsed.engine,
            basePath: targetProject ? targetProject.basePath : "Global Root (prompts on run)",
            riskLevel: parsed.riskLevel,
            reason: policy.reason,
            details: parsed,
          });
          if (!approved) {
            report("rejected", `Rejected command "${parsed.name}"`);
            return {
              success: false,
              status: "rejected",
              error: `User rejected create_command for "${parsed.name}".`,
            };
          }
        }

        report("running", `Saving command "${parsed.name}"...`);
        const cmd = await ctx.createCommand({
          projectId: targetProjectId,
          name: parsed.name,
          alias: parsed.alias ?? parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          command: parsed.command,
          engine: parsed.engine,
          riskLevel: parsed.riskLevel,
          runPolicy: parsed.runPolicy,
          aiAllowed: parsed.aiAllowed,
          description: parsed.description ?? "",
        });

        ctx.onCompletionEvent?.({
          id: `chip_cmd_${cmd.id}`,
          kind: "commands",
          label: `Command: ${cmd.name}`,
          projectId: cmd.projectId,
          commandId: cmd.id,
        });
        report("completed", `Saved command "${cmd.name}"`);
        return { success: true, status: "created", commandId: cmd.id, command: cmd };
      }

      case "create_commands_batch": {
        const parsed = TOOL_SCHEMAS.create_commands_batch.parse(rawArgs);
        const freshState = ctx.getState();

        const targetProjectId =
          parsed.projectId === "global" || !parsed.projectId ? null : parsed.projectId;
        const targetProject = freshState.projects.find((p) => p.id === targetProjectId);

        if (targetProjectId && !targetProject) {
          const err = `Project "${targetProjectId}" does not exist. Create the project first or pass projectId: null for Global Root.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        // Guardrail-check every command in the batch first
        for (const item of parsed.commands) {
          const guardrail = await runtimeBridge.checkGuardrails(item.command);
          if (guardrail.blocked) {
            const reason = `Blocked command "${item.name}": ${guardrail.reason ?? "security guardrail"}`;
            report("blocked", reason, reason);
            return { success: false, status: "blocked", error: reason };
          }
        }

        const highestRisk: RiskLevel = parsed.commands.some((c) => c.riskLevel === "high")
          ? "high"
          : parsed.commands.some((c) => c.riskLevel === "medium")
            ? "medium"
            : "low";

        const normalizedItems = parsed.commands.map((item, idx) => ({
          previewId: `batch_${idx}_${crypto.randomUUID().slice(0, 6)}`,
          name: item.name.trim(),
          alias:
            item.alias?.trim() ||
            item.name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-"),
          command: item.command.trim(),
          engine: item.engine,
          riskLevel: item.riskLevel,
          runPolicy: item.runPolicy,
          aiAllowed: item.aiAllowed,
          description: item.description?.trim() ?? "",
        }));

        const policy = evaluateToolPolicy({
          toolName,
          mode: freshState.agentPermissionMode,
          riskLevel: highestRisk,
        });

        let approvedItems = normalizedItems;
        let rejectedNames: string[] = [];

        if (policy.decision === "ask") {
          report(
            "pending_approval",
            `Add ${normalizedItems.length} commands to ${targetProject ? targetProject.name : "Global Root"}`
          );
          const approvedIds = await ctx.requestBatchCommandApproval({
            toolName,
            title: `Add ${normalizedItems.length} commands${targetProject ? ` to ${targetProject.name}` : " to Global Root"}`,
            basePath: targetProject ? targetProject.basePath : "Global Root (prompts on run)",
            riskLevel: highestRisk,
            reason: policy.reason,
            details: parsed,
            batchCommands: normalizedItems.map((i) => ({
              id: i.previewId,
              name: i.name,
              alias: i.alias,
              command: i.command,
              engine: i.engine,
              riskLevel: i.riskLevel,
              description: i.description,
            })),
          });

          const approvedSet = new Set(approvedIds);
          approvedItems = normalizedItems.filter((i) => approvedSet.has(i.previewId));
          rejectedNames = normalizedItems
            .filter((i) => !approvedSet.has(i.previewId))
            .map((i) => i.name);

          if (approvedItems.length === 0) {
            report("rejected", `Rejected all ${normalizedItems.length} commands`);
            return {
              success: false,
              status: "rejected",
              error: `User rejected all ${normalizedItems.length} commands in create_commands_batch.`,
            };
          }
        }

        report("running", `Saving ${approvedItems.length} commands atomically...`);
        const created = await ctx.createCommandsBatch({
          projectId: targetProjectId,
          commands: approvedItems.map(({ previewId: _ignore, ...rest }) => rest),
        });

        for (const cmd of created) {
          ctx.onCompletionEvent?.({
            id: `chip_cmd_${cmd.id}`,
            kind: "commands",
            label: `Command: ${cmd.name}`,
            projectId: cmd.projectId,
            commandId: cmd.id,
          });
        }

        report(
          "completed",
          `Saved ${created.length} command${created.length === 1 ? "" : "s"}${rejectedNames.length > 0 ? ` (${rejectedNames.length} skipped)` : ""}`
        );
        return {
          success: true,
          status: "created",
          count: created.length,
          commands: created,
          ...(rejectedNames.length > 0 ? { rejectedCommands: rejectedNames } : {}),
        };
      }

      case "update_command": {
        const parsed = TOOL_SCHEMAS.update_command.parse(rawArgs);
        const freshState = ctx.getState();
        const existing = freshState.commands.find((c) => c.id === parsed.commandId);
        if (!existing) {
          const err = `Command "${parsed.commandId}" not found.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }
        if (parsed.command) {
          const guardrail = await runtimeBridge.checkGuardrails(parsed.command);
          if (guardrail.blocked) {
            const reason = guardrail.reason ?? "Blocked by guardrail";
            report("blocked", reason, reason);
            return { success: false, status: "blocked", error: reason };
          }
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: freshState.agentPermissionMode,
          riskLevel: parsed.riskLevel ?? existing.riskLevel,
        });
        if (policy.decision === "ask") {
          report("pending_approval", `Update Command: ${existing.name}`);
          const approved = await ctx.requestApproval({
            toolName,
            title: `Update Command: ${existing.name}`,
            commandText: parsed.command ?? existing.command,
            engine: parsed.engine ?? existing.engine,
            riskLevel: parsed.riskLevel ?? existing.riskLevel,
            reason: policy.reason,
            details: parsed,
          });
          if (!approved) {
            report("rejected", "User rejected command update");
            return { success: false, status: "rejected", error: "User rejected update_command." };
          }
        }

        const updated = await ctx.updateCommand(parsed.commandId, {
          name: parsed.name,
          alias: parsed.alias,
          command: parsed.command,
          engine: parsed.engine,
          riskLevel: parsed.riskLevel,
          runPolicy: parsed.runPolicy,
          aiAllowed: parsed.aiAllowed,
          description: parsed.description,
        });

        ctx.onCompletionEvent?.({
          id: `chip_cmd_${updated.id}`,
          kind: "commands",
          label: `Updated: ${updated.name}`,
          projectId: updated.projectId,
          commandId: updated.id,
        });
        report("completed", `Updated command "${updated.name}"`);
        return { success: true, status: "updated", command: updated };
      }

      case "delete_command": {
        const parsed = TOOL_SCHEMAS.delete_command.parse(rawArgs);
        const freshState = ctx.getState();
        const existing = freshState.commands.find((c) => c.id === parsed.commandId);
        if (!existing) {
          const err = `Command "${parsed.commandId}" not found.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        report("pending_approval", `Delete Command: ${existing.name}`);
        const approved = await ctx.requestApproval({
          toolName,
          title: `Delete Command: ${existing.name}`,
          commandText: existing.command,
          engine: existing.engine,
          riskLevel: "high",
          reason: "Deleting a stored command always requires explicit confirmation.",
          details: parsed,
        });
        if (!approved) {
          report("rejected", "User rejected command deletion");
          return { success: false, status: "rejected", error: "User rejected delete_command." };
        }

        await ctx.deleteCommand(parsed.commandId);
        report("completed", `Deleted command "${existing.name}"`);
        return { success: true, status: "deleted", commandId: parsed.commandId };
      }

      case "run_stored_command": {
        const parsed = TOOL_SCHEMAS.run_stored_command.parse(rawArgs);
        const freshState = ctx.getState();
        const cmd = freshState.commands.find((c) => c.id === parsed.commandId);
        if (!cmd) {
          const err = `Stored command "${parsed.commandId}" not found.`;
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        let finalCommand = cmd.command;
        const parsedVars = parseCommandVariables(cmd.command);
        if (parsedVars.length > 0) {
          const provided = parsed.variables ?? {};
          const missingRequired = parsedVars.some(
            (v) => v.defaultValue === undefined && !(provided[v.name] ?? "").trim()
          );

          let resolvedValues: Record<string, string> = { ...provided };
          if (missingRequired) {
            report("pending_approval", `Awaiting variable inputs for "${cmd.name}"`);
            const prompted = await ctx.requestCommandVariables({
              title: "Fill Command Variables",
              commandName: cmd.name,
              commandTemplate: cmd.command,
              engine: cmd.engine,
              variables: parsedVars,
              initialValues: provided,
            });
            if (!prompted) {
              report("cancelled", "User cancelled command variable input");
              return {
                success: false,
                status: "cancelled",
                error: "User cancelled variable input for stored command.",
              };
            }
            resolvedValues = prompted;
          } else {
            saveLastVariableValues(resolvedValues);
          }

          finalCommand = interpolateCommandVariables(cmd.command, resolvedValues);
        }

        const guardrail = await runtimeBridge.checkGuardrails(finalCommand);
        if (guardrail.blocked) {
          const reason = guardrail.reason ?? "Blocked by security guardrail";
          report("blocked", reason, reason);
          return { success: false, status: "blocked", error: reason };
        }

        let resolvedBasePath = parsed.basePath;
        if (!resolvedBasePath) {
          if (cmd.projectId) {
            const project = freshState.projects.find((p) => p.id === cmd.projectId);
            resolvedBasePath = project?.basePath;
          } else if (freshState.selectedProjectId) {
            const activeProject = freshState.projects.find(
              (p) => p.id === freshState.selectedProjectId
            );
            resolvedBasePath = activeProject?.basePath;
          }
        }

        if (!resolvedBasePath) {
          const picked = await ctx.requestGlobalBasePath({
            title: `Select directory for "${cmd.name}"`,
            commandName: cmd.name,
          });
          if (!picked) {
            report("cancelled", "User cancelled Global Root directory selection");
            return {
              success: false,
              status: "cancelled",
              error: "User cancelled directory selection for Global Root command.",
            };
          }
          resolvedBasePath = picked;
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: freshState.agentPermissionMode,
          storedCommand: cmd,
          resolvedCommandText: finalCommand,
          riskLevel: cmd.riskLevel,
        });
        if (policy.decision === "block") {
          report("blocked", policy.reason, policy.reason);
          return { success: false, status: "blocked", error: policy.reason };
        }
        if (policy.decision === "ask") {
          report("pending_approval", `Run Command: ${cmd.name}`);
          const approved = await ctx.requestApproval({
            toolName,
            title: `Run Command: ${cmd.name}`,
            commandText: finalCommand,
            engine: cmd.engine,
            basePath: resolvedBasePath,
            riskLevel: cmd.riskLevel,
            reason: policy.reason,
            details: { commandId: cmd.id, basePath: resolvedBasePath, commandText: finalCommand },
          });
          if (!approved) {
            report("rejected", "User rejected command execution");
            return { success: false, status: "rejected", error: "User rejected run_stored_command." };
          }
        }

        report("running", `Executing "${cmd.name}"`);
        const execution = await ctx.executeCommand({
          engine: cmd.engine,
          commandText: finalCommand,
          basePath: resolvedBasePath,
          commandId: cmd.id,
          projectId: cmd.projectId,
          triggeredBy: "ai",
        });

        ctx.onCompletionEvent?.({
          id: `chip_exec_${execution.id}`,
          kind: "execution",
          label: `Ran: ${cmd.name}`,
          executionId: execution.id,
        });
        report("completed", `Started execution ${execution.id}`);
        return { success: true, status: "started", execution };
      }

      case "run_adhoc_command": {
        const parsed = TOOL_SCHEMAS.run_adhoc_command.parse(rawArgs);
        const freshState = ctx.getState();
        let finalCommand = parsed.command;
        const parsedVars = parseCommandVariables(parsed.command);
        if (parsedVars.length > 0) {
          report("pending_approval", "Awaiting variable inputs for ad-hoc command");
          const prompted = await ctx.requestCommandVariables({
            title: "Fill Command Variables",
            commandName: "Ad-hoc command",
            commandTemplate: parsed.command,
            engine: parsed.engine,
            variables: parsedVars,
          });
          if (!prompted) {
            report("cancelled", "User cancelled command variable input");
            return {
              success: false,
              status: "cancelled",
              error: "User cancelled variable input for ad-hoc command.",
            };
          }
          finalCommand = interpolateCommandVariables(parsed.command, prompted);
        }

        const guardrail = await runtimeBridge.checkGuardrails(finalCommand);
        if (guardrail.blocked) {
          const reason = guardrail.reason ?? "Blocked by security guardrail";
          report("blocked", reason, reason);
          return { success: false, status: "blocked", error: reason };
        }

        let resolvedBasePath = parsed.basePath;
        if (!resolvedBasePath && freshState.selectedProjectId) {
          resolvedBasePath = freshState.projects.find(
            (p) => p.id === freshState.selectedProjectId
          )?.basePath;
        }

        if (!resolvedBasePath) {
          const picked = await ctx.requestGlobalBasePath({
            title: "Select directory for ad-hoc command",
            commandName: finalCommand,
          });
          if (!picked) {
            report("cancelled", "User cancelled directory selection");
            return {
              success: false,
              status: "cancelled",
              error: "User cancelled directory selection for ad-hoc command.",
            };
          }
          resolvedBasePath = picked;
        }

        const policy = evaluateToolPolicy({
          toolName,
          mode: freshState.agentPermissionMode,
          adhocCommandText: finalCommand,
          resolvedCommandText: finalCommand,
          riskLevel: parsed.riskLevel,
        });
        if (policy.decision === "block") {
          report("blocked", policy.reason, policy.reason);
          return { success: false, status: "blocked", error: policy.reason };
        }
        if (policy.decision === "ask") {
          report("pending_approval", "Run ad-hoc command");
          const approved = await ctx.requestApproval({
            toolName,
            title: "Run Ad-Hoc Command",
            commandText: finalCommand,
            engine: parsed.engine,
            basePath: resolvedBasePath,
            riskLevel: parsed.riskLevel,
            reason: policy.reason,
            details: { ...parsed, command: finalCommand, basePath: resolvedBasePath },
          });
          if (!approved) {
            report("rejected", "User rejected ad-hoc command");
            return { success: false, status: "rejected", error: "User rejected run_adhoc_command." };
          }
        }

        report("running", `Executing ad-hoc ${parsed.engine} command`);
        const execution = await ctx.executeCommand({
          engine: parsed.engine,
          commandText: finalCommand,
          basePath: resolvedBasePath,
          commandId: null,
          projectId: freshState.selectedProjectId,
          triggeredBy: "ai",
        });

        ctx.onCompletionEvent?.({
          id: `chip_exec_${execution.id}`,
          kind: "execution",
          label: `Ran: ${finalCommand.slice(0, 28)}`,
          executionId: execution.id,
        });
        report("completed", `Started execution ${execution.id}`);
        return { success: true, status: "started", execution };
      }

      case "stop_execution": {
        const parsed = TOOL_SCHEMAS.stop_execution.parse(rawArgs);
        const stopped = await runtimeBridge.stopExecution(parsed.executionId);
        report("completed", stopped ? "Process tree terminated" : "Execution was not active");
        return {
          success: true,
          status: stopped ? "killed" : "not_running",
          executionId: parsed.executionId,
        };
      }

      case "get_execution_logs": {
        const parsed = TOOL_SCHEMAS.get_execution_logs.parse(rawArgs);
        const freshState = ctx.getState();
        const target = parsed.executionId
          ? freshState.executions.find((e) => e.id === parsed.executionId)
          : freshState.executions[0];
        if (!target) {
          report("completed", "No executions found");
          return {
            success: false,
            status: "not_found",
            error: "No execution records available yet.",
          };
        }
        const logTail = await runtimeBridge.getExecutionLog(target.id);
        report("completed", `Read logs for ${target.id} (exit ${target.exitCode ?? "running"})`);
        return {
          success: true,
          execution: target,
          logTail: logTail.slice(-8000),
        };
      }

      case "analyze_execution_error": {
        const parsed = TOOL_SCHEMAS.analyze_execution_error.parse(rawArgs);
        const freshState = ctx.getState();
        const target = freshState.executions.find((e) => e.id === parsed.executionId);
        if (!target) {
          const err = `Execution "${parsed.executionId}" not found.`;
          report("error", err, err);
          return { success: false, status: "not_found", error: err };
        }
        const rawOutput = await runtimeBridge.getExecutionLog(target.id);
        const analysis = await analyzeExecutionError({
          execution: target,
          rawOutput,
          provider: freshState.activeProvider,
        });
        report("completed", `Analyzed error for ${target.id}`);
        return { success: true, executionId: target.id, exitCode: target.exitCode, analysis };
      }

      case "suggest_next_commands": {
        const parsed = TOOL_SCHEMAS.suggest_next_commands.parse(rawArgs);
        const freshState = ctx.getState();

        const targetProjectId =
          parsed.projectId === "global"
            ? null
            : parsed.projectId !== undefined
              ? parsed.projectId
              : freshState.selectedProjectId;
        const matchedProject = targetProjectId
          ? freshState.projects.find((p) => p.id === targetProjectId)
          : freshState.projects.find(
              (p) => p.name.toLowerCase() === parsed.projectName.toLowerCase()
            );

        const resolvedProjectId = matchedProject ? matchedProject.id : targetProjectId ?? null;
        const existingInStore = freshState.commands
          .filter((c) => c.projectId === resolvedProjectId)
          .flatMap((c) => [c.name, c.command]);
        const mergedExisting = Array.from(
          new Set([...parsed.existingCommands, ...existingInStore])
        );

        report("running", `Consulting Advisor Sub-Agent for ${parsed.projectName}...`);
        const suggestions = await runCommandAdvisorSubagent({
          projectId: resolvedProjectId,
          projectName: matchedProject?.name ?? parsed.projectName,
          basePath: matchedProject?.basePath ?? parsed.basePath,
          engine: parsed.engine ?? matchedProject?.defaultEngine ?? "powershell",
          existingCommands: mergedExisting,
          userGoal: parsed.userGoal,
          provider: freshState.activeProvider,
        });

        if (suggestions.length > 0) {
          ctx.onSuggestionsGenerated?.(suggestions);
        }

        report(
          "completed",
          suggestions.length > 0
            ? `Generated ${suggestions.length} tailored suggestions`
            : "No additional suggestions generated"
        );
        return {
          success: true,
          count: suggestions.length,
          suggestions,
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report("error", message, message);
    return { success: false, status: "error", error: message };
  }
}

/**
 * Builds Vercel AI SDK v6 `tool(...)` registry for native Tauri desktop runs
 * (all 16 tools including `ask_user_options`).
 */
export function buildVercelAiTools(ctx: ToolExecutionContext) {
  return {
    list_projects: tool({
      description: TOOL_DESCRIPTIONS.list_projects,
      inputSchema: TOOL_SCHEMAS.list_projects,
      execute: (args) => executeOmniTool("list_projects", args, ctx),
    }),
    create_project: tool({
      description: TOOL_DESCRIPTIONS.create_project,
      inputSchema: TOOL_SCHEMAS.create_project,
      execute: (args) => executeOmniTool("create_project", args, ctx),
    }),
    update_project: tool({
      description: TOOL_DESCRIPTIONS.update_project,
      inputSchema: TOOL_SCHEMAS.update_project,
      execute: (args) => executeOmniTool("update_project", args, ctx),
    }),
    delete_project: tool({
      description: TOOL_DESCRIPTIONS.delete_project,
      inputSchema: TOOL_SCHEMAS.delete_project,
      execute: (args) => executeOmniTool("delete_project", args, ctx),
    }),
    validate_local_path: tool({
      description: TOOL_DESCRIPTIONS.validate_local_path,
      inputSchema: TOOL_SCHEMAS.validate_local_path,
      execute: (args) => executeOmniTool("validate_local_path", args, ctx),
    }),
    list_commands: tool({
      description: TOOL_DESCRIPTIONS.list_commands,
      inputSchema: TOOL_SCHEMAS.list_commands,
      execute: (args) => executeOmniTool("list_commands", args, ctx),
    }),
    create_command: tool({
      description: TOOL_DESCRIPTIONS.create_command,
      inputSchema: TOOL_SCHEMAS.create_command,
      execute: (args) => executeOmniTool("create_command", args, ctx),
    }),
    create_commands_batch: tool({
      description: TOOL_DESCRIPTIONS.create_commands_batch,
      inputSchema: TOOL_SCHEMAS.create_commands_batch,
      execute: (args) => executeOmniTool("create_commands_batch", args, ctx),
    }),
    update_command: tool({
      description: TOOL_DESCRIPTIONS.update_command,
      inputSchema: TOOL_SCHEMAS.update_command,
      execute: (args) => executeOmniTool("update_command", args, ctx),
    }),
    delete_command: tool({
      description: TOOL_DESCRIPTIONS.delete_command,
      inputSchema: TOOL_SCHEMAS.delete_command,
      execute: (args) => executeOmniTool("delete_command", args, ctx),
    }),
    run_stored_command: tool({
      description: TOOL_DESCRIPTIONS.run_stored_command,
      inputSchema: TOOL_SCHEMAS.run_stored_command,
      execute: (args) => executeOmniTool("run_stored_command", args, ctx),
    }),
    run_adhoc_command: tool({
      description: TOOL_DESCRIPTIONS.run_adhoc_command,
      inputSchema: TOOL_SCHEMAS.run_adhoc_command,
      execute: (args) => executeOmniTool("run_adhoc_command", args, ctx),
    }),
    stop_execution: tool({
      description: TOOL_DESCRIPTIONS.stop_execution,
      inputSchema: TOOL_SCHEMAS.stop_execution,
      execute: (args) => executeOmniTool("stop_execution", args, ctx),
    }),
    get_execution_logs: tool({
      description: TOOL_DESCRIPTIONS.get_execution_logs,
      inputSchema: TOOL_SCHEMAS.get_execution_logs,
      execute: (args) => executeOmniTool("get_execution_logs", args, ctx),
    }),
    analyze_execution_error: tool({
      description: TOOL_DESCRIPTIONS.analyze_execution_error,
      inputSchema: TOOL_SCHEMAS.analyze_execution_error,
      execute: (args) => executeOmniTool("analyze_execution_error", args, ctx),
    }),
    list_available_engines: tool({
      description: TOOL_DESCRIPTIONS.list_available_engines,
      inputSchema: TOOL_SCHEMAS.list_available_engines,
      execute: (args) => executeOmniTool("list_available_engines", args, ctx),
    }),
    ask_user_options: tool({
      description: TOOL_DESCRIPTIONS.ask_user_options,
      inputSchema: TOOL_SCHEMAS.ask_user_options,
      execute: (args) => executeOmniTool("ask_user_options", args, ctx),
    }),
    suggest_next_commands: tool({
      description: TOOL_DESCRIPTIONS.suggest_next_commands,
      inputSchema: TOOL_SCHEMAS.suggest_next_commands,
      execute: (args) => executeOmniTool("suggest_next_commands", args, ctx),
    }),
  };
}
