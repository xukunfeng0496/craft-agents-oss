#!/usr/bin/env node

/**
 * Setup pip for embedded Python
 *
 * Embedded Python doesn't include pip by default. This script:
 * 1. Downloads get-pip.py
 * 2. Modifies python312._pth to enable site-packages
 * 3. Installs pip
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PYTHON_DIR = path.join(__dirname, '..', 'resources', 'tools', 'python');
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const GET_PIP_PATH = path.join(PYTHON_DIR, 'get-pip.py');
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe');

/**
 * Download get-pip.py
 */
function downloadGetPip() {
  return new Promise((resolve, reject) => {
    console.log('Downloading get-pip.py...');

    const file = fs.createWriteStream(GET_PIP_PATH);

    https.get(GET_PIP_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('✓ get-pip.py downloaded');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(GET_PIP_PATH, () => {});
      reject(err);
    });
  });
}

/**
 * Enable site-packages in python312._pth
 */
function enableSitePackages() {
  console.log('Enabling site-packages...');

  const pthFile = path.join(PYTHON_DIR, 'python312._pth');

  if (!fs.existsSync(pthFile)) {
    console.log('  Warning: python312._pth not found, skipping');
    return;
  }

  let content = fs.readFileSync(pthFile, 'utf8');

  // Uncomment "import site" if it's commented
  if (content.includes('#import site')) {
    content = content.replace('#import site', 'import site');
    fs.writeFileSync(pthFile, content, 'utf8');
    console.log('✓ Enabled site-packages');
  } else if (content.includes('import site')) {
    console.log('✓ site-packages already enabled');
  } else {
    // Add "import site" at the end
    content += '\nimport site\n';
    fs.writeFileSync(pthFile, content, 'utf8');
    console.log('✓ Added site-packages support');
  }
}

/**
 * Install pip using get-pip.py
 */
function installPip() {
  return new Promise((resolve, reject) => {
    console.log('Installing pip...');

    const proc = spawn(PYTHON_EXE, [GET_PIP_PATH, '--no-warn-script-location'], {
      cwd: PYTHON_DIR,
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✓ pip installed successfully');
        resolve();
      } else {
        reject(new Error(`pip installation failed with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Verify pip installation
 */
function verifyPip() {
  return new Promise((resolve, reject) => {
    console.log('Verifying pip installation...');

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
        console.log(`✓ ${output.trim()}`);
        resolve();
      } else {
        reject(new Error('pip verification failed'));
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
  console.log('🔧 Setting up pip for embedded Python\n');

  // Check if Python exists
  if (!fs.existsSync(PYTHON_EXE)) {
    console.error('❌ Python not found at:', PYTHON_EXE);
    console.error('Run "bun run tools:download" first');
    process.exit(1);
  }

  // Check if pip is already installed
  try {
    await verifyPip();
    console.log('\n✅ pip is already installed, nothing to do');
    return;
  } catch (err) {
    // pip not installed, continue with setup
  }

  try {
    // Download get-pip.py
    await downloadGetPip();

    // Enable site-packages
    enableSitePackages();

    // Install pip
    await installPip();

    // Verify installation
    await verifyPip();

    // Cleanup
    fs.unlinkSync(GET_PIP_PATH);
    console.log('✓ Cleaned up get-pip.py');

    console.log('\n✅ pip setup complete!');
  } catch (err) {
    console.error('\n❌ Error setting up pip:', err.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { downloadGetPip, enableSitePackages, installPip, verifyPip };
