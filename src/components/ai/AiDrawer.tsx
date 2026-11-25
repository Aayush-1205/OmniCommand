import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  Check,
  Folder,
  Loader2,
  PanelRightClose,
  Plus,
  SquarePen,
  Terminal,
  X,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import {
  ENGINE_LABELS,
  type AgentPermissionMode,
  type ChatMentionItem,
  type CompletionChip,
  type PendingApproval,
  type PendingOptionPrompt,
  type ResolvedOptionCard,
  type SuggestedCommandItem,
  type ToolTraceItem,
} from "../../types/omnicommand";

const STREAMDOWN_PLUGINS = { code };

const PERMISSION_MODE_OPTIONS: CustomSelectOption<AgentPermissionMode>[] = [
  {
    value: "ask",
    label: "Ask",
    subtitle: "Prompt for approval before every execution",
  },
  {
    value: "selected",
    label: "Selected",
    subtitle: "Auto-run AI-allowlisted low/medium commands",
  },
  {
    value: "auto",
    label: "Auto",
    subtitle: "Auto-run safe low-risk commands; ask on high risk",
  },
];

const STARTER_CHIPS = [
  { label: "Check engines", prompt: "List available shell engines on this machine" },
  { label: "Create Git command", prompt: "Create a Global Root Git Status command" },
  { label: "Explain last error", prompt: "Inspect the latest execution logs and explain any error" },
];

function getRiskMeta(riskLevel: PendingApproval["riskLevel"]) {
  if (riskLevel === "high") {
    return { dot: "bg-[#DC2626]", label: "High risk" };
  }
  if (riskLevel === "medium") {
    return { dot: "bg-[#D97706]", label: "Medium risk" };
  }
  return { dot: "bg-[#16A34A]", label: "Low risk" };
}

