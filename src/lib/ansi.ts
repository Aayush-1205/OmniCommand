export interface AnsiSegment {
  text: string;
  className: string;
}

const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

const FG_CLASSES: Record<number, string> = {
  30: "text-neutral-500",
  31: "text-red-500 dark:text-red-400",
  32: "text-emerald-600 dark:text-emerald-400",
  33: "text-amber-600 dark:text-amber-400",
  34: "text-blue-600 dark:text-blue-400",
  35: "text-fuchsia-600 dark:text-fuchsia-400",
  36: "text-cyan-600 dark:text-cyan-400",
  37: "text-neutral-200",
  90: "text-neutral-400 dark:text-neutral-500",
  91: "text-red-500 dark:text-red-400",
  92: "text-emerald-500 dark:text-emerald-400",
  93: "text-amber-500 dark:text-amber-300",
  94: "text-blue-500 dark:text-blue-400",
  95: "text-fuchsia-500 dark:text-fuchsia-300",
  96: "text-cyan-500 dark:text-cyan-300",
  97: "text-white",
};

/**
 * Safe ANSI SGR parser producing plain React segments (zero raw HTML injection).
 */
export function parseAnsiLine(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let lastIndex = 0;
  let fgClass = "";
  let bold = false;
  let dim = false;

  const buildClass = () => [fgClass, bold ? "font-semibold" : "", dim ? "opacity-65" : ""].filter(Boolean).join(" ");

  let match: RegExpExecArray | null;
  ANSI_REGEX.lastIndex = 0;

  while ((match = ANSI_REGEX.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: input.slice(lastIndex, match.index),
        className: buildClass(),
      });
    }

    const rawCodes = match[1];
    const codes = rawCodes ? rawCodes.split(";").map((c) => Number.parseInt(c, 10)) : [0];
    for (const code of codes) {
      if (code === 0 || Number.isNaN(code)) {
        fgClass = "";
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) {
        fgClass = "";
      } else if (FG_CLASSES[code]) {
        fgClass = FG_CLASSES[code];
      }
    }

    lastIndex = ANSI_REGEX.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      text: input.slice(lastIndex),
      className: buildClass(),
    });
  }

  if (segments.length === 0) {
    segments.push({ text: "", className: "" });
  }

  return segments;
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}
