import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ProviderConfig } from "../types/omnicommand";
import { isTauriRuntime } from "../lib/bridge";
import { validateProviderBaseUrl } from "../lib/guardrails";

const DEFAULT_COMPATIBLE_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  perplexity: "https://api.perplexity.ai",
  zai: "https://api.z.ai/api/paas/v4",
};

/**
 * Resolves the Tauri v2 `@tauri-apps/plugin-http` fetch implementation when
 * running on Windows desktop so multi-provider calls bypass browser CORS
 * without bundling a Node.js sidecar.
 */
async function resolveProviderFetch(): Promise<typeof fetch> {
  if (isTauriRuntime()) {
    const mod = await import("@tauri-apps/plugin-http");
    return mod.fetch as unknown as typeof fetch;
  }
  return globalThis.fetch.bind(globalThis);
}

/**
 * Unified Vercel AI SDK multi-provider factory supporting Gemini, Claude,
 * OpenAI, Grok, OpenRouter, Perplexity, Z.ai, and Custom OpenAI-compatible
 * endpoints (including local Ollama / LM Studio on 127.0.0.1 / localhost).
 */
export async function createOmniLanguageModel(
  provider: ProviderConfig,
  apiKey: string
): Promise<LanguageModel> {
  const customFetch = await resolveProviderFetch();

  if (provider.baseUrl) {
    const check = validateProviderBaseUrl(provider.baseUrl);
    if (!check.valid) {
      throw new Error(check.error ?? "Provider baseURL blocked by security policy.");
    }
  }

  const optionalBaseUrl = provider.baseUrl?.trim() || undefined;
  const optionalHeaders = provider.customHeaders ?? undefined;

  switch (provider.providerType) {
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey,
        ...(optionalBaseUrl ? { baseURL: optionalBaseUrl } : {}),
        ...(optionalHeaders ? { headers: optionalHeaders } : {}),
        fetch: customFetch,
      });
      return google(provider.modelId);
    }

    case "claude": {
      const anthropic = createAnthropic({
        apiKey,
        ...(optionalBaseUrl ? { baseURL: optionalBaseUrl } : {}),
        ...(optionalHeaders ? { headers: optionalHeaders } : {}),
        fetch: customFetch,
      });
      return anthropic(provider.modelId);
    }

    case "openai": {
      const openai = createOpenAI({
        apiKey,
        ...(optionalBaseUrl ? { baseURL: optionalBaseUrl } : {}),
        ...(optionalHeaders ? { headers: optionalHeaders } : {}),
        fetch: customFetch,
      });
      return openai(provider.modelId);
    }

    case "grok": {
      const xai = createXai({
        apiKey,
        ...(optionalBaseUrl ? { baseURL: optionalBaseUrl } : {}),
        ...(optionalHeaders ? { headers: optionalHeaders } : {}),
        fetch: customFetch,
      });
      return xai(provider.modelId);
    }

    case "openrouter":
    case "perplexity":
    case "zai":
    case "custom": {
      const baseURL =
        provider.baseUrl?.trim() || DEFAULT_COMPATIBLE_URLS[provider.providerType] || "";
      if (!baseURL) {
        throw new Error(`Provider "${provider.name}" requires a valid baseURL.`);
      }
      const check = validateProviderBaseUrl(baseURL);
      if (!check.valid) {
        throw new Error(check.error ?? "Blocked provider baseURL.");
      }

      const compat = createOpenAICompatible({
        name: provider.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
        baseURL,
        apiKey: apiKey || "not-required-for-local",
        headers: provider.customHeaders ?? undefined,
        fetch: customFetch,
      });
      return compat(provider.modelId);
    }
  }
}
