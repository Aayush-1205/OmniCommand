import { Suspense, lazy, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useOmniStore } from "./store/useOmniStore";
import { runtimeBridge } from "./lib/bridge";
import { Sidebar } from "./components/layout/Sidebar";
import { WorkspaceHeader } from "./components/layout/WorkspaceHeader";
import { CommandList } from "./components/commands/CommandList";
import { AdHocBar } from "./components/commands/AdHocBar";
import { EmbeddedConsole } from "./components/console/EmbeddedConsole";
import { AiDrawer } from "./components/ai/AiDrawer";

// Lazy-load heavy overlays & modals so initial WebView2 cold-start render is instantaneous
const QuickLauncher = lazy(() =>
  import("./components/launcher/QuickLauncher").then((m) => ({ default: m.QuickLauncher }))
);
const ProjectModal = lazy(() =>
  import("./components/modals/ProjectModal").then((m) => ({ default: m.ProjectModal }))
);
const CommandModal = lazy(() =>
  import("./components/modals/CommandModal").then((m) => ({ default: m.CommandModal }))
);
const BasePathPickerModal = lazy(() =>
  import("./components/modals/BasePathPickerModal").then((m) => ({
    default: m.BasePathPickerModal,
  }))
);
const ConfirmRunModal = lazy(() =>
  import("./components/modals/ConfirmRunModal").then((m) => ({ default: m.ConfirmRunModal }))
);
const VariablePromptModal = lazy(() =>
  import("./components/modals/VariablePromptModal").then((m) => ({
    default: m.VariablePromptModal,
  }))
);
const ProviderSetupModal = lazy(() =>
  import("./components/modals/ProviderSetupModal").then((m) => ({
    default: m.ProviderSetupModal,
  }))
);
const SettingsModal = lazy(() =>
  import("./components/settings/SettingsModal").then((m) => ({ default: m.SettingsModal }))
);

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const tokens = shortcut.split("+").map((t) => t.trim().toLowerCase());
  const needsCtrl = tokens.includes("ctrl");
  const needsAlt = tokens.includes("alt");
  const needsShift = tokens.includes("shift");
  const needsMeta = tokens.includes("meta");
  const keyToken = tokens[tokens.length - 1];

  if (
    e.ctrlKey !== needsCtrl ||
    e.altKey !== needsAlt ||
    e.shiftKey !== needsShift ||
    e.metaKey !== needsMeta
  ) {
    return false;
  }

  if (keyToken === "space") {
    return e.code === "Space" || e.key === " ";
  }
  return e.key.toLowerCase() === keyToken;
}

export default function App() {
  const initialize = useOmniStore((s) => s.initialize);
  const initialized = useOmniStore((s) => s.initialized);
  const launcherShortcut = useOmniStore((s) => s.settings.launcherShortcut);
  const launcherOpen = useOmniStore((s) => s.launcherOpen);
  const settingsOpen = useOmniStore((s) => s.settingsOpen);
  const providerSetupModalOpen = useOmniStore((s) => s.providerSetupModalOpen);
  const projectModalOpen = useOmniStore((s) => s.projectModalState.open);
  const commandModalOpen = useOmniStore((s) => s.commandModalState.open);
  const basePathPickerOpen = useOmniStore((s) => Boolean(s.basePathPicker));
  const confirmRunOpen = useOmniStore((s) => Boolean(s.confirmRunModal));
  const variablePromptOpen = useOmniStore((s) => Boolean(s.variablePromptModal));
  const setLauncherOpen = useOmniStore((s) => s.setLauncherOpen);
  const toasts = useOmniStore((s) => s.toasts);
  const dismissToast = useOmniStore((s) => s.dismissToast);
  const revealedRef = useRef(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void initialize().then((fn) => {
      cleanup = fn;
    });
    return () => {
      cleanup?.();
    };
  }, [initialize]);

  // Zero-flash cold start: once React hydrates initial state & theme, reveal the hidden
  // Tauri "main" window and open the Quick Launcher if summoned via Shift+Space/tray.
  useEffect(() => {
    if (!initialized || revealedRef.current) return;
    revealedRef.current = true;
    requestAnimationFrame(() => {
      void runtimeBridge.revealMainWindow().then((shouldOpenLauncher) => {
        if (shouldOpenLauncher) {
          setLauncherOpen(true);
        }
      });
    });
  }, [initialized, setLauncherOpen]);

  // Window-Focus Guard for Quick Launcher shortcut (Shift+Space default):
  // Rust pauses the OS global hook while OmniCommand is focused; this listener handles
  // Shift+Space inside the app while ignoring focus inside any <input>/<textarea>.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (settingsOpen || providerSetupModalOpen || variablePromptOpen) return;
      if (!matchesShortcut(e, launcherShortcut)) return;
      if (isEditableElement(document.activeElement) || isEditableElement(e.target)) {
        return;
      }
      e.preventDefault();
      setLauncherOpen(!launcherOpen);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    launcherShortcut,
    launcherOpen,
    settingsOpen,
    providerSetupModalOpen,
    variablePromptOpen,
    setLauncherOpen,
  ]);

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#FFFFFF] dark:bg-[#111214] text-[#6B7280] dark:text-[#9CA3AF] text-[13px]">
        Initializing OmniCommand...
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-[#FFFFFF] dark:bg-[#111214] text-[#111827] dark:text-[#F3F4F6]">
      {/* Zone 1: Left Sidebar */}
      <Sidebar />

      {/* Zone 2: Center Workspace + Ad-Hoc Bar + Resizable Virtualized Console */}
      <main className="flex-1 min-w-0 h-full flex flex-col">
        <WorkspaceHeader />
        <CommandList />
        <AdHocBar />
        <EmbeddedConsole />
      </main>

      {/* Zone 3: Collapsible Right AI Assistant Drawer */}
      <AiDrawer />

      {/* Lazy-Loaded Floating Overlays & Modals */}
      <Suspense fallback={null}>
        {launcherOpen && <QuickLauncher />}
        {projectModalOpen && <ProjectModal />}
        {commandModalOpen && <CommandModal />}
        {basePathPickerOpen && <BasePathPickerModal />}
        {confirmRunOpen && <ConfirmRunModal />}
        {variablePromptOpen && <VariablePromptModal />}
        {providerSetupModalOpen && <ProviderSetupModal />}
        {settingsOpen && <SettingsModal />}
      </Suspense>

      {/* Minimalist Toast Stack */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
        >
          {toasts.map((t) => {
            const dot =
              t.tone === "error"
                ? "bg-[#DC2626]"
                : t.tone === "warning"
                  ? "bg-[#D97706]"
                  : t.tone === "success"
                    ? "bg-[#16A34A]"
                    : "bg-[#2563EB]";
            return (
              <div
                key={t.id}
                className="pointer-events-auto px-3.5 py-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-lg flex items-center gap-2.5 text-[12.5px] text-[#111827] dark:text-[#F3F4F6]"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                <span className="flex-1 leading-snug">{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
