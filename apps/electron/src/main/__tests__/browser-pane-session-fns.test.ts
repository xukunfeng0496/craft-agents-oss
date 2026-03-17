import { describe, expect, it } from 'bun:test'
import { createSessionBrowserPaneFns, type SessionBrowserPaneManagerLike } from '../browser-pane-session-fns'

function createManagerMock(calls: string[]): SessionBrowserPaneManagerLike {
  const unused = async () => {
    throw new Error('unused')
  }

  return {
    getOrCreateForSession: (sessionId: string) => {
      calls.push(`getOrCreateForSession:${sessionId}`)
      return 'browser-5'
    },
    navigate: async (id: string, url: string) => {
      calls.push(`navigate:${id}:${url}`)
      return { url, title: 'Example' }
    },
    getAccessibilitySnapshot: async (id: string) => {
      calls.push(`snapshot:${id}`)
      return { url: 'https://example.com', title: 'Example', nodes: [] }
    },
    clickElement: async (id: string, ref: string) => {
      calls.push(`click:${id}:${ref}`)
    },
    clickAtCoordinates: async (id: string, x: number, y: number) => {
      calls.push(`clickAt:${id}:${x}:${y}`)
    },
    drag: async (id: string, x1: number, y1: number, x2: number, y2: number) => {
      calls.push(`drag:${id}:${x1}:${y1}:${x2}:${y2}`)
    },
    fillElement: async (id: string, ref: string, value: string) => {
      calls.push(`fill:${id}:${ref}:${value}`)
    },
    typeText: async (id: string, text: string) => {
      calls.push(`type:${id}:${text}`)
    },
    selectOption: async (id: string, ref: string, value: string) => {
      calls.push(`select:${id}:${ref}:${value}`)
    },
    setClipboard: async (id: string, text: string) => {
      calls.push(`setClipboard:${id}:${text}`)
    },
    getClipboard: async (id: string) => {
      calls.push(`getClipboard:${id}`)
      return 'clipboard'
    },
    screenshot: async (id: string) => {
      calls.push(`screenshot:${id}`)
      return { imageBuffer: Buffer.from('ok'), imageFormat: 'png' as const }
    },
    screenshotRegion: async (id: string, args: any) => {
      calls.push(`screenshotRegion:${id}:${JSON.stringify(args)}`)
      return { imageBuffer: Buffer.from('ok'), imageFormat: 'png' as const }
    },
    getConsoleLogs: (id: string) => {
      calls.push(`console:${id}`)
      return []
    },
    windowResize: async (id: string, width: number, height: number) => {
      calls.push(`resize:${id}:${width}:${height}`)
      return { width, height }
    },
    getNetworkLogs: (id: string) => {
      calls.push(`network:${id}`)
      return []
    },
    waitFor: async (id: string, args: any) => {
      calls.push(`wait:${id}:${JSON.stringify(args)}`)
      return { ok: true as const, kind: args.kind ?? 'unknown', elapsedMs: 1, detail: 'ok' }
    },
    sendKey: async (id: string, args: any) => {
      calls.push(`key:${id}:${JSON.stringify(args)}`)
    },
    getDownloads: async (id: string) => {
      calls.push(`downloads:${id}`)
      return []
    },
    uploadFile: async (id: string, ref: string, filePaths: string[]) => {
      calls.push(`upload:${id}:${ref}:${filePaths.join(',')}`)
    },
    scroll: async (id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number) => {
      calls.push(`scroll:${id}:${direction}:${amount ?? ''}`)
    },
    goBack: async (id: string) => {
      calls.push(`back:${id}`)
    },
    goForward: async (id: string) => {
      calls.push(`forward:${id}`)
    },
    evaluate: async (id: string, expression: string) => {
      calls.push(`evaluate:${id}:${expression}`)
      return null
    },
    focusWindow: async (sessionId: string, instanceId?: string) => {
      calls.push(`focusWindow:${sessionId}:${instanceId ?? ''}`)
      return { instanceId: instanceId ?? 'browser-5', title: 'Example', url: 'https://example.com' }
    },
    releaseControl: unused,
    closeWindow: unused,
    hideWindow: unused,
    listWindows: async () => [],
  }
}

describe('createSessionBrowserPaneFns', () => {
  it('resolves the actual browser instance id for navigate and screenshot', async () => {
    const calls: string[] = []
    const fns = createSessionBrowserPaneFns('session-123', createManagerMock(calls))

    await fns.navigate('https://x.gz.cvte.cn')
    await fns.screenshot()

    expect(calls).toEqual([
      'getOrCreateForSession:session-123',
      'navigate:browser-5:https://x.gz.cvte.cn',
      'getOrCreateForSession:session-123',
      'screenshot:browser-5',
    ])
  })

  it('focuses the resolved instance when opening in the foreground', async () => {
    const calls: string[] = []
    const fns = createSessionBrowserPaneFns('session-456', createManagerMock(calls))

    const result = await fns.openPanel({ background: false })

    expect(result).toEqual({ instanceId: 'browser-5' })
    expect(calls).toEqual([
      'getOrCreateForSession:session-456',
      'focusWindow:session-456:browser-5',
    ])
  })
})
