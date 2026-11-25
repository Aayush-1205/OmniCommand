# OmniCommand Security Policy

## Defense-in-Depth Guardrails

1. **Non-Bypassable Rust Command Blocklist (`src-tauri/src/security/mod.rs`)**
   Blocks destructive or obfuscated patterns before process creation:
   - `format <drive>:`
   - `del /f /s /q` targeting drive roots or OS directories
   - `rm -rf /`
   - `Invoke-Expression` / `iex`
   - PowerShell `-EncodedCommand` / `-enc`
   - `reg delete HKLM\...`
   - `schtasks`
2. **OS Path Protection & Canonicalization**
   All project and execution paths are canonicalized with `dunce` (stripping `\\?\` UNC prefixes) and rejected if targeting `C:\Windows`, `C:\Program Files`, `C:\Program Files (x86)`, `System32`, or `SysWOW64`.
3. **Secrets at Rest (Windows DPAPI)**
   Provider API keys are encrypted using Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`, `CurrentUser` scope). Plaintext keys are never written to `settings.json`, `session.json`, or `logs/`. Moving `settings.json` between Windows machines degrades cleanly to an inline re-entry prompt.
4. **Prompt Injection & Agent Limits**
   Terminal output sent to `analyze_execution_error` is enclosed in `<untrusted_terminal_output>` delimiters, agent loops are capped at `maxSteps: 5`, and even in `Auto` permission mode, chained/piped or inline-script ad-hoc commands require explicit inline approval.
5. **Network Capability Scoping (`src-tauri/capabilities/default.json`)**
   Allows `https://*`, `http://localhost:*`, and `http://127.0.0.1:*` while explicitly denying link-local metadata endpoints (`169.254.169.254` / `169.254.*`).
