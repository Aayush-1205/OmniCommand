import type { ProviderConfig, ProviderType } from "../types/omnicommand";
import { isTauriRuntime } from "../lib/bridge";
import { validateProviderBaseUrl } from "../lib/guardrails";

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
  statusCode?: number;
}

export interface ProviderPresetMeta {
  type: ProviderType;
  label: string;
  defaultName: string;
  defaultModel: string;
  defaultBaseUrl: string;
  showBaseUrlByDefault: boolean;
  keyPlaceholder: string;
}

export const PROVIDER_PRESETS: ProviderPresetMeta[] = [
  {
    type: "gemini",
    label: "Google Gemini",
    defaultName: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: "",
    showBaseUrlByDefault: false,
    keyPlaceholder: "AIza...",
  },
  {
    type: "claude",
    label: "Anthropic Claude",
    defaultName: "Anthropic Claude",
    defaultModel: "claude-sonnet-4-20250514",
    defaultBaseUrl: "",
    showBaseUrlByDefault: false,
    keyPlaceholder: "sk-ant-...",
  },
  {
    type: "openai",
    label: "OpenAI",
    defaultName: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    defaultBaseUrl: "",
    showBaseUrlByDefault: false,
    keyPlaceholder: "sk-...",
  },
  {
    type: "grok",
    label: "xAI Grok",
    defaultName: "xAI Grok",
    defaultModel: "grok-3-mini",
    defaultBaseUrl: "",
    showBaseUrlByDefault: false,
    keyPlaceholder: "xai-...",
  },
  {
    type: "openrouter",
    label: "OpenRouter",
    defaultName: "OpenRouter",
    defaultModel: "anthropic/claude-3.7-sonnet",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    showBaseUrlByDefault: true,
    keyPlaceholder: "sk-or-...",
  },
  {
    type: "perplexity",
    label: "Perplexity",
    defaultName: "Perplexity",
    defaultModel: "sonar-pro",
    defaultBaseUrl: "https://api.perplexity.ai",
    showBaseUrlByDefault: true,
    keyPlaceholder: "pplx-...",
  },
  {
    type: "zai",
    label: "Z.ai",
    defaultName: "Z.ai",
    defaultModel: "glm-4.5",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    showBaseUrlByDefault: true,
    keyPlaceholder: "API key",
  },
  {
    type: "custom",
    label: "Direct / Custom API",
    defaultName: "Custom OpenAI-Compatible",
    defaultModel: "qwen2.5-coder:14b",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    showBaseUrlByDefault: true,
    keyPlaceholder: "Optional for local endpoints (e.g. Ollama)",
  },
];

export function isLocalLoopbackUrl(url?: string | null): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
  } catch {
    return false;
  }
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  grok: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  perplexity: "https://api.perplexity.ai",
  zai: "https://api.z.ai/api/paas/v4",
};

function classifyStatus(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("api_key_invalid") || lower.includes("invalid api key")) {
    return `Invalid API key (${status})`;
  }
  if (status === 404 || lower.includes("not found") || lower.includes("does not exist")) {
    return `Model not found (${status})`;
  }
  if (status === 429) return "Rate limited (429)";
  if (status >= 500) return `Provider error (${status})`;
  return `Request rejected (${status})`;
}

/**
 * Performs a real lightweight validation probe against the configured provider.
 * Uses `@tauri-apps/plugin-http` directly on desktop and the dev-only preview
 * proxy in the browser so multi-provider verification works without CORS errors.
 */
export async function testProviderConnection(
  provider: Pick<ProviderConfig, "providerType" | "modelId" | "baseUrl" | "customHeaders">,
  apiKey: string
): Promise<ConnectionTestResult> {
  if (provider.baseUrl?.trim()) {
    const check = validateProviderBaseUrl(provider.baseUrl);
    if (!check.valid) {
      return {
        ok: false,
        latencyMs: 0,
        message: check.error ?? "Invalid endpoint URL",
      };
    }
  }

  const trimmedKey = apiKey.trim();
  const isLocal = isLocalLoopbackUrl(provider.baseUrl);
  if (!trimmedKey && !(provider.providerType === "custom" && isLocal)) {
    return {
      ok: false,
      latencyMs: 0,
      message: "API key required",
      statusCode: 401,
    };
  }

  if (!isTauriRuntime()) {
    try {
      const res = await fetch("/api/preview-ai/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerType: provider.providerType,
          modelId: provider.modelId,
          baseUrl: provider.baseUrl ?? null,
          customHeaders: provider.customHeaders ?? null,
          apiKey: trimmedKey,
        }),
      });
      const data = (await res.json()) as ConnectionTestResult;
      return data;
    } catch {
      return { ok: false, latencyMs: 0, message: "Endpoint unreachable" };
    }
  }

  // Native Tauri v2 desktop probe via @tauri-apps/plugin-http
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const started = performance.now();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 10000);

  try {
    const customHeaders = provider.customHeaders ?? {};
    const modelId = provider.modelId.trim();

    if (provider.providerType === "gemini") {
      const base = (provider.baseUrl?.trim() || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
      const normalizedModel = modelId.startsWith("models/") ? modelId : `models/${modelId}`;
      const res = await tauriFetch(`${base}/v1beta/${normalizedModel}`, {
        method: "GET",
        headers: { "x-goog-api-key": trimmedKey, ...customHeaders },
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (res.ok) return { ok: true, latencyMs, message: `Connected (${latencyMs} ms)`, statusCode: res.status };
      return { ok: false, latencyMs, message: classifyStatus(res.status, await res.text()), statusCode: res.status };
    }

    if (provider.providerType === "claude") {
      const base = (provider.baseUrl?.trim() || "https://api.anthropic.com/v1").replace(/\/+$/, "");
      const res = await tauriFetch(`${base}/models/${encodeURIComponent(modelId)}`, {
        method: "GET",
        headers: { "x-api-key": trimmedKey, "anthropic-version": "2023-06-01", ...customHeaders },
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (res.ok) return { ok: true, latencyMs, message: `Connected (${latencyMs} ms)`, statusCode: res.status };
      return { ok: false, latencyMs, message: classifyStatus(res.status, await res.text()), statusCode: res.status };
    }

    const base = (provider.baseUrl?.trim() || DEFAULT_BASE_URLS[provider.providerType] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, latencyMs: 0, message: "Base URL required" };

    const headers: Record<string, string> = { "Content-Type": "application/json", ...customHeaders };
    if (trimmedKey) headers.Authorization = `Bearer ${trimmedKey}`;

    const res =
      provider.providerType === "perplexity"
        ? await tauriFetch(`${base}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: modelId,
              max_tokens: 1,
              messages: [{ role: "user", content: "ping" }],
            }),
            signal: controller.signal,
          })
        : await tauriFetch(`${base}/models`, {
            method: "GET",
            headers,
            signal: controller.signal,
          });

    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) return { ok: true, latencyMs, message: `Connected (${latencyMs} ms)`, statusCode: res.status };
    return { ok: false, latencyMs, message: classifyStatus(res.status, await res.text()), statusCode: res.status };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, latencyMs, message: "Timeout" };
    }
    return { ok: false, latencyMs, message: "Endpoint unreachable" };
  } finally {
    window.clearTimeout(timer);
  }
}
