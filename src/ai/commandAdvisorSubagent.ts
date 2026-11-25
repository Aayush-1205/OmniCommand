import { generateText } from "ai";
import { z } from "zod";
import type {
  EngineType,
  ProviderConfig,
  SuggestedCommandItem,
} from "../types/omnicommand";
import { isTauriRuntime, runtimeBridge } from "../lib/bridge";
import { checkCommandGuardrails } from "../lib/guardrails";
import { createOmniLanguageModel } from "./providerFactory";
import { isLocalLoopbackUrl } from "./connectionTester";

export const COMMAND_ADVISOR_SYSTEM_PROMPT = `You are the OmniCommand Advisor Sub-Agent. Given a project's name, basePath, shell engine, existing commands, and the user's recent goal, recommend 2 to 4 practical, non-duplicate follow-up commands or workflow improvements tailored to that stack and OS environment. For each suggestion, provide: a short name, alias, exact command (using {var} placeholders where helpful), engine, riskLevel ("low" | "medium" | "high"), and a 1-sentence explanation of why it helps. Return structured JSON.`;

const RawSuggestionSchema = z.object({
  name: z.string().min(1),
  alias: z.string().optional(),
  command: z.string().min(1),
  engine: z.enum(["cmd", "powershell", "python", "linux", "git"]).optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  explanation: z.string().optional(),
  reason: z.string().optional(),
  description: z.string().optional(),
});

const AdvisorPayloadSchema = z.union([
  z.object({ suggestions: z.array(RawSuggestionSchema) }),
  z.array(RawSuggestionSchema),
]);

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = trimmed.lastIndexOf("]");
    if (arrEnd > arrStart) return trimmed.slice(arrStart, arrEnd + 1);
  }
  if (objStart !== -1) {
    const objEnd = trimmed.lastIndexOf("}");
    if (objEnd > objStart) return trimmed.slice(objStart, objEnd + 1);
  }
  return trimmed;
}

function normalizeSuggestions(
  rawText: string,
  params: {
    defaultEngine: EngineType;
    projectId: string | null;
    projectName: string;
    existingCommands: string[];
  }
): SuggestedCommandItem[] {
  const existingSet = new Set(
    params.existingCommands.map((c) => c.trim().toLowerCase()).filter(Boolean)
  );

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(extractJsonBlock(rawText));
  } catch {
    return [];
  }

  const validated = AdvisorPayloadSchema.safeParse(parsedUnknown);
  if (!validated.success) {
    return [];
  }

  const rawList = Array.isArray(validated.data)
    ? validated.data
    : validated.data.suggestions;

  const seenNames = new Set<string>();
  const results: SuggestedCommandItem[] = [];

  for (const item of rawList) {
    const name = item.name.trim();
    const command = item.command.trim();
    if (!name || !command) continue;

    // Filter duplicates against existing commands & current batch
    const lowerName = name.toLowerCase();
    const lowerCmd = command.toLowerCase();
    if (existingSet.has(lowerName) || existingSet.has(lowerCmd) || seenNames.has(lowerName)) {
      continue;
    }

    // Never suggest commands blocked by non-bypassable security guardrails
    const guardrail = checkCommandGuardrails(command);
    if (guardrail.blocked) {
      continue;
    }

    seenNames.add(lowerName);
    const alias =
      item.alias?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") ||
      "cmd";

    results.push({
      id: `sug_${crypto.randomUUID().slice(0, 8)}`,
      name,
      alias,
      command,
      engine: item.engine ?? params.defaultEngine,
      riskLevel: item.riskLevel ?? "low",
      explanation:
        (item.explanation || item.reason || item.description || "Helpful follow-up workflow command.").trim(),
      projectId: params.projectId,
      projectName: params.projectName,
    });

    if (results.length >= 4) break;
  }

  return results;
}

/**
 * Dedicated internal Advisor Sub-Agent (`command_advisor_subagent`).
 * Uses `generateText` with the active provider and ZERO mutating tools to generate
 * 2-4 practical, non-duplicate follow-up command recommendations as structured JSON.
 */
export async function runCommandAdvisorSubagent(params: {
  projectId: string | null;
  projectName: string;
  basePath: string;
  engine: EngineType;
  existingCommands: string[];
  userGoal: string;
  provider: ProviderConfig;
}): Promise<SuggestedCommandItem[]> {
  const { projectId, projectName, basePath, engine, existingCommands, userGoal, provider } =
    params;

  if (provider.secretStatus === "decrypt_failed") {
    return [];
  }

  const apiKey = await runtimeBridge.getProviderDecryptedKey(provider.id);
  const allowKeyless = provider.providerType === "custom" && isLocalLoopbackUrl(provider.baseUrl);
  if (!apiKey && !allowKeyless) {
    return [];
  }

  const userPrompt = [
    `Project Name: ${projectName}`,
    `Base Path: ${basePath || "(Global Root — prompts for directory at runtime)"}`,
    `Default Engine: ${engine}`,
    `User Recent Goal: ${userGoal}`,
    `Existing Commands (DO NOT duplicate these):`,
    existingCommands.length > 0
      ? existingCommands.map((c) => `- ${c}`).join("\n")
      : "- (none)",
    "",
    `Return ONLY valid JSON matching this exact shape (no prose outside JSON):`,
    `{`,
    `  "suggestions": [`,
    `    {`,
    `      "name": "Short Command Name",`,
    `      "alias": "short-alias",`,
    `      "command": "exact shell command using {var} placeholders where helpful",`,
    `      "engine": "${engine}",`,
    `      "riskLevel": "low",`,
    `      "explanation": "One concise sentence explaining why this command helps."`,
    `    }`,
    `  ]`,
    `}`,
  ].join("\n");

  if (isTauriRuntime()) {
    const model = await createOmniLanguageModel(provider, apiKey ?? "");
    const { text } = await generateText({
      model,
      system: COMMAND_ADVISOR_SYSTEM_PROMPT,
      prompt: userPrompt,
    });
    return normalizeSuggestions(text ?? "", {
      defaultEngine: engine,
      projectId,
      projectName,
      existingCommands,
    });
  }

  const response = await fetch("/api/preview-ai/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemPrompt: COMMAND_ADVISOR_SYSTEM_PROMPT,
      prompt: userPrompt,
      provider: {
        providerType: provider.providerType,
        modelId: provider.modelId,
        baseUrl: provider.baseUrl ?? null,
        customHeaders: provider.customHeaders ?? null,
        apiKey: apiKey ?? "",
      },
    }),
  });

  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { rawText?: string; error?: string };
  if (data.error || !data.rawText) {
    return [];
  }

  return normalizeSuggestions(data.rawText, {
    defaultEngine: engine,
    projectId,
    projectName,
    existingCommands,
  });
}
