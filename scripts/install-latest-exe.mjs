#!/usr/bin/env node
/**
 * Dev-only helper: downloads the latest OmniCommand Windows installer (.exe)
 * from your GitHub Releases and launches it so you can install compiled builds
 * without installing Rust locally.
 *
 * Usage:
 *   npm run install:latest-exe
 *   npm run install:latest-exe -- --tag v0.1.0
 *   npm run install:latest-exe -- --portable
 */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const wantPortable = args.includes("--portable");
const tagIdx = args.indexOf("--tag");
const requestedTag = tagIdx >= 0 ? args[tagIdx + 1] : null;

function detectRepo() {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO.trim();
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
    if (match) return match[1];
  } catch {
    // ignore
  }
  return null;
}

function detectGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  try {
    return execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const repo = detectRepo();
  if (!repo) {
    console.error(
      "[OmniCommand] Could not detect GitHub repository from git origin.\n" +
        "Set GITHUB_REPO=owner/repo and re-run, e.g.:\n" +
        "  $env:GITHUB_REPO='your-user/omnicommand'; npm run install:latest-exe"
    );
    process.exit(1);
  }

  const token = detectGitHubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "OmniCommand-Dev-Installer",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const endpoint = requestedTag
    ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(requestedTag)}`
    : `https://api.github.com/repos/${repo}/releases/latest`;

  console.log(`[OmniCommand] Fetching release from ${repo} (${requestedTag ?? "latest"})...`);
  const res = await fetch(endpoint, { headers });
  if (!res.ok) {
    console.error(
      `[OmniCommand] GitHub API returned HTTP ${res.status}. ` +
        (res.status === 404
          ? "No published release found yet—run the 'Build & Release Windows App' workflow in GitHub Actions first (or authenticate with 'gh auth login' for private repos)."
          : await res.text())
    );
    process.exit(1);
  }

  const release = await res.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = wantPortable
    ? assets.find((a) => /portable\.exe$/i.test(a.name))
    : assets.find((a) => /setup\.exe$/i.test(a.name)) ??
      assets.find((a) => /\.exe$/i.test(a.name));

  if (!asset) {
    console.error(
      `[OmniCommand] Release ${release.tag_name} does not contain a matching Windows .exe asset.`
    );
    process.exit(1);
  }

  const outDir = path.join(os.tmpdir(), "omnicommand-releases", release.tag_name);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, asset.name);

  console.log(`[OmniCommand] Downloading ${asset.name}...`);
  const dlRes = await fetch(asset.url, {
    headers: {
      ...headers,
      Accept: "application/octet-stream",
    },
    redirect: "follow",
  });
  if (!dlRes.ok) {
    console.error(`[OmniCommand] Download failed with HTTP ${dlRes.status}.`);
    process.exit(1);
  }

  const buffer = Buffer.from(await dlRes.arrayBuffer());
  fs.writeFileSync(outFile, buffer);
  console.log(`[OmniCommand] Saved to ${outFile}`);

  if (process.platform === "win32") {
    console.log(`[OmniCommand] Launching ${asset.name}...`);
    const child = spawn(outFile, [], { detached: true, stdio: "ignore" });
    child.unref();
  } else {
    console.log("[OmniCommand] Non-Windows OS detected—file downloaded without auto-launching.");
  }
}

main().catch((err) => {
  console.error("[OmniCommand] Installer script failed:", err.message);
  process.exit(1);
});
