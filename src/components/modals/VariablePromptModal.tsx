import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  FolderOpen,
  Play,
  Terminal,
  X,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { runtimeBridge } from "../../lib/bridge";
import {
  interpolateCommandVariables,
  loadLastVariableValues,
  saveLastVariableValues,
} from "../../lib/variables";
import { checkCommandGuardrails } from "../../lib/guardrails";

export function VariablePromptModal() {
  const req = useOmniStore((s) => s.variablePromptModal);
  const projects = useOmniStore((s) => s.projects);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const resolveCommandVariables = useOmniStore((s) => s.resolveCommandVariables);

  const [values, setValues] = useState<Record<string, string>>({});
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, string>>({});
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const activeProjectBasePath = useMemo(
    () => projects.find((p) => p.id === selectedProjectId)?.basePath ?? "",
    [projects, selectedProjectId]
  );

  useEffect(() => {
    if (!req) return;
    const saved = loadLastVariableValues();
    setLastUsedMap(saved);

    const next: Record<string, string> = {};
    for (const v of req.variables) {
      if (req.initialValues && req.initialValues[v.name] !== undefined) {
        next[v.name] = req.initialValues[v.name];
      } else if (v.defaultValue !== undefined) {
        next[v.name] = v.defaultValue;
      } else {
        next[v.name] = "";
      }
    }
    setValues(next);
    setPickerNotice(null);
    setCopied(false);
    setError(null);

    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 15);
    return () => window.clearTimeout(timer);
  }, [req]);

  useEffect(() => {
    if (!req) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveCommandVariables(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [req, resolveCommandVariables]);

  // Live preview keeps unfilled placeholders visible so the user sees what remains
  const previewCommand = useMemo(() => {
    if (!req) return "";
    return interpolateCommandVariables(req.commandTemplate, values, {
      keepUnfilledTokens: true,
    });
  }, [req, values]);

  // Guardrail check runs on the resolved command string
  const finalCommandForValidation = useMemo(() => {
    if (!req) return "";
    return interpolateCommandVariables(req.commandTemplate, values, {
      keepUnfilledTokens: false,
    });
  }, [req, values]);

  const guardrail = useMemo(() => {
    if (!finalCommandForValidation.trim()) return null;
    return checkCommandGuardrails(finalCommandForValidation);
  }, [finalCommandForValidation]);

  if (!req) return null;

  const missingRequired = req.variables.some(
    (v) => v.defaultValue === undefined && !(values[v.name] ?? "").trim()
  );

  const handleBrowseDirectory = async (varName: string) => {
    setPickerNotice(null);
    const result = await runtimeBridge.pickFolderNative({
      title: `Select directory for ${varName}`,
      defaultPath: values[varName] || activeProjectBasePath || undefined,
    });
    if (result.path) {
      setValues((prev) => ({ ...prev, [varName]: result.path! }));
      setError(null);
    }
    if (result.notice) {
      setPickerNotice(result.notice);
    }
  };

  const handleCopyPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired) {
      setError("Please fill in all required variables before running.");
      return;
    }
    if (guardrail?.blocked) {
      setError(guardrail.reason ?? "Resolved command blocked by security guardrails.");
      return;
    }
    saveLastVariableValues(values);
    resolveCommandVariables(values);
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolveCommandVariables(null);
      }}
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Run: ${req.commandName ?? "Command"}`}
        className="w-full max-w-[580px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] flex items-center justify-center shrink-0">
              <Terminal className="w-4 h-4 text-[#2563EB] dark:text-[#60A5FA]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[14.5px] font-semibold text-[#111827] dark:text-[#F3F4F6] truncate">
                Run: {req.commandName || "Command"}
              </h2>
              <p className="text-[12px] text-[#6B7280] dark:text-[#9CA3AF] truncate mt-0.5">
                Fill in values for dynamic variables
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => resolveCommandVariables(null)}
            aria-label="Cancel variable prompt"
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Section label */}
            <div className="text-[11px] font-semibold tracking-wider uppercase text-[#6B7280] dark:text-[#9CA3AF]">
              Detected Dynamic Variables ({req.variables.length})
            </div>

            {/* Variable Input Cards */}
            <div className="space-y-2.5">
              {req.variables.map((v, idx) => {
                const isDir = v.kind === "directory";
                const lastVal = lastUsedMap[v.name];
                const currentVal = values[v.name] ?? "";
                const quickFillVal =
                  lastVal || (isDir && activeProjectBasePath ? activeProjectBasePath : "");

                return (
                  <div
                    key={v.name}
                    className="p-3 rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9]/70 dark:bg-[#111214]/70 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <label
                          htmlFor={`omni-var-${v.name}`}
                          className="text-[12.5px] font-mono font-semibold text-[#2563EB] dark:text-[#60A5FA] truncate"
                        >
                          {v.rawToken}
                        </label>
                        <span className="text-[10.5px] font-medium tracking-wide uppercase text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                          ({isDir ? "DIRECTORY" : "TEXT"})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {v.defaultValue !== undefined && (
                          <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                            default: <code className="font-mono">{v.defaultValue || '""'}</code>
                          </span>
                        )}
                        {!currentVal && quickFillVal && (
                          <button
                            type="button"
                            onClick={() => {
                              setValues((prev) => ({ ...prev, [v.name]: quickFillVal }));
                              setError(null);
                            }}
                            title={`Fill with ${quickFillVal}`}
                            className="text-[11px] text-[#2563EB] dark:text-[#60A5FA] hover:underline truncate max-w-[180px] cursor-pointer"
                          >
                            Use {lastVal ? "last" : "project path"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        id={`omni-var-${v.name}`}
                        ref={idx === 0 ? firstInputRef : undefined}
                        type="text"
                        value={currentVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setValues((prev) => ({ ...prev, [v.name]: val }));
                          setError(null);
                        }}
                        placeholder={
                          isDir
                            ? `Enter directory path for ${v.name}...`
                            : `Enter value for ${v.name}...`
                        }
                        autoComplete="off"
                        className="flex-1 min-w-0 h-9 px-3 rounded-md font-mono text-[12.5px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
                      />
                      {isDir && (
                        <button
                          type="button"
                          onClick={() => void handleBrowseDirectory(v.name)}
                          className="h-9 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF]" />
                          <span>Browse</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {pickerNotice && (
              <p className="text-[11.5px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
                {pickerNotice}
              </p>
            )}

            {/* Live Resolved Command Preview */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                <span className="font-semibold tracking-wider uppercase">
                  Resolved Command String
                </span>
                <span className="font-mono">shell: {req.engine}</span>
              </div>

              <div className="relative rounded-lg bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] px-3.5 py-2.5 pr-11">
                <pre className="m-0 font-mono text-[12px] leading-relaxed text-[#111827] dark:text-[#F3F4F6] whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
                  {previewCommand}
                </pre>
                <button
                  type="button"
                  onClick={() => void handleCopyPreview()}
                  title={copied ? "Copied" : "Copy resolved command"}
                  aria-label="Copy resolved command"
                  className="absolute right-2 top-2 h-7 w-7 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] inline-flex items-center justify-center transition-colors cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Live Guardrail Validation Banner */}
            {guardrail?.blocked && (
              <div className="p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[12px] text-[#DC2626] dark:text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{guardrail.reason}</span>
              </div>
            )}

            {error && !guardrail?.blocked && (
              <div className="p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[12px] text-[#DC2626] dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-5 py-3.5 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9]/60 dark:bg-[#111214]/50 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyPreview()}
              className="h-8 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF]" />
              )}
              <span>{copied ? "Copied" : "Copy String"}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => resolveCommandVariables(null)}
                className="h-8 px-3.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(guardrail?.blocked) || missingRequired}
                className="h-8 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-45 disabled:pointer-events-none text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Play className="w-3 h-3 fill-current" />
                Run Command
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
