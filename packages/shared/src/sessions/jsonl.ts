/**
 * JSONL Session Storage
 *
 * Helpers for reading/writing sessions in JSONL format.
 * Format: Line 1 = SessionHeader, Lines 2+ = StoredMessage (one per line)
 */

import { openSync, readSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { open, readFile } from 'fs/promises';
import { dirname } from 'path';
import type { SessionHeader, StoredSession, StoredMessage, SessionTokenUsage } from './types.ts';
import { toPortablePath, expandPath, normalizePath } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';
import { safeJsonParse } from '../utils/files.ts';
import { getSessionRuntimePathForWorkingDirectory } from './runtime-paths.ts';
import { pickSessionFields } from './utils.ts';

// ============================================================
// Session Path Portability
// ============================================================

const SESSION_PATH_TOKEN = '{{SESSION_PATH}}';
const SESSION_RUNTIME_PATH_TOKEN = '{{SESSION_RUNTIME_PATH}}';

function replacePortablePath(jsonLine: string, absolutePath: string | undefined, token: string): string {
  if (!absolutePath) return jsonLine;
  const normalized = normalizePath(absolutePath);
  let result = jsonLine.replaceAll(normalized, token);
  if (absolutePath !== normalized) {
    const jsonEscaped = absolutePath.replaceAll('\\', '\\\\');
    result = result.replaceAll(jsonEscaped, token);
  }
  return result;
}

function expandPortablePath(jsonLine: string, absolutePath: string | undefined, token: string): string {
  if (!absolutePath || !jsonLine.includes(token)) return jsonLine;
  return jsonLine.replaceAll(token, normalizePath(absolutePath));
}

function resolveRuntimeDirectory(header: Partial<SessionHeader>, sessionDir: string): string {
  if (header.runtimeDirectory) {
    return expandPath(header.runtimeDirectory);
  }

  const workingDirectory = header.workingDirectory ? expandPath(header.workingDirectory) : undefined;
  if (workingDirectory && header.id) {
    return getSessionRuntimePathForWorkingDirectory(workingDirectory, header.id);
  }

  return normalizePath(sessionDir);
}

function expandPortablePaths(jsonLine: string, sessionDir: string, runtimeDir: string): string {
  let result = expandPortablePath(jsonLine, sessionDir, SESSION_PATH_TOKEN);
  result = expandPortablePath(result, runtimeDir, SESSION_RUNTIME_PATH_TOKEN);
  return result;
}

function parseHeaderWithPortablePaths(firstLine: string, sessionDir: string): SessionHeader | null {
  const rawHeader = safeJsonParse(firstLine) as Partial<SessionHeader> | null;
  if (!rawHeader) return null;

  const runtimeDir = resolveRuntimeDirectory(rawHeader, sessionDir);
  return safeJsonParse(expandPortablePaths(firstLine, sessionDir, runtimeDir)) as SessionHeader;
}

/**
 * Replace absolute session directory paths with a portable token.
 * Applied after JSON.stringify so paths embedded anywhere in message content
 * (datatable src, planPath, attachment storedPath, etc.) are made portable.
 */
export function makeSessionPathPortable(
  jsonLine: string,
  sessionDir: string,
  runtimeDir?: string
): string {
  let result = replacePortablePath(jsonLine, sessionDir, SESSION_PATH_TOKEN);
  result = replacePortablePath(result, runtimeDir, SESSION_RUNTIME_PATH_TOKEN);
  return result;
}

/**
 * Expand the portable session path token back to an absolute path.
 * Applied before JSON.parse so all path references resolve correctly at runtime.
 */
export function expandSessionPath(jsonLine: string, sessionDir: string): string {
  return expandPortablePaths(jsonLine, sessionDir, sessionDir);
}

/**
 * Read only the header (first line) from a session.jsonl file.
 * Uses low-level fs to read minimal bytes for fast list loading.
 */
export function readSessionHeader(sessionFile: string): SessionHeader | null {
  try {
    const fd = openSync(sessionFile, 'r');
    const buffer = Buffer.alloc(8192); // 8KB is plenty for metadata header
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);
    closeSync(fd);

    const content = buffer.toString('utf-8', 0, bytesRead);
    const firstNewline = content.indexOf('\n');
    const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;

    return parseHeaderWithPortablePaths(firstLine, dirname(sessionFile));
  } catch (error) {
    debug('[jsonl] Failed to read session header:', sessionFile, error);
    return null;
  }
}

