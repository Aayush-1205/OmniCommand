import type {
  AgentPermissionMode,
  CommandItem,
  RiskLevel,
} from "../types/omnicommand";
import {
  checkCommandGuardrails,
  detectAdhocAutoEscalation,
} from "../lib/guardrails";

export interface PolicyDecision {
  decision: "allow" | "ask" | "block";
  reason: string;
}

const ALWAYS_AUTO_TOOLS = new Set([
  "list_projects",
  "validate_local_path",
  "list_commands",
  "stop_execution",
  "get_execution_logs",
  "analyze_execution_error",
  "list_available_engines",
  "ask_user_options",
  "suggest_next_commands",
]);

const ALWAYS_ASK_TOOLS = new Set(["delete_project", "delete_command"]);

const MUTATING_CRUD_TOOLS = new Set([
  "create_project",
  "update_project",
  "create_command",
  "create_commands_batch",
  "update_command",
]);

/**
 * Evaluates OmniCommand's Policy Gate across Ask / Selected / Auto modes,
 * non-bypassable destructive guardrails, high-risk confirmation rules, and
 * Auto-mode ad-hoc chaining / inline-script escalation.
 */
export function evaluateToolPolicy(params: {
  toolName: string;
  mode: AgentPermissionMode;
  storedCommand?: CommandItem | null;
  adhocCommandText?: string;
  resolvedCommandText?: string;
  riskLevel?: RiskLevel;
}): PolicyDecision {
  const {
    toolName,
    mode,
    storedCommand,
    adhocCommandText,
    resolvedCommandText,
    riskLevel = "low",
  } = params;

  // 1. Always-safe read & diagnostic tools
  if (ALWAYS_AUTO_TOOLS.has(toolName)) {
    return { decision: "allow", reason: "Read-only or diagnostic tool." };
  }

  // 2. Destructive CRUD tools always require explicit approval
  if (ALWAYS_ASK_TOOLS.has(toolName)) {
    return {
      decision: "ask",
      reason: "Destructive deletion always requires explicit user confirmation.",
    };
  }

  // 3. Mutating CRUD tools require approval in Ask/Selected; auto in Auto only if low-risk
  if (MUTATING_CRUD_TOOLS.has(toolName)) {
    if (mode === "auto" && riskLevel === "low") {
      return { decision: "allow", reason: "Auto mode permits low-risk workspace updates." };
    }
    return {
      decision: "ask",
      reason: `Workspace mutation (${toolName}) requires approval in ${mode} mode.`,
    };
  }

  // 4. Execution tools: run hard destructive blocklist first on the final interpolated command (non-bypassable)
  const targetCommand =
    resolvedCommandText ??
    (toolName === "run_stored_command" ? storedCommand?.command ?? "" : adhocCommandText ?? "");
  const guardrail = checkCommandGuardrails(targetCommand);
  if (guardrail.blocked) {
    return {
      decision: "block",
      reason: guardrail.reason ?? "Blocked by non-bypassable security guardrail.",
    };
  }

  const effectiveRisk: RiskLevel =
    toolName === "run_stored_command" ? storedCommand?.riskLevel ?? "medium" : riskLevel;

  // High-risk commands ALWAYS require user confirmation regardless of mode
  if (effectiveRisk === "high") {
    return {
      decision: "ask",
      reason: "High-risk commands always require explicit confirmation before running.",
    };
  }

  // Stored command per-item runPolicy override
  if (toolName === "run_stored_command" && storedCommand) {
    if (storedCommand.runPolicy === "ask") {
      return {
        decision: "ask",
        reason: "Command runPolicy is explicitly set to Ask.",
      };
    }

    if (mode === "ask") {
      return {
        decision: "ask",
        reason: "Agent permission mode is Ask — approval required before execution.",
      };
    }

    if (mode === "selected") {
      if (storedCommand.aiAllowed) {
        return {
          decision: "allow",
          reason: "Allowed in Selected Commands mode (aiAllowed: true).",
        };
      }
      return {
        decision: "ask",
        reason: "Command is not in the AI allowlist (aiAllowed: false).",
      };
    }

    // mode === "auto"
    if (effectiveRisk === "low") {
      return { decision: "allow", reason: "Low-risk stored command approved in Auto mode." };
    }
    return {
      decision: "ask",
      reason: `${effectiveRisk}-risk commands require confirmation even in Auto mode.`,
    };
  }

  // Ad-hoc execution policy
  if (toolName === "run_adhoc_command") {
    if (mode === "ask" || mode === "selected") {
      return {
        decision: "ask",
        reason: `Ad-hoc commands require explicit approval in ${mode} mode.`,
      };
    }

    // Hardened Auto-mode restriction: escalate chained/piped commands or inline scripts
    const escalation = detectAdhocAutoEscalation(targetCommand);
    if (escalation.escalate) {
      return {
        decision: "ask",
        reason: escalation.reason ?? "Chained or inline script requires Ask approval.",
      };
    }

    if (effectiveRisk === "low") {
      return { decision: "allow", reason: "Simple low-risk ad-hoc command allowed in Auto mode." };
    }

    return {
      decision: "ask",
      reason: `${effectiveRisk}-risk ad-hoc command requires confirmation in Auto mode.`,
    };
  }

  return { decision: "ask", reason: "Default policy requires approval." };
}
