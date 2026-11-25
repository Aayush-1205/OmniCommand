import { PanelRight, Plus, Search } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import { ENGINE_LABELS, ENGINE_ORDER, type EngineType } from "../../types/omnicommand";

const ENGINE_OPTIONS: CustomSelectOption<EngineType>[] = ENGINE_ORDER.map((eng) => ({
  value: eng,
  label: ENGINE_LABELS[eng],
}));

export function WorkspaceHeader() {
  const projects = useOmniStore((s) => s.projects);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const activeEngineOverride = useOmniStore((s) => s.activeEngineOverride);
  const commandSearchQuery = useOmniStore((s) => s.commandSearchQuery);
  const aiDrawerOpen = useOmniStore((s) => s.aiDrawerOpen);
  const pendingApprovals = useOmniStore((s) => s.pendingApprovals);

  const setActiveEngineOverride = useOmniStore((s) => s.setActiveEngineOverride);
  const setCommandSearchQuery = useOmniStore((s) => s.setCommandSearchQuery);
  const openCommandModal = useOmniStore((s) => s.openCommandModal);
  const setAiDrawerOpen = useOmniStore((s) => s.setAiDrawerOpen);

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <header className="h-14 px-5 border-b border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] flex items-center justify-between gap-4 shrink-0">
      {/* Left: Project title + clean unboxed basePath */}
      <div className="min-w-0 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-[#111827] dark:text-[#F3F4F6] whitespace-nowrap truncate">
          {activeProject ? activeProject.name : "Global Root"}
        </h1>
        <span className="text-[#E5E7EB] dark:text-[#262930] select-none">/</span>
        <span className="text-[12px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
          {activeProject ? activeProject.basePath : "Prompts for directory on run"}
        </span>
      </div>

      {/* Right: Search, Engine selector, + New Command, AI Drawer toggle */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={commandSearchQuery}
            onChange={(e) => setCommandSearchQuery(e.target.value)}
            placeholder="Filter commands..."
            aria-label="Filter commands"
            className="w-44 h-8 pl-8 pr-2.5 rounded-md text-[12.5px] bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
          />
        </div>

        <CustomSelect
          ariaLabel="Active shell engine"
          value={activeEngineOverride}
          onChange={setActiveEngineOverride}
          options={ENGINE_OPTIONS}
          size="sm"
          className="min-w-[116px]"
        />

        <button
          type="button"
          onClick={() => openCommandModal(null)}
          className="h-8 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12.5px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          New Command
        </button>

        <button
          type="button"
          onClick={() => setAiDrawerOpen(!aiDrawerOpen)}
          title={aiDrawerOpen ? "Hide AI Assistant" : "Show AI Assistant"}
          aria-label="Toggle AI Assistant drawer"
          className={`relative h-8 px-2.5 rounded-md border text-[12.5px] font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            aiDrawerOpen
              ? "bg-[#F6F7F9] dark:bg-[#181A1E] border-[#2563EB] text-[#2563EB] dark:text-[#60A5FA]"
              : "bg-transparent border-[#E5E7EB] dark:border-[#262930] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6]"
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          <span>Assistant</span>
          {pendingApprovals.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-[#D97706]" />
          )}
        </button>
      </div>
    </header>
  );
}
