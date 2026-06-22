#!/usr/bin/env node

/**
 * Download and extract the bundled Windows toolchain for the agent subprocess.
 *
 * This script downloads:
 * - MinGit 2.44.0 (portable Git for Windows)  → resources/tools/mingit
 * - Python 3.12.8 embedded (minimal runtime)  → resources/tools/python
 * - Node.js 20.18.1 (win-x64)                 → resources/tools/node
 * - uv latest (win-x64)                        → resources/bin/win32-x64/uv.exe
 *
 * resources/tools/* are bundled via win.extraResources and prepended to the agent
 * subprocess PATH at runtime by apps/electron/src/main/index.ts (uv is resolved via
 * CRAFT_UV + the same PATH prepend). The script is idempotent — it skips a tool when
 * its marker binary already exists.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');
const TOOLS_DIR = path.join(RESOURCES_DIR, 'tools');
// uv ships under resources/bin/<platform> (resolved at runtime by index.ts), NOT
// under tools/. The platform dir is .gitignored and populated here at build time.
const BIN_DIR = path.join(RESOURCES_DIR, 'bin');

// Tool configurations.
//  - baseDir:     where extractTo lives (default TOOLS_DIR; uv overrides to BIN_DIR)
//  - marker:      a key file under the extracted dir used for the idempotency skip
//  - stripSubdir: archives that wrap everything in a versioned top dir (Node) are
//                 flattened so the binary sits directly under extractTo
const TOOLS = {
  mingit: {
    name: 'MinGit',
    version: '2.44.0',
    url: 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/MinGit-2.44.0-64-bit.zip',
    filename: 'MinGit-2.44.0-64-bit.zip',
    extractTo: 'mingit',
    marker: path.join('cmd', 'git.exe'),
    sha256: null // TODO: Add checksum for verification
  },
  python: {
    name: 'Python',
    version: '3.12.8',
    url: 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip',
    filename: 'python-3.12.8-embed-amd64.zip',
    extractTo: 'python',
    marker: 'python.exe',
    sha256: null // TODO: Add checksum for verification
  },
  node: {
    name: 'Node.js',
    version: '20.18.1',
    url: 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip',
    filename: 'node-v20.18.1-win-x64.zip',
    extractTo: 'node',
    stripSubdir: 'node-v20.18.1-win-x64', // zip wraps everything in this dir
    marker: 'node.exe',
    sha256: null
  },
  uv: {
    name: 'uv',
    version: 'latest',
    // GitHub releases/latest/download avoids pinning a version that may 404 later;
    // uv is a document-tool helper, so newest is acceptable (not user-facing).
    url: 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip',
    filename: 'uv-x86_64-pc-windows-msvc.zip',
    baseDir: BIN_DIR,
    extractTo: 'win32-x64', // → resources/bin/win32-x64/uv.exe (index.ts CRAFT_UV)
    marker: 'uv.exe',
    sha256: null
  }
};
const REQUEST_TIMEOUT = 60000; // 60 seconds

/**
 * Download a file from a URL with redirect support
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading from: ${url}`);

    const file = fs.createWriteStream(dest);
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;

    function makeRequest(currentUrl) {
      const request = https.get(currentUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            file.close(() => {
              fs.unlink(dest, () => {});
            });
            reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
          }

          const redirectUrl = response.headers.location;
          console.log(`  Following redirect to: ${redirectUrl}`);
          makeRequest(redirectUrl);
          return;
        }

        if (response.statusCode !== 200) {
          file.close(() => {
            fs.unlink(dest, () => {});
          });
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'], 10);
        if (isNaN(totalBytes) || totalBytes <= 0) {
          console.log('  Download size unknown, progress unavailable');
        }
        let downloadedBytes = 0;
        let lastProgress = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (!isNaN(totalBytes) && totalBytes > 0) {
            const progress = Math.floor((downloadedBytes / totalBytes) * 100);

            // Show progress every 10%
            if (progress >= lastProgress + 10) {
              console.log(`  Progress: ${progress}%`);
              lastProgress = progress;
            }
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log(`  Download complete: ${path.basename(dest)}`);
          resolve();
        });
      });

      // Set timeout
      request.setTimeout(REQUEST_TIMEOUT, () => {
        request.destroy();
        file.close(() => {
          fs.unlink(dest, () => {});
        });
        reject(new Error(`Request timeout after ${REQUEST_TIMEOUT / 1000} seconds`));
      });

      // Handle request errors
      request.on('error', (err) => {
        file.close(() => {
          fs.unlink(dest, () => {}); // Clean up partial download
        });
        reject(err);
      });
    }

    makeRequest(url);
  });
}

/**
 * Verify file checksum
 */
