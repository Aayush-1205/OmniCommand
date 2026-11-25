import { useEffect, useRef, useState } from "react";
import {
  Folder,
  Globe,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";

export function Sidebar() {
  const projects = useOmniStore((s) => s.projects);
  const commands = useOmniStore((s) => s.commands);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const settings = useOmniStore((s) => s.settings);
  const selectProject = useOmniStore((s) => s.selectProject);
  const openProjectModal = useOmniStore((s) => s.openProjectModal);
  const deleteProject = useOmniStore((s) => s.deleteProject);
  const setLauncherOpen = useOmniStore((s) => s.setLauncherOpen);
  const setSettingsOpen = useOmniStore((s) => s.setSettingsOpen);
  const toggleTheme = useOmniStore((s) => s.toggleTheme);

  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuProjectId) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuProjectId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenuProjectId(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuProjectId]);

  const globalCommandCount = commands.filter((c) => c.projectId === null).length;

  return (
    <aside className="w-[248px] shrink-0 h-full flex flex-col bg-[#F6F7F9] dark:bg-[#181A1E] border-r border-[#E5E7EB] dark:border-[#262930] select-none">
      {/* Brand header */}
      <div className="h-14 px-3.5 flex items-center justify-between gap-2 border-b border-[#E5E7EB] dark:border-[#262930]">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="/logo.svg"
            alt="OmniCommand"
            width={24}
            height={24}
            draggable={false}
            className="w-6 h-6 shrink-0 rounded-[5px]"
          />
          <span className="text-[14px] font-semibold tracking-tight text-[#111827] dark:text-[#F3F4F6] whitespace-nowrap">
            OmniCommand
          </span>
        </div>
        <button
          type="button"
          onClick={() => setLauncherOpen(true)}
          title={`Quick Launcher (${settings.launcherShortcut})`}
          className="h-6 px-1.5 rounded text-[10.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 border border-[#E5E7EB] dark:border-[#262930] inline-flex items-center transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {settings.launcherShortcut}
        </button>
      </div>

      {/* Navigation list */}
      <div className="flex-1 overflow-y-auto px-2 py-2.5 space-y-4">
        {/* Global Root */}
        <div>
          <button
            type="button"
            onClick={() => selectProject(null)}
            className={`relative w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-left transition-colors cursor-pointer ${
              selectedProjectId === null
                ? "bg-[#EEF2FF] dark:bg-[#1E222A] text-[#111827] dark:text-[#F3F4F6]"
                : "text-[#111827] dark:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
            }`}
          >
            {selectedProjectId === null && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#2563EB]"
              />
            )}
            <div className="flex items-center gap-2 min-w-0">
              <Globe
                className={`w-4 h-4 shrink-0 ${
                  selectedProjectId === null
                    ? "text-[#2563EB] dark:text-[#60A5FA]"
                    : "text-[#6B7280] dark:text-[#9CA3AF]"
                }`}
              />
              <div className="min-w-0">
                <div className="text-[13px] font-medium leading-tight truncate">Global Root</div>
                <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate mt-0.5">
                  Universal commands
                </div>
              </div>
            </div>
            <span className="text-[11px] tabular-nums text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
              {globalCommandCount}
            </span>
          </button>
        </div>

        {/* Projects Section */}
        <div>
          <div className="px-2.5 mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#6B7280] dark:text-[#9CA3AF]">
              Projects
            </span>
            <button
              type="button"
              onClick={() => openProjectModal(null)}
              className="text-[11px] font-medium text-[#2563EB] dark:text-[#60A5FA] hover:underline flex items-center gap-0.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="px-2.5 py-3 rounded-md border border-dashed border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#6B7280] dark:text-[#9CA3AF] space-y-2">
              <p className="leading-relaxed">
                No projects yet. Bind a local Windows directory to run commands in context.
              </p>
              <button
                type="button"
                onClick={() => openProjectModal(null)}
                className="w-full h-8 px-2.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                New Project
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {projects.map((project) => {
                const isSelected = selectedProjectId === project.id;
                const isMenuOpen = openMenuProjectId === project.id;
                const cmdCount = commands.filter((c) => c.projectId === project.id).length;

                return (
                  <div
                    key={project.id}
                    ref={isMenuOpen ? menuContainerRef : undefined}
                    className={`group relative rounded-md transition-colors ${
                      isSelected
                        ? "bg-[#EEF2FF] dark:bg-[#1E222A] text-[#111827] dark:text-[#F3F4F6]"
                        : "text-[#111827] dark:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[#2563EB]"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => selectProject(project.id)}
                      title={project.basePath}
                      className="w-full min-w-0 flex flex-col px-2.5 py-1.5 text-left cursor-pointer"
                    >
                      {/* Line 1: Folder icon + Project Name + muted count (hidden on hover when ⋯ appears) */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isSelected
                                ? "text-[#2563EB] dark:text-[#60A5FA]"
                                : "text-[#6B7280] dark:text-[#9CA3AF]"
                            }`}
                          />
                          <span className="text-[13px] font-medium leading-snug truncate">
                            {project.name}
                          </span>
                        </div>
                        <span
                          className={`text-[11px] tabular-nums text-[#6B7280] dark:text-[#9CA3AF] shrink-0 transition-opacity ${
                            isMenuOpen ? "opacity-0" : "group-hover:opacity-0"
                          }`}
                        >
                          {cmdCount}
                        </span>
                      </div>

                      {/* Line 2: Truncated monospace basePath */}
                      <div
                        title={project.basePath}
                        className="pl-[22px] pr-5 text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate mt-0.5"
                      >
                        {project.basePath}
                      </div>
                    </button>

                    {/* Hover-revealed ⋯ button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuProjectId(isMenuOpen ? null : project.id);
                      }}
                      aria-label={`Project actions for ${project.name}`}
                      aria-expanded={isMenuOpen}
                      className={`absolute right-1.5 top-1.5 h-6 w-6 rounded flex items-center justify-center text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/10 dark:hover:bg-white/10 transition-opacity cursor-pointer ${
                        isMenuOpen
                          ? "opacity-100 bg-black/5 dark:bg-white/10"
                          : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                      }`}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>

                    {/* Quick Edit / Delete Popover Menu */}
                    {isMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-1.5 top-8 z-30 w-36 rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-xl py-1"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuProjectId(null);
                            openProjectModal(project);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[12px] text-[#111827] dark:text-[#F3F4F6] hover:bg-[#F3F4F6] dark:hover:bg-[#232730] flex items-center gap-2 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF]" />
                          <span>Edit Project</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuProjectId(null);
                            void deleteProject(project.id);
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-[12px] text-[#DC2626] dark:text-red-400 hover:bg-red-500/10 flex items-center gap-2 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Project</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer utility bar: Theme toggle + Settings gear only */}
      <div className="h-11 px-2.5 border-t border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between gap-1 shrink-0">
        <button
          type="button"
          onClick={() => void toggleTheme()}
          title={settings.theme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"}
          aria-label="Toggle theme"
          className="h-8 px-2 rounded-md flex items-center gap-1.5 text-[12px] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          {settings.theme === "dark" ? (
            <>
              <Sun className="w-3.5 h-3.5" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5" />
              <span>Dark</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Open Settings"
          className="w-8 h-8 rounded-md flex items-center justify-center text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}
