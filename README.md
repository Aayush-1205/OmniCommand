# OmniCommand

An open-source, lightweight Windows 10/11 desktop command runner, project workspace, and headless execution tracker built with **Tauri v2 (Rust)**, **React 19 + TypeScript + Tailwind CSS**, and the **Vercel AI SDK**.

## Core Architecture

- **Desktop Backend (`src-tauri/`)**:
  - **Atomic Local JSON Storage (`%LocalAppData%\OmniCommand\`)**: `projects.json`, `commands.json`, `settings.json`, `executions.json` (last 500), `session.json` (flushed before tray WebView2 unload), raw per-run logs under `logs/<exec_id>.log`, and rotating `.bak` copies under `backups/`.
  - **Headless Multi-Engine Runner**: Spawns `cmd.exe`, `pwsh.exe`/`powershell.exe`, `python.exe`, `wsl.exe`/`bash.exe`, and `git.exe` with `CREATE_NO_WINDOW` (`0x08000000`), forced UTF-8, `dunce` path canonicalization, Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) + `taskkill /F /T /PID` process-tree termination, and ~40 ms batched `stdout`/`stderr` IPC events.
  - **Security & Secrets**: Windows DPAPI (`CurrentUser` scope via `windows-rs`) with graceful machine-migration recovery, hard Rust destructive command blocklist, protected OS path blocking, and least-privilege Tauri v2 HTTP capabilities (`https://*`, `http://localhost:*`, `http://127.0.0.1:*`, explicitly denying `169.254.169.254`).
  - **Tray & Quick Launcher**: `Shift+Space` customizable global shortcut with Window-Focus Guard so typing inside OmniCommand never collides with the launcher.
- **AI Layer (`src/ai/`)**:
  - Vercel AI SDK multi-provider factory (`@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/xai`, `@ai-sdk/openai-compatible`) routed via `@tauri-apps/plugin-http` with zero Node.js sidecar.
  - 15 typed Zod tools governed by `Ask` (default), `Selected`, and `Auto` permission modes, with `Auto` mode escalating chained/piped or inline script ad-hoc commands (`&&`, `|`, `python -c`, `pwsh -c`, etc.) to inline Approval Cards.

## Development & Windows Desktop Build

```bash
# Install JS dependencies
npm install

# Run interactive browser preview (dev-only Express proxy + Vite)
npm run dev

# Build static frontend bundle (zero Express dependency)
npm run build

# Run native Windows Tauri v2 desktop app (requires Rust toolchain + WebView2)
npm run tauri:dev

# Package Windows per-user NSIS / MSI installer
npm run tauri:build
```
