#!/usr/bin/env node

/**
 * Prepare bundled Windows tools for packaging.
 *
 * This script always downloads the Windows tool payloads. On Windows hosts it
 * also bootstraps pip and preinstalls common packages into the embedded Python.
 * On non-Windows hosts we cannot execute python.exe, so we limit preparation to
 * static file changes that are still valid for packaged artifacts.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const { enableSitePackages } = require('./setup-embedded-pip.cjs');
const { main: configurePipMirror } = require('./configure-pip-mirror.cjs');

function runNodeScript(scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit' });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status}`);
  }
}

async function main() {
  console.log('🔧 Preparing bundled Windows tools\n');

  runNodeScript('download-tools.cjs');

  if (process.platform === 'win32') {
    runNodeScript('setup-embedded-pip.cjs');
    configurePipMirror();
    runNodeScript('preinstall-packages.cjs');
    console.log('\n✅ Bundled Windows tools are fully prepared.');
    return;
  }

  enableSitePackages();
  configurePipMirror();

  console.log('\n⚠️  Host platform is not Windows; skipping pip bootstrap and Python package pre-install.');
  console.log('    The installer can still be built for size/layout verification.');
  console.log('    Run this step on Windows before publishing if bundled Python must include pip and preinstalled packages.');
}

main().catch((err) => {
  console.error('\n❌ Error preparing bundled Windows tools:', err.message);
  process.exit(1);
});
