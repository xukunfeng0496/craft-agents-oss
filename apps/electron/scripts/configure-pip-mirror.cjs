#!/usr/bin/env node

/**
 * Configure pip to use Aliyun mirror by default
 *
 * This script creates pip.ini (Windows) to configure the default PyPI mirror.
 * This ensures that when agents run `pip install` at runtime, they use the
 * Aliyun mirror for faster downloads in China.
 */

const fs = require('fs');
const path = require('path');

const PYTHON_DIR = path.join(__dirname, '..', 'resources', 'tools', 'python');
const PIP_INI_PATH = path.join(PYTHON_DIR, 'pip.ini');

// pip configuration content
const PIP_CONFIG = `[global]
index-url = https://mirrors.aliyun.com/pypi/simple/
trusted-host = mirrors.aliyun.com

[install]
trusted-host = mirrors.aliyun.com
`;

/**
 * Main execution
 */
function main() {
  console.log('🔧 Configuring pip to use Aliyun mirror\n');

  // Check if Python directory exists
  if (!fs.existsSync(PYTHON_DIR)) {
    console.error('❌ Python directory not found at:', PYTHON_DIR);
    console.error('Run "bun run tools:download" first');
    process.exit(1);
  }

  try {
    // Write pip.ini
    fs.writeFileSync(PIP_INI_PATH, PIP_CONFIG, 'utf8');
    console.log('✓ Created pip.ini at:', PIP_INI_PATH);
    console.log('\nConfiguration:');
    console.log('  Index URL: https://mirrors.aliyun.com/pypi/simple/');
    console.log('  Trusted Host: mirrors.aliyun.com');
    console.log('\n✅ pip configuration complete!');
    console.log('\nNow pip will use Aliyun mirror by default for all installations.');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
