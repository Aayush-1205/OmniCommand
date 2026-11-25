import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Folder, Globe, Play, Search, Terminal } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { parseCommandVariables } from "../../lib/variables";
import {
  ENGINE_LABELS,
  type CommandItem,
  type Project,
} from "../../types/omnicommand";

type LauncherEntry =
  | { kind: "adhoc"; commandText: string }
  | { kind: "command"; command: CommandItem; projectName: string | null }
  | { kind: "project"; project: Project };

function fuzzyScore(needle: string, haystack: string): number {
  const q = needle.toLowerCase().trim();
  const target = haystack.toLowerCase();
  if (!q) return 1;
  if (target.includes(q)) return 100 - target.indexOf(q);
  let qi = 0;
  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i] === q[qi]) qi++;
  }
  return qi === q.length ? 30 : 0;
}

export function QuickLauncher() {
  const open = useOmniStore((s) => s.launcherOpen);
  const setLauncherOpen = useOmniStore((s) => s.setLauncherOpen);
  const projects = useOmniStore((s) => s.projects);
  const commands = useOmniStore((s) => s.commands);
  const activeEngineOverride = useOmniStore((s) => s.activeEngineOverride);
  const selectProject = useOmniStore((s) => s.selectProject);
  const runStoredCommandInteractive = useOmniStore((s) => s.runStoredCommandInteractive);
  const runAdhocCommandInteractive = useOmniStore((s) => s.runAdhocCommandInteractive);

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const entries = useMemo<LauncherEntry[]>(() => {
    const trimmed = query.trim();
    if (trimmed.startsWith(">")) {
      const cmdText = trimmed.slice(1).trim();
      return cmdText ? [{ kind: "adhoc", commandText: cmdText }] : [];
    }

    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const scored: Array<{ score: number; entry: LauncherEntry }> = [];

    for (const cmd of commands) {
      const proj = cmd.projectId ? projectMap.get(cmd.projectId) ?? null : null;
      const hay = `${cmd.name} ${cmd.alias} ${cmd.command} ${proj?.name ?? "Global Root"}`;
      const score = fuzzyScore(trimmed, hay);
      if (score > 0) {
        scored.push({
          score: score + 10,
          entry: { kind: "command", command: cmd, projectName: proj?.name ?? null },
        });
      }
    }

    for (const proj of projects) {
      const hay = `${proj.name} ${proj.basePath}`;
      const score = fuzzyScore(trimmed, hay);
      if (score > 0) {
        scored.push({ score, entry: { kind: "project", project: proj } });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const list = scored.slice(0, 12).map((s) => s.entry);

    if (trimmed.length > 0) {
      list.push({ kind: "adhoc", commandText: trimmed });
    }
    return list;
  }, [query, projects, commands]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  if (!open) return null;

  const executeEntry = async (entry: LauncherEntry) => {
    setLauncherOpen(false);
    if (entry.kind === "project") {
      selectProject(entry.project.id);
      return;
    }
    if (entry.kind === "command") {
      await runStoredCommandInteractive(entry.command);
      return;
    }
    await runAdhocCommandInteractive({
      commandText: entry.commandText,
      engine: activeEngineOverride,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setLauncherOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(Math.max(entries.length - 1, 0), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && entries[selectedIdx]) {
      e.preventDefault();
      void executeEntry(entries[selectedIdx]);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setLauncherOpen(false);
      }}
      className="fixed inset-0 z-50 bg-black/45 flex items-start justify-center pt-[14vh] px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick Launcher"
        onKeyDown={handleKeyDown}
        className="w-full max-w-[620px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        <div className="px-4 h-12 flex items-center gap-2.5 border-b border-[#E5E7EB] dark:border-[#262930]">
          <Search className="w-4 h-4 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search commands, projects, or type "> <command>" to run ad-hoc...'
            className="flex-1 bg-transparent text-[14px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none"
          />
          <span className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
            Esc
          </span>
        </div>

        <div className="max-h-[340px] overflow-y-auto py-1.5">
          {entries.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-[#6B7280] dark:text-[#9CA3AF]">
              No stored commands or projects yet. Type{" "}
              <code className="font-mono text-[#111827] dark:text-[#F3F4F6]">&gt; git status</code>{" "}
              to run an ad-hoc command.
            </div>
          ) : (
            entries.map((entry, idx) => {
              const active = idx === selectedIdx;
              if (entry.kind === "command") {
                const { command, projectName } = entry;
                const vars = parseCommandVariables(command.command);
                return (
                  <button
                    key={command.id}
                    type="button"
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => void executeEntry(entry)}
                    className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      active
                        ? "bg-[#2563EB]/12 text-[#111827] dark:text-[#F3F4F6]"
                        : "text-[#111827] dark:text-[#F3F4F6] hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {command.projectId ? (
                        <Play className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                          <span className="truncate">{command.name}</span>
                          {command.alias && (
                            <span className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                              :{command.alias}
                            </span>
                          )}
                          {vars.length > 0 && (
                            <span className="px-1 py-0.2 rounded text-[10px] font-mono text-[#6B7280] dark:text-[#9CA3AF] bg-black/[0.05] dark:bg-white/[0.07] shrink-0">
                              {vars.length === 1 ? vars[0].rawToken : `{${vars.length} vars}`}
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                          {command.command}
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 shrink-0">
                      <span>{projectName ?? "Global Root"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{ENGINE_LABELS[command.engine]}</span>
                    </div>
                  </button>
                );
              }

              if (entry.kind === "project") {
                return (
                  <button
                    key={entry.project.id}
                    type="button"
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => void executeEntry(entry)}
                    className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                      active
                        ? "bg-[#2563EB]/12 text-[#111827] dark:text-[#F3F4F6]"
                        : "text-[#111827] dark:text-[#F3F4F6]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Folder className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">
                          {entry.project.name}
                        </div>
                        <div className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                          {entry.project.basePath}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                      Switch project
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={`adhoc-${entry.commandText}`}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => void executeEntry(entry)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    active
                      ? "bg-[#2563EB]/12 text-[#111827] dark:text-[#F3F4F6]"
                      : "text-[#111827] dark:text-[#F3F4F6]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Terminal className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate">
                        Run ad-hoc in {ENGINE_LABELS[activeEngineOverride]}
                      </div>
                      <div className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                        {entry.commandText}
                      </div>
                    </div>
                  </div>
                  <CornerDownLeft className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#111214] flex items-center justify-between text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
          <span>↑↓ Navigate · Enter Execute</span>
          <span>Prefix with &gt; for ad-hoc command</span>
        </div>
      </div>
    </div>
  );
}
