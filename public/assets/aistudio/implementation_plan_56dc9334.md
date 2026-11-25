# Implementation Plan — OmniCommand

An open-source, offline-first Windows desktop command runner, execution tracker, and terminal workspace built with **Tauri v2**, **React + TypeScript**, **Vercel AI SDK**, and a **Rust** system backend.

---

## 1. Tech Stack & Rationale

| Layer | Choice | Why |
| :--- | :--- | :--- |
| **Desktop Shell & OS Layer** | **Tauri v2 (Rust)** | Uses Windows' built-in Edge WebView2 instead of bundling Chromium (~4–10 MB installer). Rust handles headless process spawning, system tray, global shortcuts, and atomic JSON file I/O. |
| **Frontend UI** | **React 19 + TypeScript + Tailwind CSS** | Fast iteration, clean keyboard-first components, virtualized log/command lists, and smooth transitions without Electron's 200+ MB memory overhead. |
| **AI Orchestration** | **Vercel AI SDK (`ai` + `@ai-sdk/*`)** | Native TypeScript multi-provider switching (`@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/xai`, `@ai-sdk/openai-compatible` for OpenRouter, Perplexity, Z.ai, and Custom endpoints). Routed through `@tauri-apps/plugin-http` `fetch` to bypass browser CORS with zero Node.js sidecar. |
| **Local Persistence** | **Atomic JSON Files + Per-Run `.log` Files** | Human-readable, portable, zero-SQL-overhead storage in `%LocalAppData%\OmniCommand\` with a Rust write-mutex, temp-file-and-rename atomicity, and rotating `.bak` backups. |
| **Secrets Storage** | **Windows DPAPI (`windows-rs`)** | Encrypts AI provider API keys under `CurrentUser` scope before storing references; keys never appear in plaintext `settings.json`, logs, or exports. |
| **Distribution & Trust** | **MSIX / Per-User NSIS + Azure Artifact Signing** | Installs to `%LocalAppData%\Programs\OmniCommand\` with `asInvoker` manifest (zero UAC prompts). Signed via Azure Artifact Signing (~$9.99/mo) for SmartScreen reputation. |

---

## 2. Repository & Module Structure (Open-Source Ready)

```text
omnicommand/
├── .github/workflows/       # CI: cargo test, clippy, tsc, Vite build, release signing
├── src/                     # React + TypeScript Frontend
│   ├── components/
│   │   ├── layout/          # 3-zone Studio shell (Sidebar, Main, AI Drawer)
│   │   ├── launcher/        # Shift+Space Quick Launcher overlay
│   │   ├── commands/        # Command list, creation modal, risk/policy badges
│   │   ├── console/         # Embedded ANSI terminal output + stdin bar
│   │   ├── ai/              # Provider switcher, chat, inline tool approval cards
│   │   └── settings/        # Shortcut recorder, AI providers, engine paths, backup
│   ├── ai/
│   │   ├── providerFactory.ts  # Vercel AI SDK registry + Tauri HTTP fetch injection
│   │   ├── tools.ts            # 15 typed Zod tool definitions + Policy Gate hook
│   │   └── errorAnalyzer.ts    # Untrusted-output-wrapped error explanation flow
│   ├── stores/              # Lightweight state (Zustand) synced with Tauri IPC
│   └── types/               # Shared TS interfaces matching Rust serde structs
├── src-tauri/               # Rust Backend
│   ├── src/
│   │   ├── main.rs          # App entry, single-instance lock, tray & hotkey setup
│   │   ├── storage/         # Atomic JSON DB (projects, commands, settings, executions)
│   │   ├── runner/          # Multi-engine spawner (CREATE_NO_WINDOW), ANSI/UTF-8, kill tree
│   │   ├── security/        # Guardrail blocklist, path canonicalizer (dunce), DPAPI wrapper
│   │   └── ipc/             # Tauri commands exposed to frontend
│   └── capabilities/        # Tauri v2 least-privilege permission capabilities
├── CONTRIBUTING.md
├── LICENSE                  # MIT or Apache-2.0
├── SECURITY.md              # Vulnerability reporting & guardrail disclosure policy
└── README.md
```

---

## 3. Local JSON Database & File Layout

All persistent files live in `%LocalAppData%\OmniCommand\`:

- **`projects.json`** — Array of `{ id, name, basePath, defaultEngine, createdAt, updatedAt }`.
- **`commands.json`** — Array of `{ id, projectId (null = Global Root), name, alias, command, engine, riskLevel ("low" | "medium" | "high"), runPolicy ("inherit" | "auto" | "ask"), aiAllowed (bool), description, createdAt, updatedAt }`.
- **`settings.json`** — `{ launcherShortcut ("Shift+Space"), closeToTray (true), unloadWebviewOnClose (false), agentPermissionMode ("ask" | "selected" | "auto"), activeProviderId, providers: [...], commandTimeoutSec (120) }`.
- **`executions.json`** — Capped rolling index (last 500 runs) of `{ id, commandId, projectId, engine, commandText, basePath, exitCode, durationMs, triggeredBy ("user" | "ai"), logFilePath, startedAt }`.
- **`logs/<exec_id>.log`** — Raw UTF-8 terminal output streamed to disk so JSON files stay small and `JSON.parse` remains sub-millisecond.
- **`backups/`** — Automatic pre-write rotating `.bak` copies of `projects.json` and `commands.json`.

**Write Safety Rules:**
Every write goes through a single Rust `tokio::sync::Mutex` -> serialize to `<file>.tmp` -> `sync_all()` -> atomic rename -> rotate previous `.bak`.

---

## 4. Multi-Engine Headless Execution Layer

Every process spawns in Rust via `std::process::Command` with Windows creation flag `CREATE_NO_WINDOW` (`0x08000000`), `stdin`/`stdout`/`stderr` piped, and `current_dir` canonicalized via the `dunce` crate (stripping `\\?\` UNC prefixes that break `cmd.exe`):

| Engine | Invocation | Encoding & Stability Flags |
| :--- | :--- | :--- |
| **CMD** | `cmd.exe /d /s /c "chcp 65001>nul & <cmd>"` | Forces UTF-8 (`65001`) to prevent OEM codepage mojibake |
| **PowerShell** | `pwsh.exe` (fallback `powershell.exe`) `-NoProfile -NonInteractive -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; <cmd>"` | Skips slow profile scripts; forces UTF-8 output |
| **Python** | `python.exe -u -c "<cmd>"` (or script file) | `-u` unbuffered + `PYTHONIOENCODING=utf-8` |
| **Linux (WSL / Git Bash)** | `wsl.exe --cd "<win_path>" -- bash -lc "<cmd>"` or `bash.exe -lc "<cmd>"` | Probes `wsl.exe --status` / `bash.exe` on startup |
| **Git** | `git.exe <args>` (or shell-routed when piped) | Runs directly in `basePath` with non-interactive env (`GIT_TERMINAL_PROMPT=0`) |

