/**
 * Cross-platform preload build script with verification
 */

import { spawn } from "bun";
import { existsSync, statSync, mkdirSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT_DIR, "apps/electron/dist");
const PRELOAD_BUILDS = [
  {
    label: "main preload",
    entryPoint: "apps/electron/src/preload/index.ts",
    outputFile: join(DIST_DIR, "preload.cjs"),
  },
  {
    label: "browser toolbar preload",
    entryPoint: "apps/electron/src/preload/browser-toolbar.ts",
    outputFile: join(DIST_DIR, "browser-toolbar-preload.cjs"),
  },
];

// Wait for file to stabilize (no size changes)
async function waitForFileStable(filePath: string, timeoutMs = 10000): Promise<boolean> {
  const startTime = Date.now();
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() - startTime < timeoutMs) {
    if (!existsSync(filePath)) {
      await Bun.sleep(100);
      continue;
    }

    const stats = statSync(filePath);
    if (stats.size === lastSize) {
      stableCount++;
      if (stableCount >= 3) {
        return true;
      }
    } else {
      stableCount = 0;
      lastSize = stats.size;
    }

    await Bun.sleep(100);
  }

  return false;
}

// Verify a JavaScript file is syntactically valid
async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { valid: false, error: "File does not exist" };
  }

  const stats = statSync(filePath);
  if (stats.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  const proc = spawn({
    cmd: ["node", "--check", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { valid: false, error: stderr || "Syntax error" };
  }

  return { valid: true };
}

async function main(): Promise<void> {
  // Ensure dist directory exists
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  console.log("🔨 Building preloads...");

  for (const build of PRELOAD_BUILDS) {
    const relativeOutput = build.outputFile.replace(`${ROOT_DIR}/`, "");
    console.log(`📦 Building ${build.label}...`);

    const proc = spawn({
      cmd: [
        "bun", "run", "esbuild",
        build.entryPoint,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        `--outfile=${relativeOutput}`,
        "--external:electron",
      ],
      cwd: ROOT_DIR,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`❌ ${build.label} build failed with exit code`, exitCode);
      process.exit(exitCode);
    }
  }

  console.log("⏳ Waiting for preload files to stabilize...");
  const stableResults = await Promise.all(
    PRELOAD_BUILDS.map(async (build) => ({
      label: build.label,
      stable: await waitForFileStable(build.outputFile),
    })),
  );

  const unstableBuild = stableResults.find((result) => !result.stable);
  if (unstableBuild) {
    console.error(`❌ ${unstableBuild.label} did not stabilize`);
    process.exit(1);
  }

  console.log("🔍 Verifying preload output...");
  const verificationResults = await Promise.all(
    PRELOAD_BUILDS.map(async (build) => ({
      label: build.label,
      verification: await verifyJsFile(build.outputFile),
    })),
  );

  const failedVerification = verificationResults.find((result) => !result.verification.valid);
  if (failedVerification) {
    console.error(`❌ ${failedVerification.label} verification failed:`, failedVerification.verification.error);
    process.exit(1);
  }

  console.log("✅ Preload builds complete and verified");
  process.exit(0);
}

main();
