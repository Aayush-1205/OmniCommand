import { AlertTriangle, X } from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { ENGINE_LABELS } from "../../types/omnicommand";

export function ConfirmRunModal() {
  const req = useOmniStore((s) => s.confirmRunModal);
  const resolveConfirmRun = useOmniStore((s) => s.resolveConfirmRun);

  if (!req) return null;

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolveConfirmRun(false);
      }}
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="w-full max-w-[460px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#DC2626] dark:text-red-400">
            <AlertTriangle className="w-4 h-4" />
            <h2 className="text-[14px] font-semibold">{req.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => resolveConfirmRun(false)}
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          {req.warningReason && (
            <p className="text-[12.5px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
              {req.warningReason}
            </p>
          )}

          <pre className="p-3 rounded-md bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] font-mono text-[12px] text-[#111827] dark:text-[#F3F4F6] overflow-x-auto whitespace-pre-wrap break-all">
            {req.commandText}
          </pre>

          <div className="text-[11.5px] font-mono text-[#6B7280] dark:text-[#9CA3AF] space-y-1">
            <div>Engine: {ENGINE_LABELS[req.engine]}</div>
            <div className="truncate">Directory: {req.basePath}</div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveConfirmRun(false)}
              className="h-8 px-3.5 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => resolveConfirmRun(true)}
              className="h-8 px-4 rounded-md bg-[#DC2626] hover:bg-red-700 text-white text-[12.5px] font-medium cursor-pointer"
            >
              Confirm &amp; Execute
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
