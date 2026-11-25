#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isWin = process.platform === "win32";
const mode = process.argv[2] ?? "build";
const extraArgs = process.argv.slice(3);

function buildEnrichedEnv() {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const sep = path.delimiter;
  const existing = (env[pathKey] ?? "").split(sep).filter(Boolean);

  const additions = [];
  const localBin = path.resolve("node_modules", ".bin");
  if (fs.existsSync(localBin)) {
    additions.push(localBin);
  }

  const cargoHome = env.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const cargoBin = path.join(cargoHome, "bin");
  if (fs.existsSync(cargoBin)) {
    additions.push(cargoBin);
  }

  const normalizedExisting = new Set(
    existing.map((p) => (isWin ? p.toLowerCase() : p))
  );
  const toPrepend = additions.filter(
    (p) => !normalizedExisting.has(isWin ? p.toLowerCase() : p)
  );

  env[pathKey] = [...toPrepend, ...existing].join(sep);
  return { env, cargoBin };
}

function run(command, args, env) {
  const res = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: isWin,
  });
  if (res.error) {
    console.error(`Failed to run "${command}": ${res.error.message}`);
    process.exit(1);
  }
  if ((res.status ?? 1) !== 0) {
    process.exit(res.status ?? 1);
  }
}

function ensureCargoAvailable(env, cargoBin) {
  const probe = spawnSync("cargo", ["--version"], {
    env,
    stdio: "ignore",
    shell: isWin,
  });
  if (probe.status === 0) {
    return;
  }

  console.error("\n[OmniCommand] Rust toolchain (cargo) was not found on PATH.");
  console.error(`Checked standard location: ${cargoBin}\n`);
  console.error("To compile the native Windows desktop app, install the Rust MSVC toolchain:");
  console.error("  1. Install Rustup (includes cargo & rustc):");
  console.error("     winget install --id Rustlang.Rustup -e");
  console.error("     (or download rustup-init.exe from https://rustup.rs/)");
  console.error("  2. Install Visual Studio C++ Build Tools if not already installed:");
  console.error(
    '     winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
  );
  console.error("  3. Open a new terminal window and re-run this command.\n");
  process.exit(1);
}

const { env, cargoBin } = buildEnrichedEnv();

if (mode === "check") {
  run("tsc", ["--noEmit"], env);
  ensureCargoAvailable(env, cargoBin);
  run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml", ...extraArgs], env);
} else if (mode === "dev") {
  ensureCargoAvailable(env, cargoBin);
  run("tauri", ["dev", ...extraArgs], env);
} else if (mode === "build") {
  ensureCargoAvailable(env, cargoBin);
  run("tauri", ["build", ...extraArgs], env);
} else if (mode === "build:portable") {
  ensureCargoAvailable(env, cargoBin);
  run("tauri", ["build", "--no-bundle", ...extraArgs], env);
} else {
  console.error(`Unknown mode "${mode}". Expected: check | dev | build | build:portable`);
  process.exit(1);
}
