import { join } from 'path';

import { sanitizeSessionId } from './validation.ts';

export const SESSION_RUNTIME_ROOT_DIRNAME = '.craft-agent';
export const SESSION_RUNTIME_SESSIONS_DIRNAME = 'sessions';

/**
 * Compute the hidden runtime directory for a session inside a working directory.
 *
 * Runtime artifacts live here:
 * - plans/
 * - data/
 * - attachments/
 * - downloads/
 * - long_responses/
 * - tool metadata / backend config
 */
export function getSessionRuntimePathForWorkingDirectory(
  workingDirectory: string,
  sessionId: string
): string {
  return join(
    workingDirectory,
    SESSION_RUNTIME_ROOT_DIRNAME,
    SESSION_RUNTIME_SESSIONS_DIRNAME,
    sanitizeSessionId(sessionId),
  );
}
