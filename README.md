# OmniCommand

An open-source, lightweight Windows 10/11 desktop command runner, project workspace, and headless execution tracker built with **Tauri v2 (Rust)**, **React 19 + TypeScript + Tailwind CSS**, and the **Vercel AI SDK**.

## Core Architecture

- **Desktop Backend (`src-tauri/`)**:
  - **Single-Instance & Zero-Flash Lifecycle**: `tauri-plugin-single-instance` runs first so relaunching OmniCommand from the Desktop, Taskbar, or Start Menu always restores the single existing window (`unminimize → show → set_focus`) with zero duplicate windows or processes. Launches hidden (`visible: false`) and reveals only after React finishes hydrating for zero white flash.
  - **Low-RAM System Tray & Instant Reopen**: Closing hides to the Windows System Tray and trims idle working-set RAM via `K32EmptyWorkingSet` / `SetProcessWorkingSetSize` while keeping WebView2 warm for instant (<20 ms) reopen. Includes an optional **Ultra-Low RAM (rebuilds UI on open)** toggle in Settings that flushes `session.json` and destroys WebView2 when hidden.
  - **Focus-Aware Global Quick Launcher**: `Shift+Space` customizable global shortcut automatically pauses while OmniCommand's main window is focused so typing in AI chat or console stdin never collides with the launcher.
  - **Atomic Local JSON Storage (`%LocalAppData%\OmniCommand\`)**: `projects.json`, `commands.json`, `settings.json`, `executions.json` (last 500), `session.json`, raw per-run logs under `logs/<exec_id>.log`, and rotating `.bak` copies under `backups/`.
  - **Headless Multi-Engine Runner**: Spawns `cmd.exe`, `pwsh.exe`/`powershell.exe`, `python.exe`, `wsl.exe`/`bash.exe`, and `git.exe` with `CREATE_NO_WINDOW` (`0x08000000`), forced UTF-8, `dunce` path canonicalization, Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) + `taskkill /F /T /PID` process-tree termination, and ~40 ms batched `stdout`/`stderr` IPC events.
  - **Security & Secrets**: Windows DPAPI (`CurrentUser` scope via `windows-rs`) with graceful machine-migration recovery, hard Rust destructive command blocklist, protected OS path blocking, sandboxed manifest inspection (`dunce::canonicalize` containment), and least-privilege Tauri v2 HTTP capabilities (`https://*`, `http://localhost:*`, `http://127.0.0.1:*`, explicitly denying `169.254.169.254`).
- **AI Layer (`src/ai/`)**:
  - Vercel AI SDK multi-provider factory (`@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/xai`, `@ai-sdk/openai-compatible`) routed via `@tauri-apps/plugin-http` with zero Node.js sidecar.
  - 22 typed Zod tools governed by `Ask` (default), `Selected`, and `Auto` permission modes, plus an asynchronous background Advisor Sub-Agent for follow-up command recommendations.

## Building for Windows

### Prerequisites

1. **Rust MSVC Toolchain (`cargo` & `rustc`)**: Install via `winget install --id Rustlang.Rustup -e` (or [rustup.rs](https://rustup.rs/)) with the `x86_64-pc-windows-msvc` target, plus **Visual Studio C++ Build Tools** (`winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`). Open a new terminal afterward so `%USERPROFILE%\.cargo\bin` is available.
2. **Node.js 20+ or Bun**: Required to install frontend dependencies and run the Vite production bundler (`npm` or `bun`).
3. **Microsoft Edge WebView2 Runtime**: Pre-installed on Windows 11 and modern Windows 10; the NSIS/MSI installers also include the lightweight WebView2 download bootstrapper automatically.
4. **Tauri CLI v2**: Included automatically in `devDependencies` (`@tauri-apps/cli`), so `npm run tauri:dev`, `npm run tauri:build`, and `npm run tauri:build:portable` work immediately after `npm install`.

### Commands

```bash
# 1. Install frontend dependencies
npm install

# 2. Verify TypeScript types & Rust compilation together
npm run check:all

# 3. Run the native Windows Tauri v2 desktop app in development mode
npm run tauri:dev

# 4. Build optimized Windows installers (.msi and per-user NSIS .exe)
#    Outputs to: src-tauri/target/release/bundle/{nsis,msi}/
npm run tauri:build

# 5. Build a standalone portable release executable (no installer bundle)
#    Outputs to: src-tauri/target/release/omnicommand.exe
npm run tauri:build:portable
```

### Cloud Build & GitHub Releases (No Local Rust Needed)

The workflow in `.github/workflows/release-windows.yml` builds the Windows NSIS `.exe` installer, `.msi` installer, and standalone portable `OmniCommand_0.1.0_x64-portable.exe` on GitHub's `windows-latest` runner and publishes them to **GitHub Releases**:

1. **Enable Release Permissions (one-time)**: On GitHub go to **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and save.
2. **Trigger `v0.1.0` Release**:
   - **Via Git tag**:
     ```bash
     git add .
     git commit -m "chore: release OmniCommand v0.1.0"
     git tag v0.1.0
     git push origin main --tags
     ```
   - **Or manually in GitHub UI**: Open **Actions → Build & Release Windows App → Run workflow** (defaults to `v0.1.0` from `package.json`).
3. **Install on Windows**: Download `OmniCommand_0.1.0_x64-setup.exe` from **Releases**, or run:
   ```bash
   npm run install:latest-exe
   ```

### Browser Preview (Development Only)

```bash
# Run interactive browser preview (dev-only Express proxy + Vite; never bundled in dist/)
npm run dev

# Build static production frontend bundle into dist/
npm run build
```
