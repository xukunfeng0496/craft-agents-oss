/**
 * electron-builder afterPack hook
 *
 * Copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file is compiled locally using actool with the
 * macOS 26 SDK (not available in CI), then committed to the repo.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const appPath = context.appOutDir;

  // Remove wrong-arch ripgrep binaries from the SDK.
  // electron-builder includes both arm64-darwin and x64-darwin ripgrep variants
  // because the extraResources filter only excludes linux/win32 dirs.
  // For arm64 builds: remove x64-darwin; for x64 builds: remove arm64-darwin.
  const arch = context.arch === 3 ? 'arm64' : 'x64'; // 3 = Arch.arm64
  const ripgrepBase = path.join(
    appPath, 'Work Agents.app', 'Contents', 'Resources',
    'app', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep'
  );
  const wrongArch = arch === 'arm64' ? 'x64-darwin' : 'arm64-darwin';
  const wrongArchDir = path.join(ripgrepBase, wrongArch);
  if (fs.existsSync(wrongArchDir)) {
    fs.rmSync(wrongArchDir, { recursive: true, force: true });
    console.log(`Removed wrong-arch ripgrep: ${wrongArch}`);
  }
  const resourcesDir = path.join(appPath, 'Work Agents.app', 'Contents', 'Resources');
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};