---

## 5. AI Agent Tools & Security Architecture

### 5.1 Provider Registry (Vercel AI SDK)
A single `createModel(providerConfig)` factory switches seamlessly across:
- **Google Gemini** (`@ai-sdk/google`)
- **Anthropic Claude** (`@ai-sdk/anthropic`)
- **OpenAI** (`@ai-sdk/openai`)
- **xAI Grok** (`@ai-sdk/xai`)
- **OpenRouter, Perplexity, Z.ai, & Custom Endpoints** (`@ai-sdk/openai-compatible` with user-defined `baseURL`, `modelId`, optional headers, and DPAPI-decrypted `apiKey`).

### 5.2 Complete Agent Toolset (15 Tools)

| Category | Tool Name | Policy Default | Purpose |
| :--- | :--- | :--- | :--- |
| **Projects** | `list_projects` | Auto | List all projects and their `basePath`s |
| **Projects** | `create_project` | Ask | Validate directory exists and create project |
| **Projects** | `update_project` | Ask | Rename project, change engine, or update `basePath` |
| **Projects** | `delete_project` | Always Ask | Remove project (and confirm command handling) |
| **Projects** | `validate_local_path` | Auto | Check directory existence and safety outside OS dirs |
| **Commands** | `list_commands` | Auto | Filter commands by project, Global Root, or engine |
| **Commands** | `create_command` | Ask | Save command with engine, risk level, run policy, placement |
| **Commands** | `update_command` | Ask | Edit command script, risk level, or placement |
| **Commands** | `delete_command` | Always Ask | Delete a stored command |
| **Execution** | `run_stored_command` | Mode-Gated | Execute saved command (prompts `basePath` if Global) |
| **Execution** | `run_adhoc_command` | Mode-Gated + Blocklist | Run custom command on chosen engine & `basePath` |
| **Execution** | `stop_execution` | Auto | Kill running process tree by `executionId` |
| **Diagnostics** | `get_execution_logs` | Auto | Read exit code and tail of `.log` file |
| **Diagnostics** | `analyze_execution_error` | Auto | Explain non-zero exit root cause & suggest fix |
| **System** | `list_available_engines` | Auto | Report installed engines (`cmd`, `pwsh`, `python`, `wsl`, `git`) |

