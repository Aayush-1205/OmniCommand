import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  X,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import { runtimeBridge } from "../../lib/bridge";
import { validateProviderBaseUrl } from "../../lib/guardrails";
import {
  isLocalLoopbackUrl,
  testProviderConnection,
  type ConnectionTestResult,
} from "../../ai/connectionTester";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import type { ProviderConfig, ProviderType } from "../../types/omnicommand";

const PROVIDER_TYPE_OPTIONS: CustomSelectOption<ProviderType>[] = [
  { value: "gemini", label: "Google Gemini" },
  { value: "claude", label: "Anthropic Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "grok", label: "xAI Grok" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "perplexity", label: "Perplexity" },
  { value: "zai", label: "Z.ai" },
  { value: "custom", label: "Direct / Custom API" },
];

type SettingsTab = "general" | "shortcut" | "providers" | "engines";

const CONFLICTING_SHORTCUTS = new Set([
  "Alt+Tab",
  "Alt+F4",
  "Ctrl+W",
  "Ctrl+Q",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+Shift+Esc",
  "Meta+Space",
  "Meta+L",
]);

function formatKeyChord(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");

  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) {
    return null;
  }

  let normalizedKey = key;
  if (key === " ") normalizedKey = "Space";
  else if (key.length === 1) normalizedKey = key.toUpperCase();

  if (parts.length === 0) return null;
  parts.push(normalizedKey);
  return parts.join("+");
}