/**
 * Read full session from JSONL file.
 * Parses header and all message lines.
 */
export function readSessionJsonl(sessionFile: string): StoredSession | null {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    const firstLine = lines[0];
    if (!firstLine) return null;

    const sessionDir = dirname(sessionFile);
    const header = parseHeaderWithPortablePaths(firstLine, sessionDir);
    if (!header) return null;
    // Parse messages resiliently: skip lines that fail to parse (e.g. truncated by crash)
    // rather than losing the entire session's messages.
    // Expand session path tokens before parsing so embedded paths resolve correctly.
    const runtimeDir = resolveRuntimeDirectory(header, sessionDir);
    const expandedMessageLines = lines.slice(1).map(line => expandPortablePaths(line, sessionDir, runtimeDir));
    const messages = parseMessagesResilient(expandedMessageLines);

    // Migration: For sessions created before runtimeDirectory / sdkCwd were added,
    // derive them from workingDirectory.
    // This is correct because the old code used workingDirectory for SDK's cwd parameter.
    const workingDir = header.workingDirectory ? expandPath(header.workingDirectory) : undefined;
    const runtimeDirectory = header.runtimeDirectory ? expandPath(header.runtimeDirectory) : runtimeDir;
    const sdkCwd = header.sdkCwd ? expandPath(header.sdkCwd) : workingDir;

    return {
      ...pickSessionFields(header),
      // Path expansion for portable paths
      workspaceRootPath: expandPath(header.workspaceRootPath),
      workingDirectory: workingDir,
      runtimeDirectory,
      sdkCwd,
      // Runtime fields
      messages,
      tokenUsage: header.tokenUsage,
    } as StoredSession;
  } catch (error) {
    debug('[jsonl] Failed to read session:', sessionFile, error);
    return null;
  }
}

/**
 * Write session to JSONL format using atomic write (write-to-temp-then-rename).
 * Prevents file corruption if the process crashes mid-write: either the old
 * file remains intact or the new file is fully written. Never a partial file.
 *
 * Line 1: Header with pre-computed metadata
 * Lines 2+: Messages (one per line)
 */
export function writeSessionJsonl(sessionFile: string, session: StoredSession): void {
  const header = createSessionHeader(session);
  const sessionDir = dirname(sessionFile);
  const runtimeDir = session.runtimeDirectory ?? sessionDir;

  const lines = [
    makeSessionPathPortable(JSON.stringify(header), sessionDir, runtimeDir),
    ...session.messages.map(m => makeSessionPathPortable(JSON.stringify(m), sessionDir, runtimeDir)),
  ];

  const tmpFile = sessionFile + '.tmp';
  writeFileSync(tmpFile, lines.join('\n') + '\n');
  // On Windows, rename fails if target exists. Delete first for cross-platform compatibility.
  try { unlinkSync(sessionFile); } catch { /* ignore if doesn't exist */ }
  renameSync(tmpFile, sessionFile);
}

/**
 * Create a SessionHeader from a StoredSession.
 * Pre-computes messageCount, preview, and lastMessageRole for fast list loading.
 * Uses pickSessionFields() to ensure all persistent fields are included.
 */
export function createSessionHeader(session: StoredSession): SessionHeader {
  return {
    ...pickSessionFields(session),
    // Path conversion for portability
    workspaceRootPath: toPortablePath(session.workspaceRootPath),
    workingDirectory: session.workingDirectory ? toPortablePath(session.workingDirectory) : undefined,
    runtimeDirectory: session.runtimeDirectory ? toPortablePath(session.runtimeDirectory) : undefined,
    sdkCwd: session.sdkCwd ? toPortablePath(session.sdkCwd) : undefined,
    // Override lastUsedAt with current timestamp (save time, not original)
    lastUsedAt: Date.now(),
    // Pre-computed fields
    messageCount: session.messages.length,
    lastMessageRole: extractLastMessageRole(session.messages),
    preview: extractPreview(session.messages),
    tokenUsage: session.tokenUsage,
    lastFinalMessageId: extractLastFinalMessageId(session.messages),
  } as SessionHeader;
}

