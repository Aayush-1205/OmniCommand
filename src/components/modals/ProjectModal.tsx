import { useEffect, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { runtimeBridge } from "../../lib/bridge";
import { validateLocalPathClient } from "../../lib/guardrails";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import { ENGINE_LABELS, ENGINE_ORDER, type EngineType } from "../../types/omnicommand";

const ENGINE_OPTIONS: CustomSelectOption<EngineType>[] = ENGINE_ORDER.map((eng) => ({
  value: eng,
  label: ENGINE_LABELS[eng],
}));

export function ProjectModal() {
  const { open, editing } = useOmniStore((s) => s.projectModalState);
  const closeProjectModal = useOmniStore((s) => s.closeProjectModal);
  const createProject = useOmniStore((s) => s.createProject);
  const updateProject = useOmniStore((s) => s.updateProject);

  const [name, setName] = useState("");
  const [basePath, setBasePath] = useState("");
  const [defaultEngine, setDefaultEngine] = useState<EngineType>("powershell");
  const [error, setError] = useState<string | null>(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setBasePath(editing?.basePath ?? "");
      setDefaultEngine(editing?.defaultEngine ?? "powershell");
      setError(null);
      setPickerNotice(null);
      setSaving(false);
    }
  }, [open, editing]);

  if (!open) return null;

  const livePathCheck = basePath.trim() ? validateLocalPathClient(basePath) : null;

  const handleBrowse = async () => {
    setPickerNotice(null);
    const result = await runtimeBridge.pickFolderNative({
      title: "Select Project Base Path",
      defaultPath: basePath.trim() || undefined,
    });
    if (result.path) {
      setBasePath(result.path);
      setError(null);
    }
    if (result.notice) {
      setPickerNotice(result.notice);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateProject(editing.id, { name, basePath, defaultEngine });
      } else {
        await createProject({ name, basePath, defaultEngine });
      }
      closeProjectModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeProjectModal();
      }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "Edit Project" : "New Project"}
        className="w-full max-w-[460px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
            {editing ? "Edit Project" : "New Project"}
          </h2>
          <button
            type="button"
            onClick={closeProjectModal}
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Project Name
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Backend API"
              className="w-full h-9 px-3 rounded-md text-[13px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Windows Base Path
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={basePath}
                onChange={(e) => {
                  setBasePath(e.target.value);
                  setError(null);
                }}
                placeholder="C:\Users\Dev\Projects\backend-api"
                className="flex-1 h-9 px-3 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
              />
              <button
                type="button"
                onClick={() => void handleBrowse()}
                className="h-9 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#6B7280] dark:text-[#9CA3AF]" />
                Browse
              </button>
            </div>
            {pickerNotice && (
              <p className="text-[11.5px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
                {pickerNotice}
              </p>
            )}
            {livePathCheck && !livePathCheck.valid && (
              <p className="text-[11.5px] text-[#DC2626] dark:text-red-400">
                {livePathCheck.blockedReason}
              </p>
            )}
            {livePathCheck?.valid && livePathCheck.canonicalPath && (
              <p className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF]">
                Canonical (dunce): {livePathCheck.canonicalPath}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Default Shell Engine
            </label>
            <CustomSelect
              ariaLabel="Default Shell Engine"
              value={defaultEngine}
              onChange={setDefaultEngine}
              options={ENGINE_OPTIONS}
              className="w-full"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[12px] text-[#DC2626] dark:text-red-300">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeProjectModal}
              className="h-8 px-3.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (livePathCheck !== null && !livePathCheck.valid)}
              className="h-8 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-45 text-white text-[12.5px] font-medium cursor-pointer"
            >
              {editing ? "Save Changes" : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
