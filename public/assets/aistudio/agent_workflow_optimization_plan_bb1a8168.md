# Implementation Plan — OmniCommand Agent Workflow Optimization & Dynamic Tools

Based on a direct review of `src/ai/agentRunner.ts`, `src/ai/tools.ts`, `src/ai/commandAdvisorSubagent.ts`, and `src/ai/policyGate.ts`, here is the plan to eliminate multi-round-trip latency and expand the Agent's dynamic capabilities.

---

## 1. Root Causes of Current Agent Slowness

1. **Blocking Sub-Agent Inside the Main Loop (`commandAdvisorSubagent.ts`):**
   Currently, `buildSystemInstruction()` instructs the primary agent to call `suggest_next_commands` as a synchronous tool after creating a project, adding commands, or analyzing an error. That adds a full blocking `generateText` LLM call *before* the primary agent can even start generating its final response (turning a 2-step task into 4 sequential LLM round-trips).
2. **Two-Step Project + Command Creation (`create_project` -> `create_commands_batch`):**
   Creating a project with starter commands currently requires Step 1 (`create_project`) -> LLM round-trip -> Step 2 (`create_commands_batch`), doubling both latency and user approval friction.
3. **Missing Pre-Injected Command & Engine Context (`agentRunner.ts`):**
   `buildSystemInstruction()` injects `projects`, but omits compact summaries of existing `commands` and `availableEngines`. As a result, the agent frequently burns an extra round-trip calling `list_commands` or `list_available_engines` before taking action.
4. **Non-Streaming Preview Loop (`server.ts` / `agentRunner.ts`):**
   In dev browser preview, `fetch("/api/preview-ai/chat")` waits for the entire LLM response before updating the UI, making turns feel slower than Tauri's `streamText` loop.

---

## 2. Workflow & Latency Optimizations

### A. Async Non-Blocking Advisor Sub-Agent
- Remove `suggest_next_commands` from the blocking critical path of `runAgentTurn` (or return immediately if triggered, running `runCommandAdvisorSubagent` asynchronously in the background).
- **New Flow:**
  1. Primary Agent completes its core task (`scaffold_project_with_commands`, `create_commands_batch`, `analyze_execution_error`) and streams its descriptive explanation immediately.
  2. In parallel/right as the primary turn finishes, `runAgentTurn` fires `runCommandAdvisorSubagent(...)` in the background when a project/command was created or an error was analyzed, streaming the resulting **Suggestion Cards** into the message footer as soon as they arrive.
  - **Result:** Cuts 1 full LLM round-trip (~1.5–4s) from every creation/diagnostic turn.

### B. Compact Workspace Context Pre-Injection
- In `buildSystemInstruction()` (`agentRunner.ts`), inject a compact, token-light snapshot of:
  - **Active Project's Commands** (just `id`, `name`, `alias`, `engine`, `riskLevel` — max 25 items) + Global Root command count.
  - **Cached Available Engines** (`cmd`, `powershell`, `python`, `linux`, `git`) probed once on startup.
  - **Last Failed Execution** (if any in the active project, just `id`, `commandText`, `exitCode`).
- **Result:** Eliminates 1–2 discovery tool calls (`list_commands`, `list_available_engines`) on most turns.

### C. Streaming SSE in Dev Preview (`server.ts`)
- Upgrade `/api/preview-ai/chat` from a blocking JSON response to **Server-Sent Events (SSE)** (streaming text deltas + tool-call events) so browser preview feels as snappy as Tauri's `streamText`.

---

## 3. New Dynamic Agent Tools (Expanding from 16 to 21 Tools)

Add these 5 high-leverage tools to `src/ai/toolSchemas.ts`, `src/ai/tools.ts`, and `src/ai/policyGate.ts`:

| Tool Name | Policy Mode | Purpose & Speed Benefit |
| :--- | :--- | :--- |
| **`scaffold_project_with_commands`** | `Ask` (single combined Approval Card) | Atomically creates a project **and** its initial batch of commands in **1 tool call** instead of 2 sequential LLM round-trips. |
| **`inspect_workspace_files`** | `Auto` (read-only, strictly sandboxed) | Lists top-level files in a project's `basePath` and safely reads recognized manifest files (`package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt`, `Makefile`, `docker-compose.yml`, capped at 8 KB) so the agent generates **exact, repo-accurate commands** instead of generic guesses. |
| **`run_command_sequence`** | Mode-Gated (single Batch Approval Card) | Runs an ordered pipeline of stored/ad-hoc commands (e.g., `git pull` -> `npm install` -> `npm run build`) with `stopOnError` (default `true`), streaming each step to the Embedded Console and returning a structured per-step summary. |
| **`search_execution_history`** | `Auto` (read-only) | Searches recent `executions` by `projectId`, `status` (`failed`, `completed`), `engine`, or keyword, returning compact metadata + `outputTail` without flooding context. |
| **`export_project_template`** | `Auto` (read-only) | Exports a project and its commands as a clean, shareable JSON template (stripping machine-specific secrets) for open-source sharing or backup. |

**Security Guardrails for `inspect_workspace_files`:**
- Must validate `basePath` via `runtimeBridge.validatePath`, reject `..` traversal, **block `.env`, `.pem`, `.key`, `id_rsa`, `credentials.*`, and `settings.json`**, and cap file reads at 8 KB.

---

## 4. Implementation Sequence

1. **Phase 1 — Context & Sub-Agent Decoupling:** Update `agentRunner.ts` to pre-inject compact command/engine context and run `runCommandAdvisorSubagent` asynchronously post-task rather than blocking the main tool loop.
2. **Phase 2 — New Tools & Policy Gate:** Add the 5 new Zod schemas in `toolSchemas.ts`, implement their executors in `tools.ts` (including Rust/preview `inspect_workspace_files` with `.env`/secret-file blocklist), and register them in `policyGate.ts`.
3. **Phase 3 — Combined Scaffold Approval Card & Sequence UI:** Update `AiDrawer.tsx` / approval card rendering to display `scaffold_project_with_commands` (project + commands in one card) and `run_command_sequence` step lists cleanly.
4. **Phase 4 — Preview SSE Streaming:** Stream text deltas from `/api/preview-ai/chat` in `server.ts`.
