import { tool } from "ai";
import type {
  AgentPermissionMode,
  BatchApprovalCommandPreview,
  CommandItem,
  CompletionChip,
  EngineInfo,
  EngineType,
  ExecutionRecord,
  ExportedProjectTemplate,
  OptionChoiceItem,
  OptionPromptResponse,
  Project,
  ProviderConfig,
  ResolvedOptionCard,
  RiskLevel,
  RunPolicy,
  ScaffoldProjectPreview,
  SequenceStepPreview,
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
import {
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  type OmniToolName,
} from "./toolSchemas";

export { TOOL_SCHEMAS, TOOL_DESCRIPTIONS, type OmniToolName };

export interface AdvisorSignal {
  projectId: string | null;
  projectName: string;
  basePath: string;
  engine: EngineType;
  reason: string;
}

export interface ToolExecutionContext {
  getState: () => {
    projects: Project[];
    commands: CommandItem[];
    executions: ExecutionRecord[];
    engines: EngineInfo[];
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
  waitForExecution: (executionId: string) => Promise<ExecutionRecord>;
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
  requestScaffoldApproval: (req: {
    toolName: string;
    title: string;
    basePath: string;
    riskLevel: RiskLevel;
    reason: string;
    details: Record<string, unknown>;
    scaffoldProject: ScaffoldProjectPreview;
    batchCommands: BatchApprovalCommandPreview[];
  }) => Promise<string[]>;
  requestSequenceApproval: (req: {
    toolName: string;
    title: string;
    basePath: string;
    riskLevel: RiskLevel;
    reason: string;
    details: Record<string, unknown>;
    sequenceSteps: SequenceStepPreview[];
    stopOnError: boolean;
  }) => Promise<boolean>;
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
  onTemplateExported?: (template: ExportedProjectTemplate) => void;
  onAdvisorSignal?: (signal: AdvisorSignal) => void;
}

function normalizePathForCompare(p: string): string {
  return p.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function takeOutputTail(rawLog: string, maxLines: number, maxChars: number): string {
  if (!rawLog) return "";
  const cleaned = rawLog.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = cleaned.split(/\r?\n/);
  const tail = lines.slice(-maxLines).join("\n").trim();
  if (tail.length > maxChars) {
    return tail.slice(tail.length - maxChars);
  }
  return tail;
}

/**
 * Unified executor for all 22 OmniCommand AI tools, shared by both
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
        ctx.onAdvisorSignal?.({
          projectId: project.id,
          projectName: project.name,
          basePath: project.basePath,
          engine: project.defaultEngine,
          reason: `Created project "${project.name}"`,
        });
        report("completed", `Created project "${project.name}" (${project.id})`);
        return {
          success: true,
          status: "created",
          projectId: project.id,
          project,
        };
      }

      case "scaffold_project_with_commands": {
        const parsed = TOOL_SCHEMAS.scaffold_project_with_commands.parse(rawArgs);
        const pathCheck = await runtimeBridge.validatePath(parsed.basePath, false);
        if (!pathCheck.valid) {
          const reason = pathCheck.blockedReason ?? "Invalid or blocked basePath.";
          report("error", reason, reason);
          return { success: false, status: "blocked", error: reason };
        }
        const canonicalPath = pathCheck.canonicalPath ?? parsed.basePath.trim();

        // Check for duplicate project name (case-insensitive) or canonical basePath BEFORE approval
        const freshState = ctx.getState();
        const nameLower = parsed.name.trim().toLowerCase();
        const pathNorm = normalizePathForCompare(canonicalPath);
        const duplicate = freshState.projects.find(
          (p) =>
            p.name.trim().toLowerCase() === nameLower ||
            normalizePathForCompare(p.basePath) === pathNorm
        );
        if (duplicate) {
          const err = `Project "${duplicate.name}" already exists at ${duplicate.basePath} (id: ${duplicate.id}). Use create_commands_batch with projectId "${duplicate.id}" to add commands to the existing project, or call ask_user_options to let the user choose.`;
          report("error", `Duplicate project: ${duplicate.name}`, err);
          return {
            success: false,
            status: "duplicate_project",
            existingProject: {
              id: duplicate.id,
              name: duplicate.name,
              basePath: duplicate.basePath,
              defaultEngine: duplicate.defaultEngine,
            },
            error: err,
          };
        }

        // Guardrail-check every starter command
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
          previewId: `scaf_${idx}_${crypto.randomUUID().slice(0, 6)}`,
          name: item.name.trim(),
          alias:
            item.alias?.trim() ||
            item.name
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-"),
          command: item.command.trim(),
          engine: item.engine ?? parsed.defaultEngine,
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
            `Scaffold Project "${parsed.name}" + ${normalizedItems.length} command(s)`
          );
          const approvedIds = await ctx.requestScaffoldApproval({
            toolName,
            title: `Create Project: ${parsed.name.trim()}`,
            basePath: canonicalPath,
            riskLevel: highestRisk,
            reason: policy.reason,
            details: parsed,
            scaffoldProject: {
              name: parsed.name.trim(),
              basePath: canonicalPath,
              defaultEngine: parsed.defaultEngine,
            },
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
            report("rejected", `Rejected project scaffold "${parsed.name}"`);
            return {
              success: false,
              status: "rejected",
              error: `User rejected scaffold_project_with_commands for "${parsed.name}".`,
            };
          }
        }

        report(
          "running",
          `Creating project "${parsed.name}" and ${approvedItems.length} command(s)...`
        );
        const project = await ctx.createProject({
          name: parsed.name.trim(),
          basePath: canonicalPath,
          defaultEngine: parsed.defaultEngine,
        });

        const createdCommands = await ctx.createCommandsBatch({
          projectId: project.id,
          commands: approvedItems.map(({ previewId: _ignore, ...rest }) => rest),
        });

        ctx.onCompletionEvent?.({
          id: `chip_proj_${project.id}`,
          kind: "project",
          label: `Project: ${project.name}`,
          projectId: project.id,
        });
        for (const cmd of createdCommands) {
          ctx.onCompletionEvent?.({
            id: `chip_cmd_${cmd.id}`,
            kind: "commands",
            label: `Command: ${cmd.name}`,
            projectId: project.id,
            commandId: cmd.id,
          });
        }
        ctx.onAdvisorSignal?.({
          projectId: project.id,
          projectName: project.name,
          basePath: project.basePath,
          engine: project.defaultEngine,
          reason: `Scaffolded project "${project.name}" with ${createdCommands.length} commands`,
        });

        report(
          "completed",
          `Created "${project.name}" + ${createdCommands.length} command${createdCommands.length === 1 ? "" : "s"}${rejectedNames.length > 0 ? ` (${rejectedNames.length} skipped)` : ""}`
        );
        return {
          success: true,
          status: "created",
          projectId: project.id,
          project,
          count: createdCommands.length,
          commands: createdCommands,
          ...(rejectedNames.length > 0 ? { rejectedCommands: rejectedNames } : {}),
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
        ctx.onAdvisorSignal?.({
          projectId: targetProjectId,
          projectName: targetProject?.name ?? "Global Root",
          basePath: targetProject?.basePath ?? "",
          engine: cmd.engine,
          reason: `Added command "${cmd.name}"`,
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

        ctx.onAdvisorSignal?.({
          projectId: targetProjectId,
          projectName: targetProject?.name ?? "Global Root",
          basePath: targetProject?.basePath ?? "",
          engine: created[0]?.engine ?? targetProject?.defaultEngine ?? "powershell",
          reason: `Added ${created.length} commands to ${targetProject?.name ?? "Global Root"}`,
        });

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
        const targetProject = target.projectId
          ? freshState.projects.find((p) => p.id === target.projectId)
          : null;
        ctx.onAdvisorSignal?.({
          projectId: target.projectId,
          projectName: targetProject?.name ?? "Global Root",
          basePath: targetProject?.basePath ?? target.basePath,
          engine: target.engine,
          reason: `Analyzed failed execution "${target.commandText}" (exit ${target.exitCode ?? "?"})`,
        });
        report("completed", `Analyzed error for ${target.id}`);
        return { success: true, executionId: target.id, exitCode: target.exitCode, analysis };
      }

      case "inspect_workspace_files": {
        const parsed = TOOL_SCHEMAS.inspect_workspace_files.parse(rawArgs);
        const freshState = ctx.getState();

        const targetProject = parsed.projectId
          ? freshState.projects.find((p) => p.id === parsed.projectId)
          : !parsed.basePath && freshState.selectedProjectId
            ? freshState.projects.find((p) => p.id === freshState.selectedProjectId)
            : null;

        const targetBasePath = targetProject?.basePath ?? parsed.basePath;
        if (!targetBasePath) {
          const err =
            "No projectId or basePath provided and no active project is selected. Pass a valid projectId or Windows basePath.";
          report("error", err, err);
          return { success: false, status: "error", error: err };
        }

        report(
          "running",
          parsed.manifestFile
            ? `Reading ${parsed.manifestFile} in ${targetProject?.name ?? targetBasePath}`
            : `Inspecting workspace files in ${targetProject?.name ?? targetBasePath}`
        );

        const inspection = await runtimeBridge.inspectWorkspaceFiles({
          basePath: targetBasePath,
          manifestFile: parsed.manifestFile,
          projectName: targetProject?.name,
          defaultEngine: targetProject?.defaultEngine,
        });

        report(
          "completed",
          inspection.manifest
            ? `Read ${inspection.manifest.filename}${inspection.manifest.truncated ? " (truncated at 8 KB)" : ""}`
            : `Found ${inspection.entries.length} top-level item(s)`
        );
        return {
          success: true,
          ...inspection,
        };
      }

      case "run_command_sequence": {
        const parsed = TOOL_SCHEMAS.run_command_sequence.parse(rawArgs);
        const freshState = ctx.getState();

        interface ResolvedSequenceStep {
          stepIndex: number;
          label: string;
          commandText: string;
          engine: EngineType;
          basePath: string;
          riskLevel: RiskLevel;
          commandId: string | null;
          projectId: string | null;
          storedCommand?: CommandItem;
        }

        const resolvedSteps: ResolvedSequenceStep[] = [];
        let sharedPickedBasePath: string | null = null;
        let highestRisk: RiskLevel = "low";
        let needsApproval = false;
        let approvalReason = "Confirm multi-step command sequence before running.";

        // Pre-resolve basePath and {var} placeholders across ALL steps BEFORE displaying the Sequence Approval Card
        for (let i = 0; i < parsed.steps.length; i++) {
          const step = parsed.steps[i];
          const stored = step.commandId
            ? freshState.commands.find((c) => c.id === step.commandId)
            : undefined;

          if (step.commandId && !stored) {
            const err = `Step ${i + 1}: Stored command "${step.commandId}" not found.`;
            report("error", err, err);
            return { success: false, status: "error", error: err };
          }

          const rawTemplate = stored ? stored.command : step.commandText?.trim() ?? "";
          if (!rawTemplate) {
            const err = `Step ${i + 1}: Either commandId or commandText must be provided.`;
            report("error", err, err);
            return { success: false, status: "error", error: err };
          }

          const engine: EngineType = stored?.engine ?? step.engine ?? "powershell";
          const riskLevel: RiskLevel = stored?.riskLevel ?? step.riskLevel ?? "low";
          const label = step.label?.trim() || stored?.name || `Step ${i + 1}`;
          const projectId = stored ? stored.projectId : freshState.selectedProjectId;

          // Resolve basePath once (reuse picked directory across Global Root steps)
          let stepBasePath = parsed.basePath;
          if (!stepBasePath) {
            if (stored?.projectId) {
              stepBasePath = freshState.projects.find((p) => p.id === stored.projectId)?.basePath;
            } else if (freshState.selectedProjectId) {
              stepBasePath = freshState.projects.find(
                (p) => p.id === freshState.selectedProjectId
              )?.basePath;
            }
          }
          if (!stepBasePath && sharedPickedBasePath) {
            stepBasePath = sharedPickedBasePath;
          }
          if (!stepBasePath) {
            report("pending_approval", `Select directory for sequence step ${i + 1}: ${label}`);
            const picked = await ctx.requestGlobalBasePath({
              title: `Select working directory for sequence (${parsed.steps.length} steps)`,
              commandName: label,
            });
            if (!picked) {
              report("cancelled", "User cancelled directory selection for command sequence");
              return {
                success: false,
                status: "cancelled",
                error: "User cancelled directory selection for run_command_sequence.",
              };
            }
            sharedPickedBasePath = picked;
            stepBasePath = picked;
          }

          // Pre-resolve {var} / {{var}} placeholders for this step
          let finalCommand = rawTemplate;
          const parsedVars = parseCommandVariables(rawTemplate);
          if (parsedVars.length > 0) {
            const provided = step.variables ?? {};
            const missingRequired = parsedVars.some(
              (v) => v.defaultValue === undefined && !(provided[v.name] ?? "").trim()
            );

            let resolvedValues: Record<string, string> = { ...provided };
            if (missingRequired) {
              report("pending_approval", `Awaiting variables for step ${i + 1}: ${label}`);
              const prompted = await ctx.requestCommandVariables({
                title: `Step ${i + 1} of ${parsed.steps.length}: Fill Command Variables`,
                commandName: label,
                commandTemplate: rawTemplate,
                engine,
                variables: parsedVars,
                initialValues: provided,
              });
              if (!prompted) {
                report("cancelled", `User cancelled variables for step ${i + 1}`);
                return {
                  success: false,
                  status: "cancelled",
                  error: `User cancelled variable input for sequence step ${i + 1} ("${label}").`,
                };
              }
              resolvedValues = prompted;
            } else {
              saveLastVariableValues(resolvedValues);
            }

            finalCommand = interpolateCommandVariables(rawTemplate, resolvedValues);
          }

          // Guardrail-check the exact resolved command
          const guardrail = await runtimeBridge.checkGuardrails(finalCommand);
          if (guardrail.blocked) {
            const reason = `Step ${i + 1} ("${label}") blocked by security guardrail: ${guardrail.reason ?? "blocked"}`;
            report("blocked", reason, reason);
            return { success: false, status: "blocked", error: reason };
          }

          // Policy check per step
          const stepPolicy = evaluateToolPolicy({
            toolName: stored ? "run_stored_command" : "run_adhoc_command",
            mode: freshState.agentPermissionMode,
            storedCommand: stored,
            adhocCommandText: stored ? undefined : finalCommand,
            resolvedCommandText: finalCommand,
            riskLevel,
          });
          if (stepPolicy.decision === "block") {
            const reason = `Step ${i + 1} ("${label}") blocked: ${stepPolicy.reason}`;
            report("blocked", reason, reason);
            return { success: false, status: "blocked", error: reason };
          }
          if (stepPolicy.decision === "ask") {
            needsApproval = true;
            approvalReason = stepPolicy.reason;
          }

          if (riskLevel === "high") {
            highestRisk = "high";
          } else if (riskLevel === "medium" && highestRisk !== "high") {
            highestRisk = "medium";
          }

          resolvedSteps.push({
            stepIndex: i + 1,
            label,
            commandText: finalCommand,
            engine,
            basePath: stepBasePath,
            riskLevel,
            commandId: stored?.id ?? null,
            projectId,
            storedCommand: stored,
          });
        }

        // Single Sequence Approval Card showing exact pre-resolved commands
        if (needsApproval) {
          report("pending_approval", `Run sequence (${resolvedSteps.length} steps)`);
          const approved = await ctx.requestSequenceApproval({
            toolName,
            title: `Run Sequence (${resolvedSteps.length} step${resolvedSteps.length === 1 ? "" : "s"})`,
            basePath: resolvedSteps[0].basePath,
            riskLevel: highestRisk,
            reason: approvalReason,
            details: {
              stopOnError: parsed.stopOnError,
              steps: resolvedSteps.map((s) => ({
                stepIndex: s.stepIndex,
                label: s.label,
                commandText: s.commandText,
                engine: s.engine,
                basePath: s.basePath,
              })),
            },
            sequenceSteps: resolvedSteps.map((s) => ({
              stepIndex: s.stepIndex,
              label: s.label,
              commandText: s.commandText,
              engine: s.engine,
              basePath: s.basePath,
              riskLevel: s.riskLevel,
              commandId: s.commandId,
            })),
            stopOnError: parsed.stopOnError,
          });

          if (!approved) {
            report("rejected", "User rejected command sequence");
            return {
              success: false,
              status: "rejected",
              error: "User rejected run_command_sequence.",
            };
          }
        }

        const stepResults: Array<{
          stepIndex: number;
          label: string;
          executionId?: string;
          status: string;
          exitCode?: number | null;
          durationMs?: number;
          outputTail?: string;
          reason?: string;
        }> = [];
        let lastExecutionId: string | null = null;
        let abortedByKill = false;
        let allSucceeded = true;

        for (let i = 0; i < resolvedSteps.length; i++) {
          const step = resolvedSteps[i];
          report(
            "running",
            `Running step ${step.stepIndex}/${resolvedSteps.length}: ${step.label}`
          );

          const started = await ctx.executeCommand({
            engine: step.engine,
            commandText: step.commandText,
            basePath: step.basePath,
            commandId: step.commandId,
            projectId: step.projectId,
            triggeredBy: "ai",
          });
          lastExecutionId = started.id;

          const finished = await ctx.waitForExecution(started.id);
          const rawLog = await runtimeBridge.getExecutionLog(started.id);
          const outputTail = takeOutputTail(rawLog, 30, 2400);

          stepResults.push({
            stepIndex: step.stepIndex,
            label: step.label,
            executionId: started.id,
            status: finished.status,
            exitCode: finished.exitCode,
            durationMs: finished.durationMs,
            outputTail,
          });

          // Immediately abort remaining steps if user killed the running step mid-sequence
          if (finished.status === "killed") {
            allSucceeded = false;
            abortedByKill = true;
            for (let j = i + 1; j < resolvedSteps.length; j++) {
              stepResults.push({
                stepIndex: resolvedSteps[j].stepIndex,
                label: resolvedSteps[j].label,
                status: "skipped",
                reason: "Aborted because previous step was killed by user",
              });
            }
            break;
          }

          const stepFailed =
            finished.status === "failed" ||
            finished.status === "blocked" ||
            (finished.exitCode !== null && finished.exitCode !== 0);

          if (stepFailed) {
            allSucceeded = false;
            if (parsed.stopOnError !== false) {
              for (let j = i + 1; j < resolvedSteps.length; j++) {
                stepResults.push({
                  stepIndex: resolvedSteps[j].stepIndex,
                  label: resolvedSteps[j].label,
                  status: "skipped",
                  reason: `Skipped because step ${step.stepIndex} failed (exit code ${finished.exitCode ?? "?"})`,
                });
              }
              break;
            }
          }
        }

        const completedCount = stepResults.filter((r) => r.status === "completed").length;

        if (lastExecutionId) {
          ctx.onCompletionEvent?.({
            id: `chip_seq_${lastExecutionId}`,
            kind: "execution",
            label: `Sequence: ${completedCount}/${resolvedSteps.length} passed`,
            executionId: lastExecutionId,
          });
        }

        if (abortedByKill) {
          report(
            "cancelled",
            `Sequence aborted after kill (${completedCount}/${resolvedSteps.length} passed)`
          );
        } else {
          report(
            "completed",
            `Sequence finished: ${completedCount}/${resolvedSteps.length} passed`
          );
        }

        return {
          success: allSucceeded,
          status: abortedByKill ? "killed" : allSucceeded ? "completed" : "failed",
          abortedByKill,
          stopOnError: parsed.stopOnError,
          completedSteps: completedCount,
          totalSteps: resolvedSteps.length,
          steps: stepResults,
        };
      }

      case "search_execution_history": {
        const parsed = TOOL_SCHEMAS.search_execution_history.parse(rawArgs);
        const freshState = ctx.getState();

        let filtered = freshState.executions;
        if (parsed.projectId === "global") {
          filtered = filtered.filter((e) => e.projectId === null);
        } else if (parsed.projectId) {
          filtered = filtered.filter((e) => e.projectId === parsed.projectId);
        }
        if (parsed.status) {
          filtered = filtered.filter((e) => e.status === parsed.status);
        }
        if (parsed.engine) {
          filtered = filtered.filter((e) => e.engine === parsed.engine);
        }
        if (parsed.query && parsed.query.trim()) {
          const q = parsed.query.trim().toLowerCase();
          filtered = filtered.filter(
            (e) =>
              e.commandText.toLowerCase().includes(q) || e.basePath.toLowerCase().includes(q)
          );
        }

        const totalMatched = filtered.length;
        const sliced = filtered.slice(0, parsed.limit);

        const results = await Promise.all(
          sliced.map(async (ex) => {
            const raw = await runtimeBridge.getExecutionLog(ex.id);
            return {
              id: ex.id,
              projectId: ex.projectId,
              commandId: ex.commandId,
              engine: ex.engine,
              commandText: ex.commandText,
              basePath: ex.basePath,
              status: ex.status,
              exitCode: ex.exitCode,
              durationMs: ex.durationMs,
              triggeredBy: ex.triggeredBy,
              startedAt: ex.startedAt,
              outputTail: takeOutputTail(raw, 8, 400),
            };
          })
        );

        report(
          "completed",
          `Found ${totalMatched} execution${totalMatched === 1 ? "" : "s"} (returned ${results.length})`
        );
        return {
          success: true,
          totalMatched,
          returned: results.length,
          results,
        };
      }

      case "export_project_template": {
        const parsed = TOOL_SCHEMAS.export_project_template.parse(rawArgs);
        const freshState = ctx.getState();
        const project = freshState.projects.find((p) => p.id === parsed.projectId);
        if (!project) {
          const err = `Project "${parsed.projectId}" not found.`;
          report("error", err, err);
          return { success: false, status: "not_found", error: err };
        }

        // Export ONLY portable project/command fields — strip machine-specific basePath, IDs, and secrets
        const portableCommands = freshState.commands
          .filter((c) => c.projectId === project.id)
          .map((c) => ({
            name: c.name,
            alias: c.alias,
            command: c.command,
            engine: c.engine,
            riskLevel: c.riskLevel,
            runPolicy: c.runPolicy,
            aiAllowed: c.aiAllowed,
            description: c.description,
          }));

        const template: ExportedProjectTemplate = {
          id: `tpl_${crypto.randomUUID().slice(0, 8)}`,
          schemaVersion: "1.0",
          projectName: project.name,
          defaultEngine: project.defaultEngine,
          exportedAt: new Date().toISOString(),
          commands: portableCommands,
        };

        ctx.onTemplateExported?.(template);
        report(
          "completed",
          `Exported template for "${project.name}" (${portableCommands.length} command${portableCommands.length === 1 ? "" : "s"})`
        );
        return {
          success: true,
          status: "exported",
          template,
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
 * (all 22 primary tools; Advisor Sub-Agent runs asynchronously post-turn).
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
    scaffold_project_with_commands: tool({
      description: TOOL_DESCRIPTIONS.scaffold_project_with_commands,
      inputSchema: TOOL_SCHEMAS.scaffold_project_with_commands,
      execute: (args) => executeOmniTool("scaffold_project_with_commands", args, ctx),
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
    inspect_workspace_files: tool({
      description: TOOL_DESCRIPTIONS.inspect_workspace_files,
      inputSchema: TOOL_SCHEMAS.inspect_workspace_files,
      execute: (args) => executeOmniTool("inspect_workspace_files", args, ctx),
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
    run_command_sequence: tool({
      description: TOOL_DESCRIPTIONS.run_command_sequence,
      inputSchema: TOOL_SCHEMAS.run_command_sequence,
      execute: (args) => executeOmniTool("run_command_sequence", args, ctx),
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
    search_execution_history: tool({
      description: TOOL_DESCRIPTIONS.search_execution_history,
      inputSchema: TOOL_SCHEMAS.search_execution_history,
      execute: (args) => executeOmniTool("search_execution_history", args, ctx),
    }),
    analyze_execution_error: tool({
      description: TOOL_DESCRIPTIONS.analyze_execution_error,
      inputSchema: TOOL_SCHEMAS.analyze_execution_error,
      execute: (args) => executeOmniTool("analyze_execution_error", args, ctx),
    }),
    export_project_template: tool({
      description: TOOL_DESCRIPTIONS.export_project_template,
      inputSchema: TOOL_SCHEMAS.export_project_template,
      execute: (args) => executeOmniTool("export_project_template", args, ctx),
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
  };
}
