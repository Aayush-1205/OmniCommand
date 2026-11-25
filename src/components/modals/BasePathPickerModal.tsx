import { useEffect, useState } from "react";
import { Folder, FolderOpen, X } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { runtimeBridge } from "../../lib/bridge";
import { validateLocalPathClient } from "../../lib/guardrails";

export function BasePathPickerModal() {
  const picker = useOmniStore((s) => s.basePathPicker);
  const projects = useOmniStore((s) => s.projects);
  const resolveGlobalBasePath = useOmniStore((s) => s.resolveGlobalBasePath);

  const [customPath, setCustomPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerNotice, setPickerNotice] = useState<string | null>(null);

  useEffect(() => {
    if (picker) {
      setCustomPath(picker.suggestedPath ?? "C:\\Users\\Dev\\Workspace");
      setError(null);
      setPickerNotice(null);
    }
  }, [picker]);

  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolveGlobalBasePath(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, resolveGlobalBasePath]);

  if (!picker) return null;

  const validation = customPath.trim() ? validateLocalPathClient(customPath) : null;

  const handleBrowse = async () => {
    setPickerNotice(null);
    const result = await runtimeBridge.pickFolderNative({
      title: picker.title || "Select Base Path",
      defaultPath: customPath.trim() || undefined,
    });
    if (result.path) {
      const check = validateLocalPathClient(result.path);
      setCustomPath(check.canonicalPath ?? result.path);
      if (!check.valid) {
        setError(check.blockedReason);
      } else {
        setError(null);
      }
    }
    if (result.notice) {
      setPickerNotice(result.notice);
    }
  };

  const handleConfirmCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateLocalPathClient(customPath);
    if (!check.valid) {
      setError(check.blockedReason ?? "Invalid directory path.");
      return;
    }
    resolveGlobalBasePath(check.canonicalPath ?? customPath.trim());
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolveGlobalBasePath(null);
      }}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select Base Path"
        className="w-full max-w-[480px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6] truncate">
              {picker.title}
            </h2>
            {picker.commandName && (
              <p className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate mt-0.5">
                {picker.commandName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => resolveGlobalBasePath(null)}
            aria-label="Cancel directory selection"
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {projects.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-medium text-[#6B7280] dark:text-[#9CA3AF]">
                Recent Project Directories
              </div>
              <div className="divide-y divide-[#E5E7EB] dark:divide-[#262930] rounded-md border border-[#E5E7EB] dark:border-[#262930] overflow-hidden">
                {projects.slice(0, 5).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => resolveGlobalBasePath(p.basePath)}
                    className="w-full px-3 py-2 flex items-center gap-2.5 text-left bg-[#FFFFFF] dark:bg-[#111214] hover:bg-[#F6F7F9] dark:hover:bg-[#1E2026] transition-colors cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] truncate">
                        {p.name}
                      </div>
                      <div className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                        {p.basePath}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleConfirmCustom} className="space-y-2">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Target Windows Directory
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={customPath}
                onChange={(e) => {
                  setCustomPath(e.target.value);
                  setError(null);
                }}
                placeholder="C:\Users\Name\Workspace"
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

            {(error || (validation && !validation.valid)) && (
              <p className="text-[11.5px] text-[#DC2626] dark:text-red-400">
                {error ?? validation?.blockedReason}
              </p>
            )}

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveGlobalBasePath(null)}
                className="h-8 px-3.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(validation && !validation.valid)}
                className="h-8 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-45 text-white text-[12.5px] font-medium cursor-pointer"
              >
                Run in Directory
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