async function verifyChecksum(filePath, expectedSha256) {
  if (!expectedSha256) {
    console.log('  Checksum verification skipped (no checksum provided)');
    return true;
  }

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const actualSha256 = hash.digest('hex');
      if (actualSha256 === expectedSha256) {
        console.log('  Checksum verified successfully');
        resolve(true);
      } else {
        reject(new Error(`Checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`));
      }
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Extract a zip file to a destination directory
 */
function extractZip(zipPath, extractTo) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`  Extracting to: ${extractTo}`);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractTo, true);
      console.log(`  Extraction complete`);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Flatten a versioned wrapper directory: move everything from
 * `<toolDir>/<subdir>/*` up into `<toolDir>/`, then remove the empty subdir.
 * Node's win-x64 zip wraps its contents in `node-vX.Y.Z-win-x64/`.
 */
async function flattenSubdir(toolDir, subdir) {
  const inner = path.join(toolDir, subdir);
  if (!fs.existsSync(inner)) {
    return; // archive was already flat — nothing to do
  }
  for (const entry of await fs.promises.readdir(inner)) {
    await fs.promises.rename(path.join(inner, entry), path.join(toolDir, entry));
  }
  await fs.promises.rmdir(inner);
  console.log(`  Flattened ${subdir}/ → ${path.basename(toolDir)}/`);
}

/**
 * Download and extract a tool
 */
async function downloadTool(toolKey, config) {
  const baseDir = config.baseDir || TOOLS_DIR;
  const toolDir = path.join(baseDir, config.extractTo);
  // Skip when the key binary already exists (more robust than a bare dir check —
  // an empty/partial dir won't falsely satisfy idempotency).
  const markerPath = config.marker ? path.join(toolDir, config.marker) : toolDir;

  if (fs.existsSync(markerPath)) {
    console.log(`✓ ${config.name} ${config.version} already exists, skipping`);
    return;
  }

  console.log(`\n📦 Downloading ${config.name} ${config.version}...`);

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const zipPath = path.join(baseDir, config.filename);

  try {
    // Download
    await downloadFile(config.url, zipPath);

    // Verify checksum
    await verifyChecksum(zipPath, config.sha256);

    // Extract
    await extractZip(zipPath, toolDir);

    // Flatten a versioned wrapper dir if the archive has one (Node)
    if (config.stripSubdir) {
      await flattenSubdir(toolDir, config.stripSubdir);
    }

    // Clean up zip file
    await fs.promises.unlink(zipPath);
    console.log(`  Cleaned up: ${config.filename}`);

    console.log(`✓ ${config.name} ${config.version} installed successfully`);
  } catch (err) {
    // Clean up on error
    try {
      if (fs.existsSync(zipPath)) {
        await fs.promises.unlink(zipPath);
      }
      if (fs.existsSync(toolDir)) {
        await fs.promises.rm(toolDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error('  Warning: Failed to clean up after error:', cleanupErr.message);
    }
    throw err;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🔧 Windows Bundled Tools Downloader\n');
  console.log(`Target directory: ${TOOLS_DIR}\n`);

  // Create directories if they don't exist
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  }
  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
  }

  // Download all tools
  try {
    for (const [key, config] of Object.entries(TOOLS)) {
      await downloadTool(key, config);
    }

    console.log('\n✅ All tools downloaded successfully!');
    console.log(`\nTools installed in: ${TOOLS_DIR}`);
    console.log('  - mingit/   (git.exe)');
    console.log('  - python/   (python.exe)');
    console.log('  - node/     (node.exe, npm, npx)');
    console.log(`uv installed in: ${BIN_DIR}`);
    console.log('  - win32-x64/uv.exe');
  } catch (err) {
    console.error('\n❌ Error downloading tools:', err.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { downloadFile, verifyChecksum, extractZip, downloadTool };
