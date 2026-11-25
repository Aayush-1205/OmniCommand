import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eraser,
  History,
  Send,
  Square,
  TerminalSquare,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { parseAnsiLine, stripAnsi } from "../../lib/ansi";
import { ENGINE_LABELS } from "../../types/omnicommand";

const ROW_HEIGHT = 21;
const OVERSCAN = 14;

export function EmbeddedConsole() {
  const consoleHeight = useOmniStore((s) => s.consoleHeight);
  const setConsoleHeight = useOmniStore((s) => s.setConsoleHeight);
  const consoleTab = useOmniStore((s) => s.consoleTab);
  const setConsoleTab = useOmniStore((s) => s.setConsoleTab);
  const executions = useOmniStore((s) => s.executions);
  const activeExecutionId = useOmniStore((s) => s.activeExecutionId);
  const consoleLinesByExec = useOmniStore((s) => s.consoleLinesByExec);
  const stopActiveExecution = useOmniStore((s) => s.stopActiveExecution);
  const sendStdinToActive = useOmniStore((s) => s.sendStdinToActive);
  const clearActiveConsole = useOmniStore((s) => s.clearActiveConsole);
  const inspectExecutionRecord = useOmniStore((s) => s.inspectExecutionRecord);
  const explainExecutionError = useOmniStore((s) => s.explainExecutionError);
  const aiBusy = useOmniStore((s) => s.aiBusy);

  const [stdinValue, setStdinValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(180);
  const [autoStickBottom, setAutoStickBottom] = useState(true);

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const activeExec = useMemo(
    () => executions.find((e) => e.id === activeExecutionId) ?? null,
    [executions, activeExecutionId]
  );

  const lines = useMemo(
    () => (activeExecutionId ? consoleLinesByExec[activeExecutionId] ?? [] : []),
    [activeExecutionId, consoleLinesByExec]
  );

  const isRunning = activeExec?.status === "running";
  const hasErrorExit =
    activeExec !== null &&
    activeExec.status !== "running" &&
    activeExec.exitCode !== null &&
    activeExec.exitCode !== 0;

  // Track viewport size for DOM virtualization
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [consoleTab]);

  // Auto-scroll smoothly when pinned to bottom
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !autoStickBottom) return;
    el.scrollTop = el.scrollHeight;
    setScrollTop(el.scrollTop);
  }, [lines.length, autoStickBottom, activeExecutionId]);

  const handleViewportScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoStickBottom(distanceFromBottom < ROW_HEIGHT * 2);
  };

  // Drag handle to resize Embedded Console height
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const initialHeight = consoleHeight;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setConsoleHeight(initialHeight + delta);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleCopy = async () => {
    const raw = lines.map((l) => stripAnsi(l.text)).join("\n");
    if (!raw) return;
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleStdinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stdinValue.trim() || !isRunning) return;
    const payload = stdinValue;
    setStdinValue("");
    await sendStdinToActive(payload);
  };

  // Virtualized slice math
  const totalHeight = lines.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIdx = Math.min(lines.length, startIdx + visibleCount);
  const visibleSlice = lines.slice(startIdx, endIdx);

  return (
    <section
      style={{ height: `${consoleHeight}px` }}
      className="flex flex-col border-t border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] shrink-0"
    >
      {/* Top resize grip */}
      <div
        onMouseDown={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize embedded console"
        className="h-1 w-full cursor-row-resize hover:bg-[#2563EB]/40 transition-colors shrink-0"
      />

      {/* Console toolbar */}
      <div className="h-9 px-4 border-b border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1 p-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.05]">
            <button
              type="button"
              onClick={() => setConsoleTab("console")}
              className={`h-6 px-2.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                consoleTab === "console"
                  ? "bg-[#FFFFFF] dark:bg-[#111214] text-[#111827] dark:text-[#F3F4F6] shadow-xs"
                  : "text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6]"
              }`}
            >
              <TerminalSquare className="w-3.5 h-3.5" />
              Console
            </button>
            <button
              type="button"
              onClick={() => setConsoleTab("history")}
              className={`h-6 px-2.5 rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                consoleTab === "history"
                  ? "bg-[#FFFFFF] dark:bg-[#111214] text-[#111827] dark:text-[#F3F4F6] shadow-xs"
                  : "text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6]"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History</span>
              <span className="tabular-nums opacity-75">({executions.length})</span>
            </button>
          </div>

          {activeExec && consoleTab === "console" && (
            <div className="flex items-center gap-2 text-[12px] text-[#6B7280] dark:text-[#9CA3AF] min-w-0 truncate">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isRunning
                    ? "bg-[#2563EB] animate-pulse"
                    : activeExec.exitCode === 0
                      ? "bg-[#16A34A]"
                      : activeExec.status === "killed"
                        ? "bg-[#D97706]"
                        : "bg-[#DC2626]"
                }`}
              />
              <span className="font-mono truncate text-[#111827] dark:text-[#F3F4F6]">
                {activeExec.commandText}
              </span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{ENGINE_LABELS[activeExec.engine]}</span>
              {!isRunning && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`tabular-nums whitespace-nowrap font-mono ${
                      activeExec.exitCode === 0
                        ? "text-[#16A34A]"
                        : activeExec.status === "killed"
                          ? "text-[#D97706]"
                          : "text-[#DC2626]"
                    }`}
                  >
                    {activeExec.status === "killed"
                      ? "Killed"
                      : `Exit ${activeExec.exitCode ?? "?"}`}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums whitespace-nowrap font-mono">
                    {activeExec.durationMs}ms
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning && (
            <button
              type="button"
              onClick={() => void stopActiveExecution()}
              className="h-6 px-2.5 rounded bg-[#DC2626] hover:bg-red-700 text-white text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              Kill Process Tree
            </button>
          )}

          {hasErrorExit && activeExec && (
            <button
              type="button"
              disabled={aiBusy}
              onClick={() => void explainExecutionError(activeExec.id)}
              className="h-6 px-2.5 rounded bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Explain Error
            </button>
          )}

          {consoleTab === "console" && (
            <>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={lines.length === 0}
                title="Copy console output"
                className="h-6 w-6 rounded text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={clearActiveConsole}
                disabled={lines.length === 0}
                title="Clear console"
                className="h-6 w-6 rounded text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 inline-flex items-center justify-center cursor-pointer"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Console Viewport (DOM-virtualized) or Execution History */}
      {consoleTab === "console" ? (
        <>
          <div
            ref={viewportRef}
            onScroll={handleViewportScroll}
            className="flex-1 overflow-y-auto overflow-x-auto px-4 py-2 font-mono text-[12px] bg-[#FFFFFF] dark:bg-[#111214]"
          >
            {lines.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[12px] font-sans text-[#6B7280] dark:text-[#9CA3AF]">
                {activeExec && isRunning
                  ? "Waiting for process output..."
                  : "Embedded headless console ready. Run a command to stream UTF-8 ANSI output here."}
              </div>
            ) : (
              <div style={{ height: `${totalHeight}px`, position: "relative" }}>
                <div
                  style={{
                    transform: `translateY(${startIdx * ROW_HEIGHT}px)`,
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                  }}
                >
                  {visibleSlice.map((line) => {
                    const segments = parseAnsiLine(line.text);
                    return (
                      <div
                        key={line.id}
                        style={{ height: `${ROW_HEIGHT}px`, lineHeight: `${ROW_HEIGHT}px` }}
                        className={`whitespace-pre ${
                          line.stream === "stderr"
                            ? "text-[#DC2626] dark:text-red-400"
                            : "text-[#111827] dark:text-[#E5E7EB]"
                        }`}
                      >
                        {segments.map((seg, i) => (
                          <span key={i} className={seg.className}>
                            {seg.text}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Stdin bar shown while a process is running */}
          {isRunning && (
            <form
              onSubmit={(e) => void handleStdinSubmit(e)}
              className="h-8 px-4 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] flex items-center gap-2 shrink-0"
            >
              <span className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF]">
                stdin &gt;
              </span>
              <input
                type="text"
                value={stdinValue}
                onChange={(e) => setStdinValue(e.target.value)}
                placeholder="Type input and press Enter to send to running process..."
                className="flex-1 bg-transparent font-mono text-[12px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!stdinValue.trim()}
                className="text-[#2563EB] disabled:opacity-40 cursor-pointer"
                aria-label="Send stdin"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB] dark:divide-[#262930]">
          {executions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[12px] text-[#6B7280] dark:text-[#9CA3AF]">
              No executions recorded yet.
            </div>
          ) : (
            executions.map((rec) => {
              const failed = rec.status === "failed" || (rec.exitCode !== null && rec.exitCode !== 0 && rec.status !== "running");
              return (
                <div
                  key={rec.id}
                  onClick={() => void inspectExecutionRecord(rec.id)}
                  className={`px-4 py-2 flex items-center justify-between gap-3 hover:bg-[#F6F7F9] dark:hover:bg-[#181A1E] cursor-pointer transition-colors ${
                    rec.id === activeExecutionId ? "bg-[#2563EB]/8" : ""
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        rec.status === "running"
                          ? "bg-[#2563EB]"
                          : rec.exitCode === 0
                            ? "bg-[#16A34A]"
                            : rec.status === "killed"
                              ? "bg-[#D97706]"
                              : "bg-[#DC2626]"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-mono text-[#111827] dark:text-[#F3F4F6] truncate">
                        {rec.commandText}
                      </div>
                      <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 truncate">
                        <span>{ENGINE_LABELS[rec.engine]}</span>
                        <span>·</span>
                        <span className="font-mono truncate">{rec.basePath}</span>
                        <span>·</span>
                        <span>{rec.triggeredBy === "ai" ? "AI" : "User"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-[11.5px] font-mono tabular-nums text-[#6B7280] dark:text-[#9CA3AF]">
                    <span>{rec.durationMs}ms</span>
                    <span
                      className={
                        rec.exitCode === 0
                          ? "text-[#16A34A]"
                          : rec.status === "killed"
                            ? "text-[#D97706]"
                            : rec.status === "running"
                              ? "text-[#2563EB]"
                              : "text-[#DC2626]"
                      }
                    >
                      {rec.status === "running"
                        ? "Running"
                        : rec.status === "killed"
                          ? "Killed"
                          : `Exit ${rec.exitCode ?? "?"}`}
                    </span>
                    {failed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void explainExecutionError(rec.id);
                        }}
                        className="h-6 px-2 rounded bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-sans text-[11px] font-medium cursor-pointer"
                      >
                        Explain
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