### 5.3 Permission Modes & Hard Guardrails
- **Agent Modes (Default: `Ask`):**
  1. **`Ask`:** Every mutating CRUD action or command run renders an inline confirmation card (showing exact command, engine, `basePath`, and `riskLevel`) before execution.
  2. **`Selected Commands`:** Auto-runs only stored commands with `aiAllowed: true`; everything else falls back to `Ask`.
  3. **`Auto`:** Auto-runs `low`-risk commands; `medium` and `high` commands still require confirmation.
- **Non-Bypassable Guardrails (Rust-side, cannot be overridden by LLM):**
  - **Blocklist:** Blocks or forces explicit manual override on destructive patterns (`format`, `del /f /s /q` on root/OS paths, `rm -rf /`, `iex`, `-EncodedCommand`, `reg delete HKLM`, `schtasks`).
  - **OS Path Protection:** Blocks `create_project` or execution targeting `C:\Windows`, `C:\Program Files`, or `System32`.
  - **Prompt Injection Defense:** Wraps `stdout`/`stderr` passed to `analyze_execution_error` in strict untrusted-data tags and caps agent tool loops (`maxSteps: 5`).

---

## 6. Minimalist UI/UX Design Specification

**Visual Direction:** Calm, utilitarian, desktop-native restraint—inspired by Linear, Raycast, and Windows 11 Settings. **Zero** neon gradients, **zero** glowing borders, **zero** decorative AI sparkles or robot avatars.

- **Palette:**
  - Light: `#FFFFFF` canvas, `#F6F7F9` sidebar/cards, `#E5E7EB` 1px borders, `#111827` primary text, `#6B7280` secondary text.
  - Dark: `#111214` canvas, `#181A1E` sidebar/cards, `#262930` 1px borders, `#F3F4F6` primary text, `#9CA3AF` secondary text.
  - Single functional accent: `#2563EB` (primary actions/focus ring). Semantic status dots only (`#16A34A` success, `#D97706` medium risk, `#DC2626` high risk/error).
- **Typography:** `Segoe UI Variable` / `Inter` for UI; `Cascadia Code` / `JetBrains Mono` for commands, paths, and console logs.
- **Surfaces:**
  1. **Quick Launcher (`Shift+Space`, customizable):** Centered 620px floating command palette. Fuzzy-searches projects + commands, lets you pick a folder if running a Global Root command, or type an ad-hoc command (`>`) and press `Enter`.
  2. **Main Studio Window (3-Zone):**
     - **Left Rail (220px):** `Global Root` pinned at top + Project list with clean path subtitles + `+ New Project`.
     - **Center Workspace:** Header (Project name, `basePath` pill, Engine selector, `+ New Command`), Command list (clean rows with `Engine` tag, `Risk` dot, `Run` button), Ad-hoc command bar, and resizable **Embedded Console** at bottom (live ANSI stream, `Kill`, `Clear`, and `Explain Error` button on non-zero exit).
     - **Right Drawer (Collapsible, 340px):** Clean AI chat with Provider/Model dropdown, Permission Mode pill (`Ask` / `Selected` / `Auto`), and crisp inline Approval Cards.

---

## 7. Implementation Roadmap (Milestones)

1. **Milestone 1 — Core Shell & JSON Storage:** Scaffold Tauri v2 + React/TS (`omnicommand`), implement Rust atomic JSON store (`projects`, `commands`, `settings`, `executions`), DPAPI key wrapper, and `dunce` path validation.
2. **Milestone 2 — Multi-Engine Headless Runner & Embedded Console:** Build `CREATE_NO_WINDOW` spawner for CMD, PowerShell, Python, WSL/Git Bash, and Git; stream UTF-8/ANSI output to the console with process-tree kill and `.log` file persistence.
3. **Milestone 3 — Minimalist Studio UI & Customizable Quick Launcher:** Build the 3-zone Studio UI, Global Root `basePath` prompt, and `Shift+Space` Quick Launcher with settings shortcut recorder and tray residency.
4. **Milestone 4 — Vercel AI SDK + Guardrails:** Wire `@tauri-apps/plugin-http` into Vercel AI SDK provider factory, implement all 15 tools + `Ask`/`Selected`/`Auto` Policy Gate + Rust guardrail blocklist + Error Analyzer.
5. **Milestone 5 — Hardening, Packaging & Open-Source Release:** Add unit/integration tests, handle edge cases (hotkey conflicts, hanging `stdin`, missing engines, WebView2 bootstrapper), write `README.md`/`SECURITY.md`, and configure GitHub Actions + Azure Artifact Signing.
