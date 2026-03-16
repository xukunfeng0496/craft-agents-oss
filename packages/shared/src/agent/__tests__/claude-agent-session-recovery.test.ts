import { beforeEach, describe, expect, it, mock } from 'bun:test';

const queryMock = mock();
const enableElectronNodeRuntimeFallbackMock = mock(() => ({
  executable: process.execPath,
  executableKind: 'node' as const,
  env: { ELECTRON_RUN_AS_NODE: '1' },
  disableInterceptorPreload: true,
}));
const getExecutableKindMock = mock(() => 'bun');

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
  createSdkMcpServer: (config: unknown) => config,
  tool: (_name: string, _schema: unknown, handler: unknown) => handler,
  AbortError: class AbortError extends Error {},
}));

mock.module('../options.ts', () => ({
  getDefaultOptions: async () => ({}),
  resetClaudeConfigCheck: () => {},
  enableElectronNodeRuntimeFallback: enableElectronNodeRuntimeFallbackMock,
  getExecutableKind: getExecutableKindMock,
}));

mock.module('../../config/preferences.ts', () => ({
  updatePreferences: () => {},
  loadPreferences: () => ({}),
  formatPreferencesForPrompt: () => '',
}));

const { AbortError } = await import('@anthropic-ai/claude-agent-sdk');
const { ClaudeAgent } = await import('../claude-agent.ts');

