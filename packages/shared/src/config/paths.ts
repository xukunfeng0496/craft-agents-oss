/**
 * Centralized path configuration for Work Agent.
 *
 * Supports multi-instance development via WORK_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., craft-tui-agent-1), the detect-instance.sh
 * script sets WORK_CONFIG_DIR to ~/.workagent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.workagent/
 * Instance 1 (-1 suffix): ~/.workagent-1/
 * Instance 2 (-2 suffix): ~/.workagent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.workagent/ for production and non-numbered dev folders
export const CONFIG_DIR = process.env.WORK_CONFIG_DIR || join(homedir(), '.workagent');
