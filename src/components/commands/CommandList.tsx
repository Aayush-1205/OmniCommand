import { Pencil, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { parseCommandVariables } from "../../lib/variables";
import { ENGINE_LABELS, type RiskLevel } from "../../types/omnicommand";

function RiskIndicator({ level }: { level: RiskLevel }) {
  const dotColor =
    level === "high"
      ? "bg-[#DC2626]"
      : level === "medium"
        ? "bg-[#D97706]"
        : "bg-[#16A34A]";
  const label = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
  const textColor =
    level === "high"
      ? "text-[#DC2626] dark:text-red-400"
      : level === "medium"
        ? "text-[#D97706] dark:text-amber-400"
        : "text-[#6B7280] dark:text-[#9CA3AF]";

  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function CommandList() {
  const commands = useOmniStore((s) => s.commands);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const commandSearchQuery = useOmniStore((s) => s.commandSearchQuery);
  const openCommandModal = useOmniStore((s) => s.openCommandModal);
  const deleteCommand = useOmniStore((s) => s.deleteCommand);
  const toggleCommandAiAllowed = useOmniStore((s) => s.toggleCommandAiAllowed);
  const runStoredCommandInteractive = useOmniStore((s) => s.runStoredCommandInteractive);

  const scopedCommands = commands.filter((cmd) => {
    if (cmd.projectId !== selectedProjectId) return false;
    if (!commandSearchQuery.trim()) return true;
    const q = commandSearchQuery.toLowerCase();
    return (
      cmd.name.toLowerCase().includes(q) ||
      cmd.alias.toLowerCase().includes(q) ||
      cmd.command.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q)
    );
  });

  if (scopedCommands.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {commandSearchQuery.trim()
              ? "No matching commands"
              : selectedProjectId === null
                ? "No Global Root commands yet"
                : "No commands in this project yet"}
          </h2>
          <p className="text-[13px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
            {commandSearchQuery.trim()
              ? `No stored commands matched "${commandSearchQuery}". Clear the filter or run an ad-hoc command below.`
              : selectedProjectId === null
                ? "Save universal utilities here to run against any local directory, or execute an ad-hoc command in the bar below."
                : "Store reusable build, test, or script commands bound to this project's directory, or run one-off commands below."}
          </p>
          {!commandSearchQuery.trim() && (
            <div className="pt-1 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => openCommandModal(null)}
                className="h-8 px-3.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Create First Command
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB] dark:divide-[#262930]">
      {scopedCommands.map((cmd) => {
        const parsedVars = parseCommandVariables(cmd.command);
        const varLabel =
          parsedVars.length === 1
            ? parsedVars[0].rawToken
            : `{${parsedVars.length} vars}`;

        return (
          <div
            key={cmd.id}
            className="group px-5 py-3 hover:bg-[#F6F7F9] dark:hover:bg-[#181A1E] transition-colors flex items-center justify-between gap-4"
          >
            {/* Left Side: Primary Info */}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[13.5px] font-semibold text-[#111827] dark:text-[#F3F4F6] truncate">
                  {cmd.name}
                </span>
                {cmd.alias && (
                  <span className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                    :{cmd.alias}
                  </span>
                )}
                {parsedVars.length > 0 && (
                  <span
                    title={`Dynamic variables: ${parsedVars.map((v) => v.name).join(", ")}`}
                    className="px-1.5 py-0.5 rounded text-[10.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] bg-black/[0.04] dark:bg-white/[0.06] border border-[#E5E7EB] dark:border-[#262930] shrink-0"
                  >
                    {varLabel}
                  </span>
                )}
              </div>

              <div
                title={cmd.command}
                className="text-[12px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate"
              >
                {cmd.command}
              </div>

              {cmd.description && (
                <div
                  title={cmd.description}
                  className="text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]/90 truncate"
                >
                  {cmd.description}
                </div>
              )}
            </div>

            {/* Right Side: Tightly Grouped Metadata + Actions */}
            <div className="flex items-center gap-4 shrink-0">
              {/* Compact Metadata Group: Engine · Risk · AI Allowlist shield toggle */}
              <div className="flex items-center gap-2 text-[12px] text-[#6B7280] dark:text-[#9CA3AF]">
                <span className="text-[#111827] dark:text-[#E5E7EB] whitespace-nowrap">
                  {ENGINE_LABELS[cmd.engine]}
                </span>
                <span aria-hidden="true" className="opacity-45">
                  ·
                </span>
                <RiskIndicator level={cmd.riskLevel} />
                <span aria-hidden="true" className="opacity-45">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => void toggleCommandAiAllowed(cmd.id)}
                  title={
                    cmd.aiAllowed
                      ? "AI Allowlist: Allowed in Selected mode (click to restrict)"
                      : "AI Allowlist: Restricted (click to allow in Selected mode)"
                  }
                  aria-label={
                    cmd.aiAllowed
                      ? `Restrict AI auto-run for ${cmd.name}`
                      : `Allow AI auto-run for ${cmd.name}`
                  }
                  aria-pressed={cmd.aiAllowed}
                  className={`h-7 w-7 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                    cmd.aiAllowed
                      ? "text-[#2563EB] dark:text-[#60A5FA] bg-[#2563EB]/10 hover:bg-[#2563EB]/15"
                      : "text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tightly Paired Action Group: Run + Hover-revealed Edit & Delete */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void runStoredCommandInteractive(cmd)}
                  className="h-7 px-2.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium inline-flex items-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-current" />
                  Run
                </button>

                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => openCommandModal(cmd)}
                    title="Edit command"
                    aria-label={`Edit ${cmd.name}`}
                    className="h-7 w-7 rounded-md text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCommand(cmd.id)}
                    title="Delete command"
                    aria-label={`Delete ${cmd.name}`}
                    className="h-7 w-7 rounded-md text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#DC2626] hover:bg-red-500/10 inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
