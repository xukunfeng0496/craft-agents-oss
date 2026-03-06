#!/usr/bin/env node

/**
 * Pre-install common Python packages for embedded Python
 *
 * This script installs commonly used packages into the bundled Python:
 * - openpyxl: Excel file handling
 * - pandas: Data analysis
 * - numpy: Numerical computing (pandas dependency)
 * - requests: HTTP library
 * - python-dateutil: Date utilities (pandas dependency)
 * - tzdata: Timezone data (pandas dependency on Windows)
 * - et-xmlfile: XML handling (openpyxl dependency)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_DIR = path.join(__dirname, '..', 'resources', 'tools', 'python');
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe');

// Packages to pre-install
const PACKAGES = [
  'openpyxl',      // Excel file handling
  'pandas',        // Data analysis (includes numpy, python-dateutil, tzdata)
  'requests',      // HTTP library
  'beautifulsoup4', // HTML/XML parsing
  'lxml',          // XML/HTML parser (faster than built-in)
  'pillow',        // Image processing
  'python-dotenv', // Environment variables
  'pyyaml',        // YAML parsing
  'jsonschema',    // JSON schema validation
];

/**
 * Install a package using pip
 */
function installPackage(packageName) {
  return new Promise((resolve, reject) => {
    console.log(`\n📦 Installing ${packageName}...`);

    const proc = spawn(
      PYTHON_EXE,
      ['-m', 'pip', 'install', '--no-warn-script-location', packageName],
      {
        cwd: PYTHON_DIR,
        stdio: 'inherit'
      }
    );

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ ${packageName} installed successfully`);
        resolve();
      } else {
        reject(new Error(`Failed to install ${packageName} (exit code ${code})`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Verify pip is available
 */
function verifyPip() {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_EXE, ['-m', 'pip', '--version'], {
      cwd: PYTHON_DIR,
      stdio: 'pipe'
    });

    let output = '';
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ pip available: ${output.trim()}`);
        resolve();
      } else {
        reject(new Error('pip is not available. Run "bun run tools:setup-pip" first.'));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * List installed packages
 */
function listPackages() {
  return new Promise((resolve, reject) => {
    console.log('\n📋 Installed packages:');

    const proc = spawn(PYTHON_EXE, ['-m', 'pip', 'list', '--format=columns'], {
      cwd: PYTHON_DIR,
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to list packages'));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 Pre-installing common Python packages\n');

  // Check if Python exists
  if (!fs.existsSync(PYTHON_EXE)) {
    console.error('❌ Python not found at:', PYTHON_EXE);
    console.error('Run "bun run tools:download" first');
    process.exit(1);
  }

  try {
    // Verify pip is available
    await verifyPip();

    // Install each package
    for (const pkg of PACKAGES) {
      try {
        await installPackage(pkg);
      } catch (err) {
        console.error(`⚠️  Warning: Failed to install ${pkg}:`, err.message);
        console.error('   Continuing with other packages...');
      }
    }

    // List all installed packages
    await listPackages();

    console.log('\n✅ Package pre-installation complete!');
    console.log('\nInstalled packages:');
    PACKAGES.forEach(pkg => console.log(`  - ${pkg}`));
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { installPackage, verifyPip, listPackages };
