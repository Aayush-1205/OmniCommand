import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { checkCommandGuardrails } from "../../lib/guardrails";
import { parseCommandVariables } from "../../lib/variables";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import {
  ENGINE_LABELS,
  ENGINE_ORDER,
  type EngineType,
  type RiskLevel,
  type RunPolicy,
} from "../../types/omnicommand";

const ENGINE_OPTIONS: CustomSelectOption<EngineType>[] = ENGINE_ORDER.map((eng) => ({
  value: eng,
  label: ENGINE_LABELS[eng],
}));

const RISK_OPTIONS: CustomSelectOption<RiskLevel>[] = [
  {
    value: "low",
    label: "Low",
    dotColor: "bg-[#16A34A]",
    subtitle: "Safe read-only or standard build command",
  },
  {
    value: "medium",
    label: "Medium",
    dotColor: "bg-[#D97706]",
    subtitle: "Modifies files, dependencies, or git state",
  },
  {
    value: "high",
    label: "High",
    dotColor: "bg-[#DC2626]",
    subtitle: "Always prompts for explicit confirmation",
  },
];

const RUN_POLICY_OPTIONS: CustomSelectOption<RunPolicy>[] = [
  {
    value: "inherit",
    label: "Inherit",
    subtitle: "Follow the active AI Assistant permission mode",
  },
  {
    value: "auto",
    label: "Auto",
    subtitle: "Run automatically when permitted by risk policy",
  },
  {
    value: "ask",
    label: "Ask",
    subtitle: "Always request approval before AI execution",
  },
];

export function CommandModal() {
  const { open, editing } = useOmniStore((s) => s.commandModalState);
  const projects = useOmniStore((s) => s.projects);
  const selectedProjectId = useOmniStore((s) => s.selectedProjectId);
  const activeEngineOverride = useOmniStore((s) => s.activeEngineOverride);
  const closeCommandModal = useOmniStore((s) => s.closeCommandModal);
  const createCommand = useOmniStore((s) => s.createCommand);
  const updateCommand = useOmniStore((s) => s.updateCommand);

  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [command, setCommand] = useState("");
  const [engine, setEngine] = useState<EngineType>("powershell");
  const [placement, setPlacement] = useState<string>("__global__");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [runPolicy, setRunPolicy] = useState<RunPolicy>("inherit");
  const [aiAllowed, setAiAllowed] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setAlias(editing?.alias ?? "");
      setCommand(editing?.command ?? "");
      setEngine(editing?.engine ?? activeEngineOverride);
      setPlacement(editing ? editing.projectId ?? "__global__" : selectedProjectId ?? "__global__");
      setRiskLevel(editing?.riskLevel ?? "low");
      setRunPolicy(editing?.runPolicy ?? "inherit");
      setAiAllowed(editing?.aiAllowed ?? false);
      setDescription(editing?.description ?? "");
      setError(null);
    }
  }, [open, editing, selectedProjectId, activeEngineOverride]);

  const detectedVariables = useMemo(() => parseCommandVariables(command), [command]);

  const placementOptions = useMemo<CustomSelectOption<string>[]>(
    () => [
      {
        value: "__global__",
        label: "Global Root (Universal)",
        subtitle: "Prompts for directory if no project is active",
      },
      ...projects.map((p) => ({
        value: p.id,
        label: p.name,
        subtitle: p.basePath,
      })),
    ],
    [projects]
  );

  if (!open) return null;

  const guardrail = command.trim() ? checkCommandGuardrails(command) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) {
      setError("Command name and command string are required.");
      return;
    }
    try {
      const payload = {
        projectId: placement === "__global__" ? null : placement,
        name,
        alias,
        command,
        engine,
        riskLevel,
        runPolicy,
        aiAllowed,
        description,
      };
      if (editing) {
        await updateCommand(editing.id, payload);
      } else {
        await createCommand(payload);
      }
      closeCommandModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeCommandModal();
      }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit Command" : "New Command"}
        className="w-full max-w-[540px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {editing ? "Edit Command" : "New Command"}
          </h2>
          <button
            type="button"
            onClick={closeCommandModal}
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Name
              </label>
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Git Commit"
                className="w-full h-9 px-3 rounded-md text-[13px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Alias
              </label>
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. commit"
                className="w-full h-9 px-3 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Command
            </label>
            <textarea
              rows={2}
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setError(null);
              }}
              placeholder='e.g. New-Item -Path {base_path}\{file_name:notes}.txt'
              className="w-full px-3 py-2 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB] resize-none"
            />
            {detectedVariables.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                <span>Variables:</span>
                {detectedVariables.map((v, idx) => (
                  <span key={v.name} className="inline-flex items-center">
                    <code className="font-mono text-[#111827] dark:text-[#E5E7EB]">
                      {v.name}
                      {v.defaultValue !== undefined ? (
                        <span className="text-[#6B7280] dark:text-[#9CA3AF]">
                          :{v.defaultValue}
                        </span>
                      ) : null}
                    </code>
                    {v.kind === "directory" && (
                      <span className="ml-1 text-[10px] uppercase text-[#6B7280] dark:text-[#9CA3AF]">
                        (dir)
                      </span>
                    )}
                    {idx < detectedVariables.length - 1 && <span className="mr-0.5">,</span>}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
              Tip: Use <code className="font-mono">{"{name}"}</code>,{" "}
              <code className="font-mono">{"{{name}}"}</code>, or{" "}
              <code className="font-mono">{"{name:default}"}</code> for runtime inputs.
            </p>
            {guardrail?.blocked && (
              <p className="text-[11.5px] text-[#DC2626] dark:text-red-400">
                {guardrail.reason}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Engine
              </label>
              <CustomSelect
                ariaLabel="Engine"
                value={engine}
                onChange={setEngine}
                options={ENGINE_OPTIONS}
                className="w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Placement
              </label>
              <CustomSelect
                ariaLabel="Placement"
                value={placement}
                onChange={setPlacement}
                options={placementOptions}
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Risk Level
              </label>
              <CustomSelect
                ariaLabel="Risk Level"
                value={riskLevel}
                onChange={setRiskLevel}
                options={RISK_OPTIONS}
                className="w-full"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                Run Policy
              </label>
              <CustomSelect
                ariaLabel="Run Policy"
                value={runPolicy}
                onChange={setRunPolicy}
                options={RUN_POLICY_OPTIONS}
                className="w-full"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note on what this command does"
              className="w-full h-9 px-3 rounded-md text-[13px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={aiAllowed}
              onChange={(e) => setAiAllowed(e.target.checked)}
              className="mt-0.5 rounded accent-[#2563EB]"
            />
            <span className="text-[12.5px] text-[#111827] dark:text-[#F3F4F6]">
              Allow AI auto-run in <strong>Selected Commands</strong> mode
              <span className="block text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                High-risk commands always prompt for confirmation regardless of this setting.
              </span>
            </span>
          </label>

          {error && (
            <div className="p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[12px] text-[#DC2626] dark:text-red-300">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeCommandModal}
              className="h-8 px-3.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(guardrail?.blocked)}
              className="h-8 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-45 text-white text-[12.5px] font-medium cursor-pointer"
            >
              {editing ? "Save Command" : "Create Command"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