function SingleApprovalCard({ item }: { item: PendingApproval }) {
  const resolveApproval = useOmniStore((s) => s.resolveApproval);
  const risk = getRiskMeta(item.riskLevel);

  return (
    <div className="rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] p-3 space-y-2.5">
      <div className="space-y-1">
        <div className="text-[12.5px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
          {item.title}
        </div>
        <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 flex-wrap">
          <span className="font-mono">{item.toolName}</span>
          {item.engine && (
            <>
              <span aria-hidden="true">·</span>
              <span>{ENGINE_LABELS[item.engine]}</span>
            </>
          )}
          {item.basePath && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono truncate max-w-[180px]">{item.basePath}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
            {risk.label}
          </span>
        </div>
      </div>

      {item.commandText && (
        <pre className="px-2.5 py-2 rounded-md bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] font-mono text-[11.5px] text-[#111827] dark:text-[#F3F4F6] overflow-x-auto whitespace-pre-wrap break-all m-0">
          {item.commandText}
        </pre>
      )}

      <p className="text-[11.5px] leading-snug text-[#6B7280] dark:text-[#9CA3AF] m-0">
        {item.reason}
      </p>

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => resolveApproval(item.id, true)}
          className="flex-1 h-7 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          Approve
        </button>
        <button
          type="button"
          onClick={() => resolveApproval(item.id, false)}
          className="flex-1 h-7 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[#111827] dark:text-[#F3F4F6] text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

function BatchCommandsApprovalCard({ item }: { item: PendingApproval }) {
  const resolveApproval = useOmniStore((s) => s.resolveApproval);
  const commands = item.batchCommands ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>(() => commands.map((c) => c.id));

  const toggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedSet = new Set(selectedIds);
  const selectedCount = commands.filter((c) => selectedSet.has(c.id)).length;
  const isPartial = selectedCount > 0 && selectedCount < commands.length;

  return (
    <div className="rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] p-3 space-y-2.5">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12.5px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {item.title}
          </div>
          <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
            {selectedCount}/{commands.length} selected
          </span>
        </div>
        {item.basePath && (
          <div className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
            {item.basePath}
          </div>
        )}
      </div>

      <div className="divide-y divide-[#E5E7EB] dark:divide-[#262930] rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] overflow-hidden">
        {commands.map((cmd) => {
          const checked = selectedSet.has(cmd.id);
          const risk = getRiskMeta(cmd.riskLevel);
          return (
            <button
              key={cmd.id}
              type="button"
              onClick={() => toggleItem(cmd.id)}
              className="w-full text-left px-2.5 py-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors flex items-start gap-2 cursor-pointer"
            >
              <span
                className={`mt-0.5 w-3.5 h-3.5 rounded-[4px] border shrink-0 inline-flex items-center justify-center transition-colors ${
                  checked
                    ? "bg-[#2563EB] border-[#2563EB] text-white"
                    : "border-[#9CA3AF] dark:border-[#4B5563] bg-transparent"
                }`}
              >
                {checked && <Check className="w-2.5 h-2.5" strokeWidth={2.5} />}
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] truncate">
                    {cmd.name}
                  </span>
                  <span className="text-[10.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                    :{cmd.alias}
                  </span>
                </div>
                <div className="text-[10.5px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 flex-wrap">
                  <span>{ENGINE_LABELS[cmd.engine]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                    {risk.label}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-[#374151] dark:text-[#D1D5DB] truncate pt-0.5">
                  {cmd.command}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => resolveApproval(item.id, commands.map((c) => c.id))}
          className="flex-1 h-7 px-2.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          Approve All
        </button>
        {isPartial && (
          <button
            type="button"
            onClick={() => resolveApproval(item.id, selectedIds)}
            className="h-7 px-2.5 rounded-md border border-[#2563EB]/40 bg-[#2563EB]/10 hover:bg-[#2563EB]/15 text-[#2563EB] dark:text-[#60A5FA] text-[11.5px] font-medium inline-flex items-center justify-center transition-colors whitespace-nowrap cursor-pointer"
          >
            Approve ({selectedCount})
          </button>
        )}
        <button
          type="button"
          onClick={() => resolveApproval(item.id, [])}
          className="h-7 px-2.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[#111827] dark:text-[#F3F4F6] text-[11.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

function BatchApprovalCard({ items }: { items: PendingApproval[] }) {
  const resolveApprovalBatch = useOmniStore((s) => s.resolveApprovalBatch);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => items.map((i) => i.id));

  const itemIdsKey = items.map((i) => i.id).join("|");
  useEffect(() => {
    setSelectedIds((prev) => {
      const prevSet = new Set(prev);
      const validIds = items.map((i) => i.id);
      const retained = validIds.filter((id) => prevSet.has(id));
      const added = validIds.filter((id) => !prevSet.has(id));
      return retained.length === 0 ? validIds : [...retained, ...added];
    });
  }, [itemIdsKey]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedSet = new Set(selectedIds);
  const selectedCount = items.filter((i) => selectedSet.has(i.id)).length;
  const isPartial = selectedCount > 0 && selectedCount < items.length;

  const handleApproveAll = () => {
    resolveApprovalBatch(
      items.map((i) => i.id),
      []
    );
  };

  const handleApproveSelected = () => {
    const approved = items.filter((i) => selectedSet.has(i.id)).map((i) => i.id);
    const rejected = items.filter((i) => !selectedSet.has(i.id)).map((i) => i.id);
    resolveApprovalBatch(approved, rejected);
  };

  const handleRejectAll = () => {
    resolveApprovalBatch(
      [],
      items.map((i) => i.id)
    );
  };

  return (
    <div className="rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
          Approval Required · {items.length} actions
        </div>
        <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
          {selectedCount}/{items.length} selected
        </span>
      </div>

      <div className="divide-y divide-[#E5E7EB] dark:divide-[#262930] rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] overflow-hidden">
        {items.map((item) => {
          const checked = selectedSet.has(item.id);
          const risk = getRiskMeta(item.riskLevel);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleItem(item.id)}
              className="w-full text-left px-2.5 py-2 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors flex items-start gap-2 cursor-pointer"
            >
              <span
                className={`mt-0.5 w-3.5 h-3.5 rounded-[4px] border shrink-0 inline-flex items-center justify-center transition-colors ${
                  checked
                    ? "bg-[#2563EB] border-[#2563EB] text-white"
                    : "border-[#9CA3AF] dark:border-[#4B5563] bg-transparent"
                }`}
              >
                {checked && <Check className="w-2.5 h-2.5" strokeWidth={2.5} />}
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] truncate">
                  {item.title}
                </div>
                <div className="text-[10.5px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 flex-wrap">
                  {item.engine && <span>{ENGINE_LABELS[item.engine]}</span>}
                  {item.engine && <span aria-hidden="true">·</span>}
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                    {risk.label}
                  </span>
                  {item.basePath && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono truncate max-w-[140px]">
                        {item.basePath}
                      </span>
                    </>
                  )}
                </div>
                {item.commandText && (
                  <div className="font-mono text-[11px] text-[#374151] dark:text-[#D1D5DB] truncate pt-0.5">
                    {item.commandText}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={handleApproveAll}
          className="flex-1 h-7 px-2.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Check className="w-3.5 h-3.5" />
          Approve All
        </button>
        {isPartial && (
          <button
            type="button"
            onClick={handleApproveSelected}
            className="h-7 px-2.5 rounded-md border border-[#2563EB]/40 bg-[#2563EB]/10 hover:bg-[#2563EB]/15 text-[#2563EB] dark:text-[#60A5FA] text-[11.5px] font-medium inline-flex items-center justify-center transition-colors whitespace-nowrap cursor-pointer"
          >
            Approve ({selectedCount})
          </button>
        )}
        <button
          type="button"
          onClick={handleRejectAll}
          className="h-7 px-2.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-transparent hover:bg-black/5 dark:hover:bg-white/5 text-[#111827] dark:text-[#F3F4F6] text-[11.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}

function OptionPromptCard({ prompt }: { prompt: PendingOptionPrompt }) {
  const resolveUserOptions = useOmniStore((s) => s.resolveUserOptions);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectValue, setSelectValue] = useState<string>(prompt.options[0]?.id ?? "");
  const [customValue, setCustomValue] = useState("");

  const selectOptions: CustomSelectOption<string>[] = useMemo(
    () =>
      prompt.options.map((opt) => ({
        value: opt.id,
        label: opt.label,
        subtitle: opt.description,
      })),
    [prompt.options]
  );

  const toggleMultiId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const submitSingleOption = (id: string) => {
    const match = prompt.options.find((o) => o.id === id);
    if (!match) return;
    resolveUserOptions({
      selectedIds: [match.id],
      selectedLabels: [match.label],
    });
  };

  const submitMultiOptions = () => {
    const trimmedCustom = customValue.trim();
    const chosen = prompt.options.filter((o) => selectedIds.includes(o.id));
    if (chosen.length === 0 && !trimmedCustom) return;
    resolveUserOptions({
      selectedIds: chosen.map((o) => o.id),
      selectedLabels: chosen.map((o) => o.label),
      ...(trimmedCustom ? { customValue: trimmedCustom } : {}),
    });
  };

  const submitSelectOption = () => {
    const trimmedCustom = customValue.trim();
    if (trimmedCustom) {
      resolveUserOptions({
        selectedIds: [],
        selectedLabels: [],
        customValue: trimmedCustom,
      });
      return;
    }
    const match = prompt.options.find((o) => o.id === selectValue);
    if (!match) return;
    resolveUserOptions({
      selectedIds: [match.id],
      selectedLabels: [match.label],
    });
  };

  const submitCustomOnly = () => {
    const trimmed = customValue.trim();
    if (!trimmed) return;
    resolveUserOptions({
      selectedIds: [],
      selectedLabels: [],
      customValue: trimmed,
    });
  };

  const handleSkip = () => {
    resolveUserOptions({
      selectedIds: [],
      selectedLabels: [],
      cancelled: true,
    });
  };

  const useSelectControl =
    prompt.displayAs === "select" && prompt.selectionType === "single";

  return (
    <div className="rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12.5px] font-semibold text-[#111827] dark:text-[#F3F4F6] leading-snug">
          {prompt.question}
        </div>
        <button
          type="button"
          onClick={handleSkip}
          className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] shrink-0 cursor-pointer"
        >
          Skip
        </button>
      </div>

      {useSelectControl ? (
        <div className="space-y-2">
          <CustomSelect
            ariaLabel={prompt.question}
            value={selectValue}
            onChange={setSelectValue}
            options={selectOptions}
            className="w-full"
          />
          {prompt.allowCustomInput && (
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitSelectOption();
                }
              }}
              placeholder="Or enter a custom value..."
              className="w-full h-8 px-2.5 rounded-md bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
            />
          )}
          <button
            type="button"
            onClick={submitSelectOption}
            disabled={!selectValue && !customValue.trim()}
            className="w-full h-7 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white text-[12px] font-medium transition-colors cursor-pointer"
          >
            Confirm
          </button>
        </div>
      ) : prompt.selectionType === "single" ? (
        <div className="space-y-1.5">
          {prompt.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => submitSingleOption(opt.id)}
              className="w-full text-left px-2.5 py-2 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] hover:border-[#2563EB] hover:bg-[#2563EB]/[0.05] dark:hover:bg-[#2563EB]/[0.08] transition-colors cursor-pointer"
            >
              <div className="text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                {opt.label}
              </div>
              {opt.description && (
                <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5 leading-snug">
                  {opt.description}
                </div>
              )}
            </button>
          ))}
          {prompt.allowCustomInput && (
            <div className="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCustomOnly();
                  }
                }}
                placeholder="Or enter a custom value..."
                className="flex-1 min-w-0 h-8 px-2.5 rounded-md bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
              />
              <button
                type="button"
                onClick={submitCustomOnly}
                disabled={!customValue.trim()}
                className="h-8 px-2.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white text-[11.5px] font-medium shrink-0 transition-colors cursor-pointer"
              >
                Use
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            {prompt.options.map((opt) => {
              const checked = selectedIds.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleMultiId(opt.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors flex items-start gap-2 cursor-pointer ${
                    checked
                      ? "border-[#2563EB] bg-[#2563EB]/[0.06] dark:bg-[#2563EB]/[0.10]"
                      : "border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#181A1E] hover:border-[#9CA3AF] dark:hover:border-[#3F4450]"
                  }`}
                >
                  <span
                    className={`mt-0.5 w-3.5 h-3.5 rounded-[4px] border shrink-0 inline-flex items-center justify-center transition-colors ${
                      checked
                        ? "bg-[#2563EB] border-[#2563EB] text-white"
                        : "border-[#9CA3AF] dark:border-[#4B5563] bg-transparent"
                    }`}
                  >
                    {checked && <Check className="w-2.5 h-2.5" strokeWidth={2.5} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5 leading-snug">
                        {opt.description}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {prompt.allowCustomInput && (
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitMultiOptions();
                }
              }}
              placeholder="Optional custom value..."
              className="w-full h-8 px-2.5 rounded-md bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
            />
          )}
          <button
            type="button"
            onClick={submitMultiOptions}
            disabled={selectedIds.length === 0 && !customValue.trim()}
            className="w-full h-7 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white text-[12px] font-medium transition-colors cursor-pointer"
          >
            Confirm Selection
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

function ResolvedOptionCardList({ cards }: { cards: ResolvedOptionCard[] }) {
  return (
    <div className="space-y-1.5 mb-2">
      {cards.map((card) => {
        const summary = card.cancelled
          ? "Skipped"
          : [
              ...card.selectedLabels,
              ...(card.customValue ? [card.customValue] : []),
            ].join(", ");
        return (
          <div
            key={card.id}
            className="rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF]/70 dark:bg-[#111214]/70 px-2.5 py-2 space-y-0.5"
          >
            <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] leading-snug">
              {card.question}
            </div>
            <div className="text-[11.5px] font-medium text-[#111827] dark:text-[#F3F4F6] flex items-center gap-1.5">
              <Check className="w-3 h-3 text-[#16A34A] shrink-0" />
              <span>
                {card.cancelled ? "Skipped" : `Selected: ${summary}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SuggestionCardList({ suggestions }: { suggestions: SuggestedCommandItem[] }) {
  const existingCommands = useOmniStore((s) => s.commands);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const createCommand = useOmniStore((s) => s.createCommand);
  const pushToast = useOmniStore((s) => s.pushToast);

  const [addingIds, setAddingIds] = useState<Record<string, boolean>>({});
  const [addedLocalIds, setAddedLocalIds] = useState<Record<string, boolean>>({});

  const handleAdd = async (sug: SuggestedCommandItem) => {
    setAddingIds((prev) => ({ ...prev, [sug.id]: true }));
    try {
      await createCommand({
        projectId: sug.projectId !== undefined ? sug.projectId : selectedProjectId,
        name: sug.name,
        alias: sug.alias,
        command: sug.command,
        engine: sug.engine,
        riskLevel: sug.riskLevel,
        runPolicy: "inherit",
        aiAllowed: false,
        description: sug.explanation,
      });
      setAddedLocalIds((prev) => ({ ...prev, [sug.id]: true }));
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setAddingIds((prev) => ({ ...prev, [sug.id]: false }));
    }
  };

  return (
    <div className="pt-2 space-y-1.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
        Suggested Follow-Up Commands
      </div>
      <div className="space-y-1.5">
        {suggestions.map((sug) => {
          const targetProjectId =
            sug.projectId !== undefined ? sug.projectId : selectedProjectId;
          const alreadyExists =
            Boolean(addedLocalIds[sug.id]) ||
            existingCommands.some(
              (c) =>
                c.projectId === targetProjectId &&
                (c.name.toLowerCase() === sug.name.toLowerCase() ||
                  c.command.trim().toLowerCase() === sug.command.trim().toLowerCase())
            );
          const isAdding = Boolean(addingIds[sug.id]);
          const risk = getRiskMeta(sug.riskLevel);

          return (
            <div
              key={sug.id}
              className="rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] p-2.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[12px] font-semibold text-[#111827] dark:text-[#F3F4F6] truncate">
                      {sug.name}
                    </span>
                    <span className="text-[10.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
                      :{sug.alias}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span>{ENGINE_LABELS[sug.engine]}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
                      {risk.label}
                    </span>
                  </div>
                </div>

                {alreadyExists ? (
                  <span className="h-6 px-2 rounded-md border border-[#16A34A]/30 bg-[#16A34A]/10 text-[#16A34A] dark:text-[#4ADE80] text-[11px] font-medium inline-flex items-center gap-1 shrink-0">
                    <Check className="w-3 h-3" />
                    Added
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => void handleAdd(sug)}
                    className="h-6 px-2 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-[11px] font-medium inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  >
                    {isAdding ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Add
                  </button>
                )}
              </div>

              <div className="px-2 py-1.5 rounded bg-[#F6F7F9] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] font-mono text-[11px] text-[#111827] dark:text-[#E5E7EB] break-all">
                {sug.command}
              </div>

              <p className="text-[11px] leading-snug text-[#6B7280] dark:text-[#9CA3AF] m-0">
                {sug.explanation}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolTraceList({ traces }: { traces: ToolTraceItem[] }) {
  return (
    <div className="space-y-1.5 mb-2">
      {traces.map((t) => {
        const isFailure =
          t.status === "error" || t.status === "blocked" || t.status === "rejected";
        const dot =
          t.status === "completed"
            ? "bg-[#16A34A]"
            : isFailure
              ? "bg-[#DC2626]"
              : t.status === "cancelled" || t.status === "pending_approval"
                ? "bg-[#D97706]"
                : "bg-[#2563EB]";
        const errorText =
          t.error || (t.status === "error" || t.status === "blocked" ? t.summary : null);

        return (
          <div key={t.id} className="space-y-1">
            <div className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1.5 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
              <span className="font-mono text-[#111827] dark:text-[#E5E7EB] shrink-0">
                {t.toolName}
              </span>
              {t.summary && !errorText && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{t.summary}</span>
                </>
              )}
            </div>
            {errorText && (
              <div className="ml-3 px-2 py-1 rounded border border-[#DC2626]/30 bg-[#DC2626]/10 text-[11px] text-[#DC2626] dark:text-red-300 flex items-start gap-1.5 leading-snug">
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                <span className="break-words min-w-0">{errorText}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CompletionChipList({ chips }: { chips: CompletionChip[] }) {
  const selectProject = useOmniStore((s) => s.selectProject);
  const inspectExecutionRecord = useOmniStore((s) => s.inspectExecutionRecord);

  const handleClick = (chip: CompletionChip) => {
    if (chip.kind === "execution" && chip.executionId) {
      void inspectExecutionRecord(chip.executionId);
      return;
    }
    if (chip.projectId !== undefined) {
      selectProject(chip.projectId);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => handleClick(chip)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#111214] hover:border-[#2563EB] text-[11px] font-medium text-[#111827] dark:text-[#F3F4F6] transition-colors cursor-pointer"
        >
          <Check className="w-3 h-3 text-[#16A34A] shrink-0" />
          {chip.kind === "project" ? (
            <Folder className="w-3 h-3 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
          ) : chip.kind === "execution" ? (
            <Terminal className="w-3 h-3 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
          ) : null}
          <span className="truncate max-w-[200px]">{chip.label}</span>
        </button>
      ))}
    </div>
  );
}

function UserMessageBubble({
  content,
  mentions,
}: {
  content: string;
  mentions?: ChatMentionItem[];
}) {
  const selectProject = useOmniStore((s) => s.selectProject);

  // Highlight inline @Label tokens when mentions exist
  const renderedContent = useMemo(() => {
    if (!mentions || mentions.length === 0) return content;
    const escaped = mentions
      .map((m) => m.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length);
    if (escaped.length === 0) return content;

    const regex = new RegExp(`(@(?:${escaped.join("|")}))`, "gi");
    const parts = content.split(regex);
    return parts.map((part, idx) => {
      if (part.startsWith("@")) {
        const labelLower = part.slice(1).toLowerCase();
        const match = mentions.find((m) => m.label.toLowerCase() === labelLower);
        if (match) {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                if (match.projectId !== undefined) {
                  selectProject(match.projectId);
                }
              }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded bg-[#2563EB]/12 dark:bg-[#2563EB]/20 text-[#1D4ED8] dark:text-[#93C5FD] text-[12px] font-medium align-baseline hover:bg-[#2563EB]/20 transition-colors cursor-pointer"
            >
              {match.kind === "project" ? (
                <Folder className="w-2.5 h-2.5 shrink-0" />
              ) : (
                <Terminal className="w-2.5 h-2.5 shrink-0" />
              )}
              <span>@{match.label}</span>
            </button>
          );
        }
      }
      return <span key={idx}>{part}</span>;
    });
  }, [content, mentions, selectProject]);

  return (
    <div className="px-3 py-2.5 rounded-lg bg-[#EAECEF] dark:bg-[#1F2228] text-[#111827] dark:text-[#F3F4F6] text-[13px] leading-relaxed whitespace-pre-wrap break-words">
      {renderedContent}
    </div>
  );
}

function MarkdownMessage({
  content,
  isAnimating,
}: {
  content: string;
  isAnimating: boolean;
}) {
  return (
    <div className="omni-markdown min-w-0 max-w-full">
      <Streamdown plugins={STREAMDOWN_PLUGINS} isAnimating={isAnimating}>
        {content}
      </Streamdown>
    </div>
  );
}

function buildLiveStepSummary(
  traces: ToolTraceItem[],
  pendingApprovalsCount: number,
  hasPendingOption: boolean
): string {
  if (hasPendingOption) {
    return "Waiting for your selection...";
  }
  if (pendingApprovalsCount > 0) {
    return pendingApprovalsCount === 1
      ? "Awaiting approval (1 action)..."
      : `Awaiting approval (${pendingApprovalsCount} actions)...`;
  }
  if (traces.length === 0) {
    return "Thinking...";
  }

  const segments: Array<{ name: string; count: number }> = [];
  for (const t of traces) {
    const last = segments[segments.length - 1];
    if (last && last.name === t.toolName) {
      last.count += 1;
    } else {
      segments.push({ name: t.toolName, count: 1 });
    }
  }
  const formatted = segments
    .slice(-3)
    .map((s) => (s.count > 1 ? `${s.name} (${s.count})` : s.name))
    .join(" → ");
  return `Running: ${formatted}...`;
}

interface ActiveMentionQuery {
  query: string;
  startIndex: number;
  endIndex: number;
}

function detectActiveMention(text: string, caretPos: number): ActiveMentionQuery | null {
  const before = text.slice(0, caretPos);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  return {
    query,
    startIndex: atIndex,
    endIndex: caretPos,
  };
}

export function AiDrawer() {
  const aiDrawerOpen = useOmniStore((s) => s.aiDrawerOpen);
  const settings = useOmniStore((s) => s.settings);
  const projects = useOmniStore((s) => s.projects);
  const commands = useOmniStore((s) => s.commands);
  const chatMessages = useOmniStore((s) => s.chatMessages);
  const pendingApprovals = useOmniStore((s) => s.pendingApprovals);
  const pendingOptionPrompt = useOmniStore((s) => s.pendingOptionPrompt);
  const aiBusy = useOmniStore((s) => s.aiBusy);
  const aiLiveTraces = useOmniStore((s) => s.aiLiveTraces);
  const aiStreamingText = useOmniStore((s) => s.aiStreamingText);
  const aiLiveOptionCards = useOmniStore((s) => s.aiLiveOptionCards);
  const aiLiveSuggestions = useOmniStore((s) => s.aiLiveSuggestions);

  const setAiDrawerOpen = useOmniStore((s) => s.setAiDrawerOpen);
  const setAgentPermissionMode = useOmniStore((s) => s.setAgentPermissionMode);
  const setActiveProviderId = useOmniStore((s) => s.setActiveProviderId);
  const sendChatMessage = useOmniStore((s) => s.sendChatMessage);
  const clearChatHistory = useOmniStore((s) => s.clearChatHistory);
  const setSettingsOpen = useOmniStore((s) => s.setSettingsOpen);
  const openProviderSetupModal = useOmniStore((s) => s.openProviderSetupModal);

  const [draft, setDraft] = useState("");
  const [attachedMentions, setAttachedMentions] = useState<ChatMentionItem[]>([]);
  const [mentionTrigger, setMentionTrigger] = useState<ActiveMentionQuery | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [
    chatMessages.length,
    pendingApprovals.length,
    pendingOptionPrompt?.id,
    aiLiveTraces.length,
    aiLiveOptionCards.length,
    aiLiveSuggestions.length,
    aiStreamingText,
  ]);

  // Build live-filtered @ mention candidates grouped into Projects and Commands
  const mentionResults = useMemo(() => {
    if (!mentionTrigger) {
      return { projectItems: [] as ChatMentionItem[], commandItems: [] as ChatMentionItem[], flat: [] as ChatMentionItem[] };
    }
    const q = mentionTrigger.query.trim().toLowerCase();
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const projectItems: ChatMentionItem[] = projects
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.basePath.toLowerCase().includes(q)
      )
      .slice(0, 6)
      .map((p) => ({
        id: p.id,
        kind: "project",
        label: p.name,
        projectId: p.id,
        basePath: p.basePath,
        defaultEngine: p.defaultEngine,
      }));

    const commandItems: ChatMentionItem[] = commands
      .filter((c) => {
        if (!q) return true;
        const parentName = c.projectId
          ? projectMap.get(c.projectId)?.name.toLowerCase() ?? ""
          : "global root";
        return (
          c.name.toLowerCase().includes(q) ||
          c.alias.toLowerCase().includes(q) ||
          c.command.toLowerCase().includes(q) ||
          parentName.includes(q)
        );
      })
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        kind: "command",
        label: c.name,
        projectId: c.projectId,
        commandId: c.id,
        commandText: c.command,
        engine: c.engine,
        riskLevel: c.riskLevel,
        parentProjectName: c.projectId
          ? projectMap.get(c.projectId)?.name ?? "Unknown Project"
          : "Global Root",
      }));

    const flat = [...projectItems, ...commandItems];
    return { projectItems, commandItems, flat };
  }, [mentionTrigger, projects, commands]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionTrigger?.query]);

  if (!aiDrawerOpen) return null;

  const configuredProviders = settings.providers.filter(
    (p) => p.secretStatus === "configured"
  );
  const activeProvider =
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0];
  const isActiveConfigured = activeProvider?.secretStatus === "configured";

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const caret = e.target.selectionStart ?? val.length;
    setDraft(val);
    setMentionTrigger(detectActiveMention(val, caret));

    // Prune attached mentions whose @Label was deleted from the draft
    setAttachedMentions((prev) =>
      prev.filter((m) => val.toLowerCase().includes(`@${m.label.toLowerCase()}`))
    );
  };

  const insertMention = (item: ChatMentionItem) => {
    if (!mentionTrigger) return;
    const before = draft.slice(0, mentionTrigger.startIndex);
    const after = draft.slice(mentionTrigger.endIndex);
    const inserted = `@${item.label} `;
    const nextDraft = `${before}${inserted}${after}`;
    const nextCaret = before.length + inserted.length;

    setDraft(nextDraft);
    setMentionTrigger(null);
    setAttachedMentions((prev) => {
      if (prev.some((m) => m.kind === item.kind && m.id === item.id)) {
        return prev;
      }
      return [...prev, item];
    });

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const removeAttachedMention = (item: ChatMentionItem) => {
    setAttachedMentions((prev) =>
      prev.filter((m) => !(m.kind === item.kind && m.id === item.id))
    );
    const escaped = item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setDraft((prev) => prev.replace(new RegExp(`@${escaped}\\s?`, "i"), ""));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || aiBusy) return;
    if (!isActiveConfigured) {
      openProviderSetupModal(activeProvider?.providerType ?? "gemini");
      return;
    }
    const text = draft;
    const mentionsToSend = attachedMentions;
    setDraft("");
    setAttachedMentions([]);
    setMentionTrigger(null);
    await sendChatMessage(text, mentionsToSend);
  };

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionTrigger && mentionResults.flat.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionResults.flat.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(
          (prev) => (prev - 1 + mentionResults.flat.length) % mentionResults.flat.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = mentionResults.flat[mentionIndex] ?? mentionResults.flat[0];
        if (chosen) insertMention(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionTrigger(null);
        return;
      }
    } else if (mentionTrigger && e.key === "Escape") {
      e.preventDefault();
      setMentionTrigger(null);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  };

  const handleProviderSelectChange = (val: string) => {
    if (val === "__connect__") {
      openProviderSetupModal(null);
      return;
    }
    void setActiveProviderId(val);
  };

  const liveStepLabel = buildLiveStepSummary(
    aiLiveTraces,
    pendingApprovals.length,
    Boolean(pendingOptionPrompt)
  );
  const isWaitingForUser = pendingApprovals.length > 0 || Boolean(pendingOptionPrompt);

  return (
    <aside className="w-[360px] shrink-0 h-full flex flex-col bg-[#F6F7F9] dark:bg-[#181A1E] border-l border-[#E5E7EB] dark:border-[#262930]">
      {/* Minimal Single-Row Top Header */}
      <div className="h-14 px-4 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between gap-2 shrink-0">
        <span className="text-[13.5px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
          Assistant
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clearChatHistory}
            disabled={chatMessages.length === 0 || aiBusy}
            title="New Chat"
            aria-label="New Chat"
            className="h-7 w-7 rounded-md text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-35 inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <SquarePen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setAiDrawerOpen(false)}
            title="Collapse Assistant"
            aria-label="Collapse Assistant"
            className="h-7 w-7 rounded-md text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Silent-unless-error DPAPI re-entry notice */}
      {activeProvider?.secretStatus === "decrypt_failed" && (
        <div className="mx-3.5 mt-3 p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[11.5px] text-[#DC2626] dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div>Key needs re-entry on this machine.</div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="underline font-medium cursor-pointer"
            >
              Update in Settings
            </button>
          </div>
        </div>
      )}

      {/* Conversation Area / Calm Centered Empty State */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {chatMessages.length === 0 &&
        pendingApprovals.length === 0 &&
        !pendingOptionPrompt &&
        !aiBusy ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-3">
            <div className="max-w-[270px] space-y-4">
              <p className="text-[13px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF] m-0">
                Ask to create commands, run tools, or debug errors. Type{" "}
                <span className="font-mono text-[#111827] dark:text-[#E5E7EB]">@</span> to
                reference a project or command.
              </p>

              {!isActiveConfigured && (
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      openProviderSetupModal(activeProvider?.providerType ?? "gemini")
                    }
                    className="h-8 px-3.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Connect an AI Provider
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                {STARTER_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => void sendChatMessage(chip.prompt)}
                    className="px-2.5 py-1 rounded-md bg-black/[0.04] dark:bg-white/[0.05] hover:bg-black/[0.08] dark:hover:bg-white/[0.09] text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            {chatMessages.map((msg) =>
              msg.role === "user" ? (
                <UserMessageBubble
                  key={msg.id}
                  content={msg.content}
                  mentions={msg.mentions}
                />
              ) : (
                <div key={msg.id} className="px-0.5 space-y-1.5 min-w-0">
                  {msg.toolTraces && msg.toolTraces.length > 0 && (
                    <ToolTraceList traces={msg.toolTraces} />
                  )}
                  {msg.optionCards && msg.optionCards.length > 0 && (
                    <ResolvedOptionCardList cards={msg.optionCards} />
                  )}
                  <MarkdownMessage content={msg.content} isAnimating={false} />
                  {msg.completionChips && msg.completionChips.length > 0 && (
                    <CompletionChipList chips={msg.completionChips} />
                  )}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <SuggestionCardList suggestions={msg.suggestions} />
                  )}
                </div>
              )
            )}

            {/* Live in-flight tool traces, resolved option cards, streaming markdown, and live suggestions */}
            {aiBusy && (
              <div className="px-0.5 space-y-2 min-w-0">
                {aiLiveTraces.length > 0 && <ToolTraceList traces={aiLiveTraces} />}
                {aiLiveOptionCards.length > 0 && (
                  <ResolvedOptionCardList cards={aiLiveOptionCards} />
                )}
                {aiStreamingText.trim().length > 0 && (
                  <MarkdownMessage content={aiStreamingText} isAnimating={true} />
                )}
                {aiLiveSuggestions.length > 0 && (
                  <SuggestionCardList suggestions={aiLiveSuggestions} />
                )}
              </div>
            )}

            {/* Real Interactive Approval Cards (Batch Commands, Single Action, or Multi-Tool Batch) */}
            {pendingApprovals.length === 1 &&
              (pendingApprovals[0].batchCommands &&
              pendingApprovals[0].batchCommands.length > 0 ? (
                <BatchCommandsApprovalCard
                  key={pendingApprovals[0].id}
                  item={pendingApprovals[0]}
                />
              ) : (
                <SingleApprovalCard item={pendingApprovals[0]} />
              ))}
            {pendingApprovals.length > 1 && (
              <BatchApprovalCard items={pendingApprovals} />
            )}

            {/* Interactive Agent Options Card (ask_user_options) */}
            {pendingOptionPrompt && (
              <OptionPromptCard key={pendingOptionPrompt.id} prompt={pendingOptionPrompt} />
            )}
          </div>
        )}
      </div>

      {/* Live Multi-Step Progress Strip above Composer */}
      {aiBusy && (
        <div className="px-3.5 py-2 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#14161A] flex items-center gap-2 text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF] shrink-0">
          {isWaitingForUser ? (
            <span className="w-2 h-2 rounded-full bg-[#D97706] shrink-0" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563EB] shrink-0" />
          )}
          <span className="truncate font-mono text-[11px] text-[#374151] dark:text-[#D1D5DB]">
            {liveStepLabel}
          </span>
        </div>
      )}

      {/* Unified Bottom Composer with @ Mention Autocomplete */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="relative p-3 border-t border-[#E5E7EB] dark:border-[#262930] shrink-0"
      >
        {/* Floating @ Mention Popover directly above input */}
        {mentionTrigger && (
          <div className="absolute left-3 right-3 bottom-full mb-1.5 z-30 rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#14161A] shadow-lg overflow-hidden">
            {mentionResults.flat.length === 0 ? (
              <div className="px-3 py-2.5 text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                No matching projects or commands
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto py-1">
                {mentionResults.projectItems.length > 0 && (
                  <div>
                    <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
                      Projects
                    </div>
                    {mentionResults.projectItems.map((item, idx) => {
                      const active = idx === mentionIndex;
                      return (
                        <button
                          key={`proj_${item.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            insertMention(item);
                          }}
                          onMouseEnter={() => setMentionIndex(idx)}
                          className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 transition-colors cursor-pointer ${
                            active
                              ? "bg-[#2563EB]/12 dark:bg-[#2563EB]/20 text-[#111827] dark:text-[#F3F4F6]"
                              : "text-[#111827] dark:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                          }`}
                        >
                          <Folder className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-medium truncate">
                              {item.label}
                            </div>
                            {item.basePath && (
                              <div className="text-[10.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                                {item.basePath}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {mentionResults.commandItems.length > 0 && (
                  <div
                    className={
                      mentionResults.projectItems.length > 0
                        ? "mt-1 pt-1 border-t border-[#E5E7EB] dark:border-[#262930]"
                        : ""
                    }
                  >
                    <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] dark:text-[#9CA3AF]">
                      Commands
                    </div>
                    {mentionResults.commandItems.map((item, localIdx) => {
                      const flatIdx = mentionResults.projectItems.length + localIdx;
                      const active = flatIdx === mentionIndex;
                      return (
                        <button
                          key={`cmd_${item.id}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            insertMention(item);
                          }}
                          onMouseEnter={() => setMentionIndex(flatIdx)}
                          className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 transition-colors cursor-pointer ${
                            active
                              ? "bg-[#2563EB]/12 dark:bg-[#2563EB]/20 text-[#111827] dark:text-[#F3F4F6]"
                              : "text-[#111827] dark:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                          }`}
                        >
                          <Terminal className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF] shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-medium truncate">
                              {item.label}
                            </div>
                            <div className="text-[10.5px] text-[#6B7280] dark:text-[#9CA3AF] flex items-center gap-1 truncate">
                              <span className="truncate">{item.parentProjectName}</span>
                              {item.engine && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="shrink-0">
                                    {ENGINE_LABELS[item.engine]}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="px-2.5 py-1 border-t border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#111214] flex items-center justify-between text-[10px] text-[#6B7280] dark:text-[#9CA3AF]">
              <span>↑↓ navigate · Enter/Tab insert</span>
              <span>Esc dismiss</span>
            </div>
          </div>
        )}

        <div className="rounded-lg bg-[#FFFFFF] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] focus-within:border-[#2563EB] transition-colors">
          {/* Attached @ Mention Context Chips */}
          {attachedMentions.length > 0 && (
            <div className="px-2.5 pt-2 flex flex-wrap items-center gap-1">
              {attachedMentions.map((m) => (
                <span
                  key={`${m.kind}_${m.id}`}
                  className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-[#2563EB]/10 dark:bg-[#2563EB]/18 text-[#1D4ED8] dark:text-[#93C5FD] text-[11px] font-medium"
                >
                  {m.kind === "project" ? (
                    <Folder className="w-2.5 h-2.5 shrink-0" />
                  ) : (
                    <Terminal className="w-2.5 h-2.5 shrink-0" />
                  )}
                  <span className="truncate max-w-[140px]">@{m.label}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachedMention(m)}
                    aria-label={`Remove @${m.label}`}
                    className="p-0.5 rounded hover:bg-[#2563EB]/20 transition-colors cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            value={draft}
            onChange={handleDraftChange}
            onClick={(e) => {
              const target = e.currentTarget;
              setMentionTrigger(detectActiveMention(target.value, target.selectionStart ?? 0));
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={
              isActiveConfigured
                ? "Ask anything... (@ to mention project or command)"
                : "Connect an AI provider to start..."
            }
            className="w-full resize-none bg-transparent px-3 pt-2.5 pb-1.5 text-[13px] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none"
          />

          {/* Unified Composer Footer: Provider/Model + Permission Mode + Send */}
          <div className="px-2 pb-2 pt-1 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1 min-w-0">
              <CustomSelect
                ariaLabel="Active AI model"
                size="ghost"
                placement="top"
                value={isActiveConfigured ? activeProvider.id : "__connect__"}
                onChange={handleProviderSelectChange}
                className="max-w-[168px]"
                options={[
                  ...(!isActiveConfigured
                    ? [
                        {
                          value: "__connect__",
                          label: "Connect provider...",
                          subtitle: "Set up an API key or local endpoint",
                        },
                      ]
                    : []),
                  ...configuredProviders.map((p) => ({
                    value: p.id,
                    label: p.modelId,
                    subtitle: p.name,
                    dotColor: "bg-[#16A34A]",
                  })),
                  ...(isActiveConfigured
                    ? [
                        {
                          value: "__connect__",
                          label: "+ Connect provider...",
                          dividerBefore: true,
                        },
                      ]
                    : []),
                ]}
              />

              <CustomSelect
                ariaLabel="Agent permission mode"
                size="ghost"
                placement="top"
                align="right"
                value={settings.agentPermissionMode}
                onChange={(val) => void setAgentPermissionMode(val)}
                options={PERMISSION_MODE_OPTIONS}
                className="shrink-0"
              />
            </div>

            <button
              type="submit"
              disabled={aiBusy || !draft.trim()}
              aria-label="Send message"
              className="h-7 w-7 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-35 text-white inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            >
              <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="mt-1.5 px-1 flex items-center justify-between text-[10.5px] text-[#6B7280] dark:text-[#9CA3AF]">
          <span>Guardrails active</span>
          <span>@ mention · Enter to send</span>
        </div>
      </form>
    </aside>
  );
}
