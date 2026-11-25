export type VariableKind = "directory" | "text";

export interface ParsedVariable {
  name: string;
  rawToken: string;
  kind: VariableKind;
  defaultValue?: string;
  occurrences: number;
}

/**
 * Matches both `{{var_name}}` / `{{var_name:default}}` and single-brace
 * `{var_name}` / `{var_name:default}` tokens using strict identifier names
 * with NO spaces inside the braces (preventing false matches on PowerShell
 * script blocks like `{ $_ }` or JSON objects like `{"a": 1}`).
 */
const VARIABLE_TOKEN_REGEX =
  /\{\{([a-zA-Z_][a-zA-Z0-9_-]*)(?::([^}\r\n]*))?\}\}|(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_-]*)(?::([^}\r\n]*))?\}(?!\})/g;

const DIRECTORY_NAME_REGEX = /(path|dir|folder|directory)/i;
const LAST_VARS_STORAGE_KEY = "omnicommand_last_vars_v1";

export function isDirectoryVariableName(name: string): boolean {
  return DIRECTORY_NAME_REGEX.test(name);
}

/**
 * Extracts unique `{var_name}`, `{{var_name}}`, `{var_name:default}`, and
 * `{{var_name:default}}` placeholders from a command string in first-appearance order.
 */
export function parseCommandVariables(template: string): ParsedVariable[] {
  if (!template || !template.includes("{")) return [];

  const found = new Map<string, ParsedVariable>();
  VARIABLE_TOKEN_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = VARIABLE_TOKEN_REGEX.exec(template)) !== null) {
    const isDouble = match[1] !== undefined;
    const name = (isDouble ? match[1] : match[3]).trim();
    const rawDefault = isDouble ? match[2] : match[4];
    const defaultValue = rawDefault !== undefined ? rawDefault.trim() : undefined;
    const rawToken = isDouble ? `{{${name}}}` : `{${name}}`;

    const existing = found.get(name);
    if (existing) {
      existing.occurrences += 1;
      if (existing.defaultValue === undefined && defaultValue !== undefined) {
        existing.defaultValue = defaultValue;
      }
    } else {
      found.set(name, {
        name,
        rawToken,
        kind: isDirectoryVariableName(name) ? "directory" : "text",
        defaultValue,
        occurrences: 1,
      });
    }
  }

  return Array.from(found.values());
}

export function hasCommandVariables(template: string): boolean {
  return parseCommandVariables(template).length > 0;
}

/**
 * Interpolates all `{var_name}` and `{{var_name}}` (with optional `:default`)
 * tokens using the supplied runtime values map.
 * When `keepUnfilledTokens` is true (used for live modal previews), empty values
 * preserve the placeholder token so the user can see what still needs input.
 */
export function interpolateCommandVariables(
  template: string,
  values: Record<string, string>,
  options?: { keepUnfilledTokens?: boolean }
): string {
  if (!template || !template.includes("{")) return template;

  const keepUnfilled = Boolean(options?.keepUnfilledTokens);
  VARIABLE_TOKEN_REGEX.lastIndex = 0;

  return template.replace(
    VARIABLE_TOKEN_REGEX,
    (full, dblName?: string, dblDefault?: string, sglName?: string, sglDefault?: string) => {
      const isDouble = dblName !== undefined;
      const name = (isDouble ? dblName : sglName ?? "").trim();
      const rawDefault = isDouble ? dblDefault : sglDefault;
      const provided = values[name];

      if (keepUnfilled) {
        if (provided !== undefined && provided.length > 0) {
          return provided;
        }
        return full;
      }

      if (provided !== undefined) {
        return provided;
      }
      if (rawDefault !== undefined) {
        return rawDefault.trim();
      }
      return "";
    }
  );
}

export function loadLastVariableValues(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_VARS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveLastVariableValues(values: Record<string, string>): void {
  try {
    const existing = loadLastVariableValues();
    const merged: Record<string, string> = { ...existing };
    for (const [k, v] of Object.entries(values)) {
      if (v.trim().length > 0) {
        merged[k] = v;
      }
    }
    const entries = Object.entries(merged);
    const trimmed =
      entries.length > 100
        ? Object.fromEntries(entries.slice(entries.length - 100))
        : merged;
    localStorage.setItem(LAST_VARS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota / privacy errors
  }
}
