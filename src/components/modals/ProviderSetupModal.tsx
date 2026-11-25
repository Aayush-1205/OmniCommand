import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  X,
} from "lucide-react";
import { useOmniStore } from "../../store/useOmniStore";
import {
  isLocalLoopbackUrl,
  PROVIDER_PRESETS,
  testProviderConnection,
  type ConnectionTestResult,
} from "../../ai/connectionTester";
import { validateProviderBaseUrl } from "../../lib/guardrails";
import { CustomSelect, type CustomSelectOption } from "../ui/CustomSelect";
import type { ProviderConfig, ProviderType } from "../../types/omnicommand";

const PROVIDER_PRESET_OPTIONS: CustomSelectOption<ProviderType>[] = PROVIDER_PRESETS.map((p) => ({
  value: p.type,
  label: p.label,
  subtitle: p.defaultModel,
}));

export function ProviderSetupModal() {
  const open = useOmniStore((s) => s.providerSetupModalOpen);
  const initialPreset = useOmniStore((s) => s.providerSetupInitialPreset);
  const settings = useOmniStore((s) => s.settings);
  const closeProviderSetupModal = useOmniStore((s) => s.closeProviderSetupModal);
  const saveAndConnectProvider = useOmniStore((s) => s.saveAndConnectProvider);

  const [presetType, setPresetType] = useState<ProviderType>("gemini");
  const [displayName, setDisplayName] = useState("Google Gemini");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("gemini-2.5-flash");
  const [baseUrl, setBaseUrl] = useState("");
  const [headersJson, setHeadersJson] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const applyPreset = (type: ProviderType) => {
    const preset = PROVIDER_PRESETS.find((p) => p.type === type) ?? PROVIDER_PRESETS[0];
    const existing = settings.providers.find((p) => p.providerType === type);
    setPresetType(type);
    setDisplayName(existing?.name ?? preset.defaultName);
    setModelId(existing?.modelId ?? preset.defaultModel);
    setBaseUrl(existing?.baseUrl ?? preset.defaultBaseUrl);
    setHeadersJson(
      existing?.customHeaders ? JSON.stringify(existing.customHeaders, null, 2) : ""
    );
    setShowAdvanced(preset.showBaseUrlByDefault);
    setApiKey("");
    setShowKey(false);
    setTestResult(null);
    setFormError(null);
  };

  useEffect(() => {
    if (open) {
      applyPreset(initialPreset ?? "gemini");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPreset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeProviderSetupModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeProviderSetupModal]);

  if (!open) return null;

  const presetMeta = PROVIDER_PRESETS.find((p) => p.type === presetType) ?? PROVIDER_PRESETS[0];
  const isLocal = isLocalLoopbackUrl(baseUrl);
  const keyOptional = presetType === "custom" && isLocal;

  const parseHeaders = (): { headers: Record<string, string> | null; error: string | null } => {
    if (!headersJson.trim()) return { headers: null, error: null };
    try {
      const parsed = JSON.parse(headersJson) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { headers: null, error: "Custom headers must be a JSON object." };
      }
      return { headers: parsed as Record<string, string>, error: null };
    } catch {
      return { headers: null, error: "Custom headers must be valid JSON." };
    }
  };

  const validateFields = (): { headers: Record<string, string> | null } | null => {
    if (!modelId.trim()) {
      setFormError("Model ID is required.");
      return null;
    }
    if (presetMeta.showBaseUrlByDefault && !baseUrl.trim()) {
      setFormError("API Base URL is required for this provider.");
      return null;
    }
    if (baseUrl.trim()) {
      const urlCheck = validateProviderBaseUrl(baseUrl);
      if (!urlCheck.valid) {
        setFormError(urlCheck.error ?? "Invalid endpoint URL.");
        return null;
      }
    }
    if (!apiKey.trim() && !keyOptional) {
      setFormError("API key is required (optional only for local loopback endpoints like Ollama).");
      return null;
    }
    const { headers, error } = parseHeaders();
    if (error) {
      setFormError(error);
      return null;
    }
    setFormError(null);
    return { headers };
  };

  const handleTestConnection = async () => {
    const validated = validateFields();
    if (!validated) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testProviderConnection(
        {
          providerType: presetType,
          modelId: modelId.trim(),
          baseUrl: baseUrl.trim() || null,
          customHeaders: validated.headers,
        },
        apiKey
      );
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    const validated = validateFields();
    if (!validated) return;
    setSaving(true);
    try {
      const existing = settings.providers.find((p) => p.providerType === presetType);
      const provider: ProviderConfig = {
        id: existing ? existing.id : `prov_${crypto.randomUUID().slice(0, 8)}`,
        name: displayName.trim() || presetMeta.defaultName,
        providerType: presetType,
        modelId: modelId.trim(),
        baseUrl: baseUrl.trim() || null,
        customHeaders: validated.headers,
        encryptedApiKey: existing?.encryptedApiKey ?? null,
        secretStatus: "configured",
        secretError: null,
      };
      await saveAndConnectProvider({
        provider,
        apiKey: apiKey.trim(),
        allowKeylessLocal: keyOptional,
        testResult: testResult ?? undefined,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeProviderSetupModal();
      }}
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect an AI Provider"
        className="w-full max-w-[520px] rounded-xl border border-[#E5E7EB] dark:border-[#262930] bg-[#FFFFFF] dark:bg-[#181A1E] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-[#111827] dark:text-[#F3F4F6]">
              Connect an AI Provider
            </h2>
            <p className="text-[11.5px] text-[#6B7280] dark:text-[#9CA3AF] mt-0.5">
              Choose a provider, enter your credentials, and verify connectivity before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={closeProviderSetupModal}
            aria-label="Close modal"
            className="text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSaveAndConnect(e)} className="p-5 space-y-4">
          {/* Provider Preset */}
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Provider Preset
            </label>
            <CustomSelect
              ariaLabel="Provider Preset"
              value={presetType}
              onChange={applyPreset}
              options={PROVIDER_PRESET_OPTIONS}
              className="w-full"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                API Key
              </label>
              {keyOptional && (
                <span className="text-[11px] text-[#6B7280] dark:text-[#9CA3AF]">
                  Optional for local loopback endpoints
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setFormError(null);
                  setTestResult(null);
                }}
                placeholder={presetMeta.keyPlaceholder}
                autoComplete="off"
                className="w-full h-9 pl-3 pr-9 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] placeholder:text-[#6B7280] dark:placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB]"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] dark:hover:text-[#F3F4F6] cursor-pointer"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model ID */}
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
              Model ID
            </label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                setFormError(null);
                setTestResult(null);
              }}
              placeholder={presetMeta.defaultModel}
              className="w-full h-9 px-3 rounded-md font-mono text-[12.5px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          {/* Base URL & Headers (Direct for Custom/Compatible; expandable under Advanced for standard providers) */}
          {!presetMeta.showBaseUrlByDefault && (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[12px] text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-[#F3F4F6] inline-flex items-center gap-1 cursor-pointer"
            >
              {showAdvanced ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <span>Advanced (Base URL &amp; Custom Headers)</span>
            </button>
          )}

          {(presetMeta.showBaseUrlByDefault || showAdvanced) && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                  API Base URL
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setFormError(null);
                    setTestResult(null);
                  }}
                  placeholder={
                    presetMeta.defaultBaseUrl || "https://api.example.com/v1 or http://127.0.0.1:11434/v1"
                  }
                  className="w-full h-9 px-3 rounded-md font-mono text-[12px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6]">
                  Optional Headers (JSON)
                </label>
                <input
                  type="text"
                  value={headersJson}
                  onChange={(e) => {
                    setHeadersJson(e.target.value);
                    setFormError(null);
                  }}
                  placeholder='{"HTTP-Referer": "https://omnicommand.dev"}'
                  className="w-full h-9 px-3 rounded-md font-mono text-[12px] bg-[#F6F7F9] dark:bg-[#111214] border border-[#E5E7EB] dark:border-[#262930] text-[#111827] dark:text-[#F3F4F6] focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          )}

          {/* Inline Connection Test Result or Form Validation Error */}
          {testResult && (
            <div className="flex items-center gap-2 text-[12px] tabular-nums">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  testResult.ok ? "bg-[#16A34A]" : "bg-[#DC2626]"
                }`}
              />
              <span
                className={
                  testResult.ok
                    ? "text-[#16A34A] dark:text-emerald-400 font-medium"
                    : "text-[#DC2626] dark:text-red-400"
                }
              >
                {testResult.message}
              </span>
            </div>
          )}

          {formError && (
            <div className="p-2.5 rounded-md border border-[#DC2626]/35 bg-[#DC2626]/10 text-[12px] text-[#DC2626] dark:text-red-300">
              {formError}
            </div>
          )}

          {/* Actions Footer */}
          <div className="pt-2 border-t border-[#E5E7EB] dark:border-[#262930] flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTestConnection()}
              className="h-8 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
            >
              {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{testing ? "Testing..." : "Test Connection"}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeProviderSetupModal}
                className="h-8 px-3 rounded-md border border-[#E5E7EB] dark:border-[#262930] text-[12px] font-medium text-[#111827] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-8 px-4 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-[12px] font-medium transition-colors whitespace-nowrap cursor-pointer"
              >
                {saving ? "Saving..." : "Save & Connect"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