export function SettingsModal() {
  const open = useOmniStore((s) => s.settingsOpen);
  const setSettingsOpen = useOmniStore((s) => s.setSettingsOpen);
  const settings = useOmniStore((s) => s.settings);
  const engines = useOmniStore((s) => s.engines);
  const storageRoot = useOmniStore((s) => s.storageRoot);
  const connectionTestResults = useOmniStore((s) => s.connectionTestResults);
  const testingProviderIds = useOmniStore((s) => s.testingProviderIds);

  const updateSettings = useOmniStore((s) => s.updateSettings);
  const saveProviderConfig = useOmniStore((s) => s.saveProviderConfig);
  const deleteCustomProvider = useOmniStore((s) => s.deleteCustomProvider);
  const saveProviderApiKey = useOmniStore((s) => s.saveProviderApiKey);
  const testProviderById = useOmniStore((s) => s.testProviderById);

  const [tab, setTab] = useState<SettingsTab>("general");
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [shortcutWarning, setShortcutWarning] = useState<string | null>(null);

  // Provider editor state
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [provName, setProvName] = useState("");
  const [provType, setProvType] = useState<ProviderType>("custom");
  const [provModelId, setProvModelId] = useState("");
  const [provBaseUrl, setProvBaseUrl] = useState("");
  const [provHeadersText, setProvHeadersText] = useState("");
  const [provApiKey, setProvApiKey] = useState("");
  const [showEditKey, setShowEditKey] = useState(false);
  const [provUrlError, setProvUrlError] = useState<string | null>(null);
  const [editTesting, setEditTesting] = useState(false);
  const [editTestResult, setEditTestResult] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    if (!recordingShortcut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingShortcut(false);
        return;
      }
      const chord = formatKeyChord(e);
      if (!chord) return;

      if (CONFLICTING_SHORTCUTS.has(chord)) {
        setShortcutWarning(
          `"${chord}" conflicts with a reserved OS or window shortcut. Choose another modifier chord.`
        );
        return;
      }
      setShortcutWarning(null);
      setRecordingShortcut(false);
      void updateSettings({ launcherShortcut: chord });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingShortcut, updateSettings]);

  if (!open) return null;

  const isTauri = runtimeBridge.isTauri();

  const startEditProvider = (provider: ProviderConfig | null) => {
    if (provider) {
      setEditingProviderId(provider.id);
      setProvName(provider.name);
      setProvType(provider.providerType);
      setProvModelId(provider.modelId);
      setProvBaseUrl(provider.baseUrl ?? "");
      setProvHeadersText(
        provider.customHeaders ? JSON.stringify(provider.customHeaders, null, 2) : ""
      );
      setProvApiKey("");
    } else {
      setEditingProviderId("__new__");
      setProvName("Custom OpenAI-Compatible");
      setProvType("custom");
      setProvModelId("qwen2.5-coder:14b");
      setProvBaseUrl("http://127.0.0.1:11434/v1");
      setProvHeadersText("");
      setProvApiKey("");
    }
    setShowEditKey(false);
    setProvUrlError(null);
    setEditTestResult(null);
  };

  const handleTestEditForm = async () => {
    const urlCheck = validateProviderBaseUrl(provBaseUrl);
    if (!urlCheck.valid) {
      setProvUrlError(urlCheck.error ?? "Invalid URL.");
      return;
    }

    let customHeaders: Record<string, string> | null = null;
    if (provHeadersText.trim()) {
      try {
        customHeaders = JSON.parse(provHeadersText) as Record<string, string>;
      } catch {
        setProvUrlError("Custom headers must be valid JSON.");
        return;
      }
    }

    setEditTesting(true);
    setEditTestResult(null);
    setProvUrlError(null);

    try {
      let effectiveKey = provApiKey.trim();
      if (!effectiveKey && editingProviderId && editingProviderId !== "__new__") {
        effectiveKey = (await runtimeBridge.getProviderDecryptedKey(editingProviderId)) ?? "";
      }
      const res = await testProviderConnection(
        {
          providerType: provType,
          modelId: provModelId.trim(),
          baseUrl: provBaseUrl.trim() || null,
          customHeaders,
        },
        effectiveKey
      );
      setEditTestResult(res);
    } finally {
      setEditTesting(false);
    }
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provName.trim() || !provModelId.trim()) return;

    const urlCheck = validateProviderBaseUrl(provBaseUrl);
    if (!urlCheck.valid) {
      setProvUrlError(urlCheck.error ?? "Invalid URL.");
      return;
    }

    let customHeaders: Record<string, string> | null = null;
    if (provHeadersText.trim()) {
      try {
        customHeaders = JSON.parse(provHeadersText) as Record<string, string>;
      } catch {
        setProvUrlError("Custom headers must be valid JSON key/value object.");
        return;
      }
    }

    const existing = settings.providers.find((p) => p.id === editingProviderId);
    const id = existing ? existing.id : `prov_${crypto.randomUUID().slice(0, 8)}`;
    const allowKeylessLocal = provType === "custom" && isLocalLoopbackUrl(provBaseUrl);

    const updated: ProviderConfig = {
      id,
      name: provName.trim(),
      providerType: provType,
      modelId: provModelId.trim(),
      baseUrl: provBaseUrl.trim() || null,
      customHeaders,
      encryptedApiKey: existing?.encryptedApiKey ?? null,
      secretStatus: existing?.secretStatus ?? "missing",
      secretError: existing?.secretError ?? null,
    };

    await saveProviderConfig(updated);
    if (provApiKey.trim() || allowKeylessLocal) {
      await saveProviderApiKey(id, provApiKey.trim(), { allowKeylessLocal });
    }
    setEditingProviderId(null);
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setRecordingShortcut(false);
          setSettingsOpen(false);
        }
      }}
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-[760px] h-[580px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-5 h-12 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between shrink-0">
          <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
            Settings
          </h2>
          <button
            type="button"
            onClick={() => {
              setRecordingShortcut(false);
              setSettingsOpen(false);
            }}
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body split */}
        <div className="flex-1 min-h-0 flex">
          {/* Left Tab Rail */}
          <nav className="w-44 shrink-0 p-2.5 border-r border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#111214] space-y-1">
            {(
              [
                { id: "general", label: "General & Tray", icon: Sliders },
                { id: "shortcut", label: "Quick Launcher", icon: Keyboard },
                { id: "providers", label: "AI Providers", icon: KeyRound },
                { id: "engines", label: "Engines & Storage", icon: HardDrive },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full px-2.5 py-2 rounded-md text-[12.5px] font-medium flex items-center gap-2 transition-colors text-left cursor-pointer ${
                    active
                      ? "bg-[#2563EB]/12 text-[#2563EB] dark:text-[#60A5FA]"
                      : "text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Tab Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {tab === "general" && (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <label className="block text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                    Appearance
                  </label>
                  <div className="inline-flex p-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.06]">
                    {(["dark", "light"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => void updateSettings({ theme: mode })}
                        className={`h-7 px-4 rounded text-[12px] font-medium capitalize transition-colors cursor-pointer ${
                          settings.theme === mode
                            ? "bg-[#FFFFFF] dark:bg-[#111214] text-[#111827] dark:text-[#F3F4F6] shadow-xs"
                            : "text-[#6B7280] dark:text-[#9CA3AF]"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-[#E5E7EB] dark:border-[#262930]">
                  <div className="text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                    Windows System Tray Residency
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.closeToTray}
                      onChange={(e) => void updateSettings({ closeToTray: e.target.checked })}
                      className="mt-0.5 accent-[#2563EB]"
                    />
                    <span className="text-[12.5px] text-[#111827] dark:text-[#F3F4F6]">
                      Hide to System Tray on close
                      <span className="block text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                        Keeps global shortcut active with minimal background RAM.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.unloadWebviewOnClose}
                      disabled={!settings.closeToTray}
                      onChange={(e) =>
                        void updateSettings({ unloadWebviewOnClose: e.target.checked })
                      }
                      className="mt-0.5 accent-[#2563EB]"
                    />
                    <span className="text-[12.5px] text-[#111827] dark:text-[#F3F4F6]">
                      Unload WebView2 when hidden to tray
                      <span className="block text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                        Flushes active AI chat and selected project to session.json before destroying WebView2 so state restores cleanly on re-open.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[#E5E7EB] dark:border-[#262930]">
                  <label className="block text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                    Command Execution Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={3600}
                    value={settings.commandTimeoutSec}
                    onChange={(e) =>
                      void updateSettings({
                        commandTimeoutSec: Math.max(5, Number(e.target.value) || 120),
                      })
                    }
                    className="w-32 h-8 px-3 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
                  />
                  <p className="text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF]">
                    Processes exceeding this limit are terminated with their child process tree (Windows Job Object + taskkill /F /T).
                  </p>
                </div>
              </div>
            )}

            {tab === "shortcut" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
                    Global Quick Launcher Shortcut
                  </h3>
                  <p className="text-[12px] text-[#6B7280] dark:text-[#9CA3AF] mt-1">
                    Defaults to Shift+Space via @tauri-apps/plugin-global-shortcut. Includes a Window-Focus Guard so typing inside AI chat or console stdin never triggers the launcher accidentally.
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShortcutWarning(null);
                      setRecordingShortcut((r) => !r);
                    }}
                    className={`h-9 px-4 rounded-md border font-mono text-[13px] transition-colors cursor-pointer ${
                      recordingShortcut
                        ? "border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB] dark:text-[#60A5FA]"
                        : "border-[#E5E7EB] dark:border-[#262930] bg-[#F6F7F9] dark:bg-[#111214] text-[#111827] dark:text-[#F3F4F6]"
                    }`}
                  >
                    {recordingShortcut ? "Press modifier + key..." : settings.launcherShortcut}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRecordingShortcut(false);
                      setShortcutWarning(null);
                      void updateSettings({ launcherShortcut: "Shift+Space" });
                    }}
                    className="h-9 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Default
                  </button>
                </div>

                {shortcutWarning && (
                  <div className="p-3 rounded-md border border-[#D97706]/35 bg-[#D97706]/10 text-[12px] text-[#D97706] dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{shortcutWarning}</span>
                  </div>
                )}
              </div>
            )}

            {tab === "providers" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
                      AI Providers
                    </h3>
                    <p className="text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
                      {isTauri
                        ? "API keys are encrypted at rest via Windows DPAPI (CurrentUser scope) and sent through @tauri-apps/plugin-http."
                        : "Configure any provider below and run Test Connection to verify credentials and model access."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEditProvider(null)}
                    className="h-8 px-3 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Custom
                  </button>
                </div>

                {editingProviderId && (
                  <form
                    onSubmit={(e) => void handleSaveProvider(e)}
                    className="p-3.5 rounded-lg border border-[#2563EB]/40 bg-[#F6F7F9] dark:bg-[#111214] space-y-3"
                  >
                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={provName}
                        onChange={(e) => setProvName(e.target.value)}
                        placeholder="Provider display name"
                        className="h-8 px-2.5 rounded-md text-[12.5px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]"
                      />
                      <CustomSelect
                        ariaLabel="Provider type"
                        value={provType}
                        onChange={setProvType}
                        options={PROVIDER_TYPE_OPTIONS}
                        size="sm"
                        className="w-full bg-[#FFFFFF] dark:bg-[#181A1E]"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={provModelId}
                        onChange={(e) => {
                          setProvModelId(e.target.value);
                          setEditTestResult(null);
                        }}
                        placeholder="Model ID (e.g. gemini-2.5-flash)"
                        className="h-8 px-2.5 rounded-md font-mono text-[12px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]"
                      />
                      <input
                        type="text"
                        value={provBaseUrl}
                        onChange={(e) => {
                          setProvBaseUrl(e.target.value);
                          setProvUrlError(null);
                          setEditTestResult(null);
                        }}
                        placeholder="Base URL (optional for standard providers)"
                        className="h-8 px-2.5 rounded-md font-mono text-[12px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]"
                      />
                    </div>

                    <div className="relative">
                      <input
                        type={showEditKey ? "text" : "password"}
                        value={provApiKey}
                        onChange={(e) => {
                          setProvApiKey(e.target.value);
                          setEditTestResult(null);
                        }}
                        placeholder={
                          editingProviderId !== "__new__" &&
                          settings.providers.find((p) => p.id === editingProviderId)
                            ?.secretStatus === "configured"
                            ? "Enter new API key to replace stored key (leave blank to keep)"
                            : "API key (optional for local loopback endpoints)"
                        }
                        autoComplete="off"
                        className="w-full h-8 pl-2.5 pr-8 rounded-md font-mono text-[12px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditKey((v) => !v)}
                        aria-label={showEditKey ? "Hide API key" : "Show API key"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
                      >
                        {showEditKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <input
                      type="text"
                      value={provHeadersText}
                      onChange={(e) => setProvHeadersText(e.target.value)}
                      placeholder='Optional custom headers JSON, e.g. {"HTTP-Referer":"https://omnicommand.dev"}'
                      className="w-full h-8 px-2.5 rounded-md font-mono text-[11.5px] bg-[#FFFFFF] dark:bg-[#181A1E] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]"
                    />

                    {editTestResult && (
                      <div className="flex items-center gap-2 text-[11.5px] tabular-nums">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            editTestResult.ok ? "bg-[#16A34A]" : "bg-[#DC2626]"
                          }`}
                        />
                        <span
                          className={
                            editTestResult.ok
                              ? "text-[#16A34A] dark:text-emerald-400"
                              : "text-[#DC2626] dark:text-red-400"
                          }
                        >
                          {editTestResult.message}
                        </span>
                      </div>
                    )}

                    {provUrlError && (
                      <p className="text-[11.5px] text-[#DC2626] dark:text-red-400">
                        {provUrlError}
                      </p>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        disabled={editTesting}
                        onClick={() => void handleTestEditForm()}
                        className="h-7 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {editTesting && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span>{editTesting ? "Testing..." : "Test Connection"}</span>
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingProviderId(null)}
                          className="h-7 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] text-[#111827] dark:text-[#F3F4F6] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="h-7 px-3 rounded-md bg-[#2563EB] text-white text-[12px] font-medium cursor-pointer"
                        >
                          Save Provider
                        </button>
                      </div>
                    </div>
                  </form>
                )}

                <div className="divide-y divide-[#E5E7EB] dark:divide-[#262930] border border-[#E5E7EB] dark:border-[#262930] rounded-lg overflow-hidden">
                  {settings.providers.map((p) => {
                    const isConfigured = p.secretStatus === "configured";
                    const isTesting = Boolean(testingProviderIds[p.id]);
                    const lastTest = connectionTestResults[p.id];

                    return (
                      <div
                        key={p.id}
                        className="p-3 bg-[#FFFFFF] dark:bg-[#111214] space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-medium text-[#111827] dark:text-[#F3F4F6] flex items-center gap-2">
                              <span className="truncate">{p.name}</span>
                              <span className="font-mono text-[11px] text-[#6B7280] dark:text-[#9CA3AF] truncate">
                                {p.modelId}
                              </span>
                            </div>
                            {p.baseUrl && (
                              <div className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF] truncate">
                                {p.baseUrl}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2.5 shrink-0 text-[11.5px]">
                            <span
                              className={`inline-flex items-center gap-1.5 whitespace-nowrap ${
                                isConfigured
                                  ? "text-[#16A34A]"
                                  : p.secretStatus === "decrypt_failed"
                                    ? "text-[#DC2626]"
                                    : "text-[#6B7280] dark:text-[#9CA3AF]"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isConfigured
                                    ? "bg-[#16A34A]"
                                    : p.secretStatus === "decrypt_failed"
                                      ? "bg-[#DC2626]"
                                      : "bg-[#9CA3AF]/60"
                                }`}
                              />
                              {isConfigured
                                ? isTauri
                                  ? "DPAPI ready"
                                  : "Configured"
                                : p.secretStatus === "decrypt_failed"
                                  ? "Key needs re-entry on this machine"
                                  : "Not configured"}
                            </span>

                            {isConfigured && (
                              <button
                                type="button"
                                disabled={isTesting}
                                onClick={() => void testProviderById(p.id)}
                                className="h-6 px-2 rounded border border-[#E5E7EB] dark:border-[#262930] text-[11px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                              >
                                {isTesting && <Loader2 className="w-3 h-3 animate-spin" />}
                                <span>Test</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => startEditProvider(p)}
                              className="text-[#2563EB] dark:text-[#60A5FA] hover:underline whitespace-nowrap cursor-pointer"
                            >
                              {isConfigured ? "Edit" : "Configure"}
                            </button>

                            {p.providerType === "custom" && p.id !== "custom-local" && (
                              <button
                                type="button"
                                onClick={() => void deleteCustomProvider(p.id)}
                                title="Remove custom provider"
                                className="text-[#6B7280] hover:text-[#DC2626] cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {lastTest && (
                          <div className="flex items-center gap-1.5 text-[11.5px] tabular-nums">
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                lastTest.ok ? "bg-[#16A34A]" : "bg-[#DC2626]"
                              }`}
                            />
                            <span
                              className={
                                lastTest.ok
                                  ? "text-[#16A34A] dark:text-emerald-400"
                                  : "text-[#DC2626] dark:text-red-400"
                              }
                            >
                              {lastTest.message}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "engines" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
                    <Cpu className="w-4 h-4 text-[#2563EB]" />
                    Detected Shell Engines
                  </div>
                  <div className="divide-y divide-[#E5E7EB] dark:divide-[#262930] rounded-lg border border-[#E5E7EB] dark:border-[#262930] overflow-hidden">
                    {engines.map((eng) => (
                      <div
                        key={eng.engine}
                        className="px-3.5 py-2.5 bg-[#FFFFFF] dark:bg-[#111214] flex items-center justify-between gap-3 text-[12.5px]"
                      >
                        <div>
                          <div className="font-medium text-[#111827] dark:text-[#F3F4F6]">
                            {eng.label}
                          </div>
                          <div className="text-[11px] font-mono text-[#6B7280] dark:text-[#9CA3AF]">
                            {eng.binaryPath ?? "Not detected on PATH"}
                          </div>
                        </div>
                        <div className="text-[11.5px] font-mono tabular-nums flex items-center gap-2">
                          {eng.version && (
                            <span className="text-[#6B7280] dark:text-[#9CA3AF]">
                              v{eng.version}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 ${
                              eng.available ? "text-[#16A34A]" : "text-[#DC2626]"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                eng.available ? "bg-[#16A34A]" : "bg-[#DC2626]"
                              }`}
                            />
                            {eng.available ? "Available" : "Missing"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[#E5E7EB] dark:border-[#262930]">
                  <div className="text-[13px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
                    Atomic Local JSON Storage
                  </div>
                  <div className="px-3 py-2 rounded-md font-mono text-[12px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6]">
                    {storageRoot}
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-[#6B7280] dark:text-[#9CA3AF]">
                    Files: projects.json, commands.json, settings.json, executions.json (last 500), session.json, logs/&lt;exec_id&gt;.log, and rotating .bak copies under backups/. Every write uses a Rust tokio::sync::Mutex with temp-file fsync and atomic rename.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
