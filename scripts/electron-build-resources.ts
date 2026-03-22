/**
 * Cross-platform resources copy script
 */

import { existsSync, cpSync, rmSync } from "fs";
import { join, relative, resolve, sep } from "path";

const ROOT_DIR = join(import.meta.dir, "..");
const ELECTRON_DIR = join(ROOT_DIR, "apps/electron");

const srcDir = resolve(ELECTRON_DIR, "resources");
const destDir = join(ELECTRON_DIR, "dist/resources");

function shouldCopyElectronResource(src: string): boolean {
  const relativePath = relative(srcDir, resolve(src));
  if (!relativePath || relativePath === "") {
    return true;
  }

  const normalizedPath = relativePath.split(sep).join("/");
  return normalizedPath !== "tools" && !normalizedPath.startsWith("tools/");
}

if (existsSync(srcDir)) {
  rmSync(destDir, { recursive: true, force: true });
  cpSync(srcDir, destDir, { recursive: true, force: true, filter: shouldCopyElectronResource });
  console.log("📦 Copied resources to dist");
} else {
  console.log("⚠️ No resources directory found");
}
