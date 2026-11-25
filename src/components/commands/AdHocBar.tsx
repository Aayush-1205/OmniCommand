import { useState } from "react";
import { CornerDownLeft, Terminal } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { ENGINE_LABELS } from "../../types/omnicommand";

export function AdHocBar() {
  const [commandText, setCommandText] = useState("");
  const activeEngineOverride = useOmniStore((s) => s.activeEngineOverride);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const projects = useOmniStore((s) => s.projects);
  const runAdhocCommandInteractive = useOmniStore((s) => s.runAdhocCommandInteractive);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandText.trim();
    if (!trimmed) return;
    setCommandText("");
    await runAdhocCommandInteractive({
      commandText: trimmed,
      engine: activeEngineOverride,
    });
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="px-4 py-2.5 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] flex items-center gap-2.5 shrink-0"
    >
      <div className="flex items-center gap-1.5 text-[12px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
        <Terminal className="w-3.5 h-3.5 text-[#2563EB]" />
        <span>{ENGINE_LABELS[activeEngineOverride]}</span>
      </div>

      <input
        type="text"
        value={commandText}
        onChange={(e) => setCommandText(e.target.value)}
        placeholder={
          activeProject
            ? `Run ad-hoc command in ${activeProject.basePath}...`
            : "Run ad-hoc command (will prompt for directory)..."
        }
        aria-label="Ad-hoc command input"
        className="flex-1 min-w-0 h-8 px-3 rounded-md font-mono text-[12.5px] bg-[#FFFFFF] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
      />

      <button
        type="submit"
        disabled={!commandText.trim()}
        className="h-8 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-45 disabled:pointer-events-none text-white text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
      >
        <span>Run</span>
        <CornerDownLeft className="w-3 h-3" />
      </button>
    </form>
  );
}