/**
 * Extract the role of the last message for badge display.
 * Only returns roles that are meaningful for UI display (user, assistant, plan, tool, error).
 */
function extractLastMessageRole(messages: StoredMessage[]): SessionHeader['lastMessageRole'] {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return undefined;
  // Map message types to the subset we care about for display
  const role = lastMessage.type;
  if (role === 'user' || role === 'assistant' || role === 'plan' || role === 'tool' || role === 'error') {
    return role;
  }
  return undefined;
}

/**
 * Extract the ID of the last final (non-intermediate) assistant message.
 * Used for unread detection in session list without loading all messages.
 */
function extractLastFinalMessageId(messages: StoredMessage[]): string | undefined {
  // Walk backwards to find the last assistant message that isn't intermediate
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'assistant' && !msg.isIntermediate) {
      return msg.id;
    }
  }
  return undefined;
}

/**
 * Extract preview from first user message.
 * Sanitizes by stripping special blocks and normalizing whitespace.
 * Returns first 150 chars.
 */
function extractPreview(messages: StoredMessage[]): string | undefined {
  const firstUserMessage = messages.find(m => m.type === 'user');
  if (!firstUserMessage?.content) return undefined;

  // Sanitize: strip special blocks, tags, and bracket mentions, normalize whitespace
  const sanitized = firstUserMessage.content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')     // Strip remaining XML/HTML tags
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')   // Strip [skill:...] mentions
    .replace(/\[source:[\w-]+\]/g, '')              // Strip [source:...] mentions
    .replace(/\[file:[^\]]+\]/g, '')                // Strip [file:...] mentions
    .replace(/\[folder:[^\]]+\]/g, '')              // Strip [folder:...] mentions
    .replace(/\s+/g, ' ')        // Collapse whitespace (including newlines)
    .trim();

  return sanitized.substring(0, 150) || undefined;
}

/**
 * Async version of readSessionHeader for parallel I/O.
 * Uses fs/promises for non-blocking reads.
 */
export async function readSessionHeaderAsync(sessionFile: string): Promise<SessionHeader | null> {
  try {
    const handle = await open(sessionFile, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, 8192, 0);
      const content = buffer.toString('utf-8', 0, bytesRead);
      const firstNewline = content.indexOf('\n');
      const firstLine = firstNewline > 0 ? content.slice(0, firstNewline) : content;
      return parseHeaderWithPortablePaths(firstLine, dirname(sessionFile));
    } finally {
      await handle.close();
    }
  } catch (error) {
    debug('[jsonl] Failed to read session header async:', sessionFile, error);
    return null;
  }
}

/**
 * Read only messages from a JSONL file (skips header).
 * Used for lazy loading when session is selected.
 * Resilient to corrupted/truncated lines (skips them instead of failing entirely).
 */
export function readSessionMessages(sessionFile: string): StoredMessage[] {
  try {
    const content = readFileSync(sessionFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    // Skip first line (header), expand session/runtime path tokens, parse rest resiliently
    const sessionDir = dirname(sessionFile);
    const header = parseHeaderWithPortablePaths(lines[0] || '', sessionDir);
    const runtimeDir = resolveRuntimeDirectory(header ?? {}, sessionDir);
    const expandedLines = lines.slice(1).map(line => expandPortablePaths(line, sessionDir, runtimeDir));
    return parseMessagesResilient(expandedLines);
  } catch (error) {
    debug('[jsonl] Failed to read session messages:', sessionFile, error);
    return [];
  }
}

/**
 * Parse message lines resiliently: skip lines that fail JSON.parse
 * (e.g. truncated by a crash mid-write) rather than losing all messages.
 */
function parseMessagesResilient(lines: string[]): StoredMessage[] {
  const messages: StoredMessage[] = [];
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line) as StoredMessage);
    } catch {
      // Corrupted/truncated line (likely from a crash during write).
      // Skip it and continue — losing one message is better than losing all.
      debug('[jsonl] Skipping corrupted message line (truncated?):', line.substring(0, 100));
    }
  }
  return messages;
}
