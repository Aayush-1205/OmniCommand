import type { GuardrailCheckResult, PathValidationResult } from "../types/omnicommand";

const DESTRUCTIVE_PATTERNS: Array<{ rule: string; regex: RegExp; reason: string }> = [
  {
    rule: "disk_format",
    regex: /(^|[;&|]\s*)format(\.com)?\s+[a-z]:/i,
    reason: "Disk formatting command is blocked by security guardrails.",
  },
  {
    rule: "recursive_delete_root_or_os",
    regex: /\bdel\s+[^;&|]*(\/f|\/s|\/q)[^;&|]*([a-z]:\\(\s|$|\*|windows|program\s*files|system32))/i,
    reason: "Recursive forced deletion targeting drive root or Windows OS directory is blocked.",
  },
  {
    rule: "rm_rf_root",
    regex: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/(\s|$|\*)|~|\/\*)/i,
    reason: "Recursive forced root deletion (rm -rf /) is blocked.",
  },
  {
    rule: "powershell_invoke_expression",
    regex: /\b(invoke-expression|iex)\b/i,
    reason: "Dynamic PowerShell code evaluation (Invoke-Expression / iex) is blocked.",
  },
  {
    rule: "powershell_encoded_command",
    regex: /\s-(e|ec|enc|enco|encod|encode|encoded|encodedcommand)\s+[a-z0-9+/=]{8,}/i,
    reason: "Obfuscated PowerShell -EncodedCommand payloads are blocked.",
  },
  {
    rule: "registry_delete_hklm",
    regex: /\breg(\.exe)?\s+delete\s+hklm\\/i,
    reason: "Deleting HKLM registry hives is blocked.",
  },
  {
    rule: "scheduled_tasks_tamper",
    regex: /\bschtasks(\.exe)?\b/i,
    reason: "Scheduled task modification (schtasks) is blocked by default guardrails.",
  },
];

const PROTECTED_WINDOWS_DIRS = [
  "c:\\windows",
  "c:\\program files",
  "c:\\program files (x86)",
  "c:\\programdata\\microsoft\\windows",
];

/**
 * Mirrors Rust's hard destructive blocklist.
 */
export function checkCommandGuardrails(commandText: string): GuardrailCheckResult {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return {
      allowed: false,
      blocked: true,
      requiresConfirmation: false,
      matchedRule: "empty_command",
      reason: "Command cannot be empty.",
    };
  }

  for (const item of DESTRUCTIVE_PATTERNS) {
    if (item.regex.test(trimmed)) {
      return {
        allowed: false,
        blocked: true,
        requiresConfirmation: true,
        matchedRule: item.rule,
        reason: `Blocked by security guardrail (${item.rule}): ${item.reason}`,
      };
    }
  }

  return {
    allowed: true,
    blocked: false,
    requiresConfirmation: false,
    matchedRule: null,
    reason: null,
  };
}

/**
 * Detects chained/piped/redirected commands or inline script execution flags
 * (`python -c`, `pwsh -c`, `powershell -Command`, `node -e`, `bash -c`, `cmd /c`)
 * so `run_adhoc_command` in `Auto` mode ALWAYS escalates to an `Ask` Approval Card.
 */
export function detectAdhocAutoEscalation(commandText: string): {
  escalate: boolean;
  reason: string | null;
} {
  const trimmed = commandText.trim();

  if (/(&&|\|\||[;|<>]|(^|\s)&(\s|$))/.test(trimmed)) {
    return {
      escalate: true,
      reason:
        "Contains shell chaining, piping, or redirection operators (&&, ||, ;, |, &, >, <) — requires Ask approval even in Auto mode.",
    };
  }

  const inlineScriptRegex =
    /\b(python3?|py)(\.exe)?\s+[^\n]*-c\b|\b(pwsh|powershell)(\.exe)?\s+[^\n]*-(c|command)\b|\b(bash|sh)(\.exe)?\s+[^\n]*-c\b|\bnode(\.exe)?\s+[^\n]*(-e|--eval)\b|\bcmd(\.exe)?\s+[^\n]*\/c\b/i;

  if (inlineScriptRegex.test(trimmed)) {
    return {
      escalate: true,
      reason:
        "Invokes an inline script interpreter (-c / -Command / -e / /c) — requires Ask approval even in Auto mode.",
    };
  }

  return { escalate: false, reason: null };
}

/**
 * Strips `\\?\` UNC prefixes (matching Rust's `dunce` crate) and blocks
 * protected Windows OS directories.
 */
export function validateLocalPathClient(rawPath: string): PathValidationResult {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return {
      valid: false,
      exists: false,
      canonicalPath: null,
      blockedReason: "Base path is required.",
    };
  }

  const stripped = trimmed.replace(/^\\\\\?\\/, "").replace(/\//g, "\\");
  const normalized = stripped.replace(/\\+$/, (m) => (stripped.length <= 3 ? m : ""));
  const lower = normalized.toLowerCase();

  for (const protectedDir of PROTECTED_WINDOWS_DIRS) {
    if (
      lower === protectedDir ||
      lower.startsWith(`${protectedDir}\\`) ||
      lower.includes("\\system32") ||
      lower.includes("\\syswow64")
    ) {
      return {
        valid: false,
        exists: true,
        canonicalPath: null,
        blockedReason: `Protected OS directory blocked: "${normalized}". Select a workspace folder outside Windows system paths.`,
      };
    }
  }

  const looksLikeWinPath = /^[a-zA-Z]:\\/.test(normalized) || /^\\\\[^\\]+\\[^\\]+/.test(normalized);
  if (!looksLikeWinPath) {
    return {
      valid: false,
      exists: false,
      canonicalPath: null,
      blockedReason: `Expected a Windows absolute path (e.g. C:\\Users\\Name\\Project).`,
    };
  }

  return {
    valid: true,
    exists: true,
    canonicalPath: normalized,
    blockedReason: null,
  };
}

/**
 * Enforces Tauri v2 HTTP capability rules on custom provider endpoints:
 * allows `https://*`, `http://localhost:*`, and `http://127.0.0.1:*` while
 * explicitly blocking cloud metadata link-local addresses (`169.254.169.254`).
 */
export function validateProviderBaseUrl(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { valid: true };

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host === "169.254.169.254" || host.startsWith("169.254.")) {
      return {
        valid: false,
        error: "Link-local metadata addresses (169.254.x.x) are strictly blocked.",
      };
    }

    if (parsed.protocol === "https:") {
      return { valid: true };
    }

    if (parsed.protocol === "http:" && (host === "localhost" || host === "127.0.0.1")) {
      return { valid: true };
    }

    return {
      valid: false,
      error: "Custom endpoints must use https:// or loopback http://localhost:* / http://127.0.0.1:*.",
    };
  } catch {
    return { valid: false, error: "Invalid URL format." };
  }
}

export function wrapUntrustedTerminalOutput(raw: string): string {
  const sanitized = raw.replace(/<\/untrusted_terminal_output>/gi, "[/untrusted_terminal_output]");
  return `<untrusted_terminal_output>\n${sanitized}\n</untrusted_terminal_output>`;
}