async function collectEvents(iterator: AsyncGenerator<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

describe('ClaudeAgent session recovery', () => {
  beforeEach(() => {
    queryMock.mockReset();
    enableElectronNodeRuntimeFallbackMock.mockReset();
    enableElectronNodeRuntimeFallbackMock.mockImplementation(() => ({
      executable: process.execPath,
      executableKind: 'node' as const,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      disableInterceptorPreload: true,
    }));
    getExecutableKindMock.mockReset();
    getExecutableKindMock.mockImplementation(() => 'bun');
  });

  it('retries with Electron Node fallback after SIGABRT on macOS arm64', async () => {
    const queryCalls: Array<{ prompt: unknown; options: Record<string, unknown> }> = [];

    queryMock.mockImplementation(({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
      queryCalls.push({ prompt, options });

      if (queryCalls.length === 1) {
        throw new Error('Claude Code process terminated by signal SIGABRT');
      }

      return (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Recovered with node fallback' }],
            usage: {
              input_tokens: 10,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          parent_tool_use_id: null,
          session_id: 'fallback-sdk-session',
          isReplay: false,
        };

        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
          parent_tool_use_id: null,
          session_id: 'fallback-sdk-session',
        };

        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          total_cost_usd: 0,
        };
      })();
    });

    const originalPlatform = process.platform;
    const originalArch = process.arch;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });

    try {
      const agent = new ClaudeAgent({
        workspace: {
          id: 'ws-1',
          name: 'Test Workspace',
          rootPath: '/tmp',
          createdAt: Date.now(),
        },
        session: {
          id: 'session-1',
          workspaceRootPath: '/tmp',
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        },
        model: 'claude-sonnet-4-20250514',
        isHeadless: true,
      });

      const events = await collectEvents(agent.chat('Trigger fallback'));

      expect(queryCalls).toHaveLength(2);
      expect(enableElectronNodeRuntimeFallbackMock).toHaveBeenCalledTimes(1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'info',
            message: 'Claude runtime crashed on startup. Retrying with compatibility mode...',
          }),
          expect.objectContaining({
            type: 'text_complete',
            text: 'Recovered with node fallback',
          }),
        ]),
      );

      agent.destroy();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      Object.defineProperty(process, 'arch', { value: originalArch });
    }
  });

  it('retries fresh when resume fails before streaming starts', async () => {
    const clearedSessionIds: string[] = [];
    const capturedSessionIds: string[] = [];
    const queryCalls: Array<{ prompt: unknown; options: Record<string, unknown> }> = [];

    queryMock.mockImplementation(({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
      queryCalls.push({ prompt, options });

      if (queryCalls.length === 1) {
        throw new Error('No conversation found with session ID: stale-sdk-session');
      }

      return (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Recovered answer' }],
            usage: {
              input_tokens: 12,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
          isReplay: false,
        };

        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
        };

        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          total_cost_usd: 0,
        };
      })();
    });

    const agent = new ClaudeAgent({
      workspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      session: {
        id: 'session-1',
        workspaceRootPath: '/tmp',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        sdkSessionId: 'stale-sdk-session',
      },
      model: 'claude-sonnet-4-20250514',
      isHeadless: true,
      onSdkSessionIdCleared: () => {
        const currentSessionId = agent.getSessionId();
        clearedSessionIds.push(currentSessionId ?? 'null');
      },
      onSdkSessionIdUpdate: (sessionId: string) => {
        capturedSessionIds.push(sessionId);
      },
      getRecoveryMessages: () => [
        { type: 'user', content: 'First question' },
        { type: 'assistant', content: 'First answer' },
      ],
    });

    const events = await collectEvents(agent.chat('Second question'));

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[0]?.options.resume).toBe('stale-sdk-session');
    expect(queryCalls[1]?.options.resume).toBeUndefined();
    expect(String(queryCalls[1]?.prompt)).toContain('<conversation_recovery>');
    expect(String(queryCalls[1]?.prompt)).toContain('First question');
    expect(String(queryCalls[1]?.prompt)).toContain('Second question');

    expect(clearedSessionIds).toEqual(['null']);
    expect(capturedSessionIds).toEqual(['fresh-sdk-session']);
    expect(agent.getSessionId()).toBe('fresh-sdk-session');

    expect(events.map(event => event.type)).toContain('info');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'info',
          message: 'Session expired, restoring context...',
        }),
        expect.objectContaining({
          type: 'text_complete',
          text: 'Recovered answer',
        }),
        expect.objectContaining({
          type: 'complete',
        }),
      ]),
    );

    agent.destroy();
  });

  it('retries fresh when resume fails via result error payload', async () => {
    const clearedSessionIds: string[] = [];
    const capturedSessionIds: string[] = [];
    const queryCalls: Array<{ prompt: unknown; options: Record<string, unknown> }> = [];

    queryMock.mockImplementation(({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
      queryCalls.push({ prompt, options });

      if (queryCalls.length === 1) {
        return (async function* () {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            session_id: 'transient-sdk-session',
            errors: ['No conversation found with session ID: stale-sdk-session'],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            modelUsage: {},
            total_cost_usd: 0,
          };
        })();
      }

      return (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Recovered from result error' }],
            usage: {
              input_tokens: 8,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
          isReplay: false,
        };

        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
        };

        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 8,
            output_tokens: 21,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          total_cost_usd: 0,
        };
      })();
    });

    const agent = new ClaudeAgent({
      workspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      session: {
        id: 'session-2',
        workspaceRootPath: '/tmp',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        sdkSessionId: 'stale-sdk-session',
      },
      model: 'claude-sonnet-4-20250514',
      isHeadless: true,
      onSdkSessionIdCleared: () => {
        const currentSessionId = agent.getSessionId();
        clearedSessionIds.push(currentSessionId ?? 'null');
      },
      onSdkSessionIdUpdate: (sessionId: string) => {
        capturedSessionIds.push(sessionId);
      },
      getRecoveryMessages: () => [
        { type: 'user', content: '[Attached file: resume.pdf]\n[Stored at: /tmp/resume.pdf]' },
      ],
    });

    const events = await collectEvents(agent.chat('帮我看看这个pdf'));

    expect(queryCalls).toHaveLength(2);
    expect(queryCalls[0]?.options.resume).toBe('stale-sdk-session');
    expect(queryCalls[1]?.options.resume).toBeUndefined();
    expect(String(queryCalls[1]?.prompt)).toContain('/tmp/resume.pdf');
    expect(clearedSessionIds).toEqual(['null']);
    expect(capturedSessionIds).toEqual(['fresh-sdk-session']);
    expect(agent.getSessionId()).toBe('fresh-sdk-session');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'info',
          message: 'Session expired, restoring context...',
        }),
        expect.objectContaining({
          type: 'text_complete',
          text: 'Recovered from result error',
        }),
      ]),
    );

    agent.destroy();
  });

  it('clears the SDK session when interrupted after message_start but before real content', async () => {
    queryMock.mockImplementation(() => (async function* () {
      yield {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: 'turn-1' },
        },
        session_id: 'stale-sdk-session',
      };

      throw new AbortError('Request was aborted.');
    })());

    const agent = new ClaudeAgent({
      workspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      session: {
        id: 'session-1',
        workspaceRootPath: '/tmp',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
      model: 'claude-sonnet-4-20250514',
      isHeadless: true,
      getRecoveryMessages: () => [],
    });

    const events = await collectEvents(agent.chat('', [
      {
        path: '/tmp/resume.pdf',
        name: 'resume.pdf',
        type: 'pdf',
        mimeType: 'application/pdf',
        size: 0,
      },
    ]));

    expect(agent.getSessionId()).toBeNull();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'complete' }),
      ]),
    );

    agent.destroy();
  });

  it('clears the SDK session when only queued user history exists after interrupt', async () => {
    queryMock.mockImplementation(() => (async function* () {
      yield {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: 'turn-1' },
        },
        session_id: 'stale-sdk-session',
      };

      throw new AbortError('Request was aborted.');
    })());

    const agent = new ClaudeAgent({
      workspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      session: {
        id: 'session-1',
        workspaceRootPath: '/tmp',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
      model: 'claude-sonnet-4-20250514',
      isHeadless: true,
      getRecoveryMessages: () => [
        { type: 'user', content: '[Attached file: resume.pdf]' },
      ],
    });

    await collectEvents(agent.chat('', [
      {
        path: '/tmp/resume.pdf',
        name: 'resume.pdf',
        type: 'pdf',
        mimeType: 'application/pdf',
        size: 0,
      },
    ]));

    expect(agent.getSessionId()).toBeNull();

    agent.destroy();
  });

  it('suppresses recovery info for internal redirect flows', async () => {
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) => {
      if (options.resume) {
        return (async function* () {
          yield {
            type: 'result',
            subtype: 'error_during_execution',
            errors: ['No conversation found with session ID: stale-sdk-session'],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
            modelUsage: {},
            total_cost_usd: 0,
          };
        })();
      }

      return (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Recovered silently' }],
            usage: {
              input_tokens: 5,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
          isReplay: false,
        };

        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
          parent_tool_use_id: null,
          session_id: 'fresh-sdk-session',
        };

        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 5,
            output_tokens: 13,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          modelUsage: {},
          total_cost_usd: 0,
        };
      })();
    });

    const agent = new ClaudeAgent({
      workspace: {
        id: 'ws-1',
        name: 'Test Workspace',
        rootPath: '/tmp',
        createdAt: Date.now(),
      },
      session: {
        id: 'session-3',
        workspaceRootPath: '/tmp',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        sdkSessionId: 'stale-sdk-session',
      },
      model: 'claude-sonnet-4-20250514',
      isHeadless: true,
      getRecoveryMessages: () => [
        { type: 'user', content: '[Attached file: resume.pdf]\n[Stored at: /tmp/resume.pdf]' },
      ],
    });

    const events = await collectEvents(agent.chat('帮我看看这个pdf', undefined, { suppressRecoveryInfo: true }));

    expect(events.some(event => event.type === 'info')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text_complete',
          text: 'Recovered silently',
        }),
      ]),
    );

    agent.destroy();
  });
});
