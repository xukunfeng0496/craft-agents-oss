import type { BrowserPaneFns } from '@work-agent/shared/agent/browser-tools'

export interface SessionBrowserPaneManagerLike {
  getOrCreateForSession(sessionId: string): string
  navigate(id: string, url: string): Promise<{ url: string; title: string }>
  getAccessibilitySnapshot(id: string): Promise<{
    url: string
    title: string
    nodes: Array<{
      ref: string
      role: string
      name: string
      value?: string
      description?: string
      focused?: boolean
      checked?: boolean
      disabled?: boolean
    }>
  }>
  clickElement(id: string, ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }): Promise<void>
  clickAtCoordinates(id: string, x: number, y: number): Promise<void>
  drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void>
  fillElement(id: string, ref: string, value: string): Promise<void>
  typeText(id: string, text: string): Promise<void>
  selectOption(id: string, ref: string, value: string): Promise<void>
  setClipboard(id: string, text: string): Promise<void>
  getClipboard(id: string): Promise<string>
  screenshot(id: string, args?: any): Promise<any>
  screenshotRegion(id: string, args: any): Promise<any>
  getConsoleLogs(id: string, args?: any): any
  windowResize(id: string, width: number, height: number): Promise<{ width: number; height: number }>
  getNetworkLogs(id: string, args?: any): any
  waitFor(id: string, args: any): Promise<{ ok: true; kind: string; elapsedMs: number; detail: string }>
  sendKey(id: string, args: any): Promise<void>
  getDownloads(id: string, args?: any): Promise<any>
  uploadFile(id: string, ref: string, filePaths: string[]): Promise<void>
  scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void>
  goBack(id: string): Promise<void>
  goForward(id: string): Promise<void>
  evaluate(id: string, expression: string): Promise<unknown>
  focusWindow(sessionId: string, instanceId?: string): Promise<{ instanceId: string; title: string; url: string }>
  releaseControl(sessionId: string, instanceId?: string): Promise<any>
  closeWindow(sessionId: string, instanceId?: string): Promise<any>
  hideWindow(sessionId: string, instanceId?: string): Promise<any>
  listWindows(sessionId: string): Promise<any>
}

/**
 * Build the BrowserPaneFns bridge for a session.
 * All stateful browser operations first resolve the actual browser instance id
 * owned by the session, then call the instance-level BrowserPaneManager API.
 */
export function createSessionBrowserPaneFns(
  sessionId: string,
  browserMgr: SessionBrowserPaneManagerLike,
): BrowserPaneFns {
  const resolveInstanceId = () => browserMgr.getOrCreateForSession(sessionId)

  return {
    openPanel: async (options?: { background?: boolean }) => {
      const result = await browserMgr.getOrCreateForSession(sessionId)
      if (!options?.background) {
        await browserMgr.focusWindow(sessionId, result)
      }
      return { instanceId: result }
    },
    navigate: async (url: string) => {
      return await browserMgr.navigate(resolveInstanceId(), url)
    },
    snapshot: async () => {
      return await browserMgr.getAccessibilitySnapshot(resolveInstanceId())
    },
    click: async (ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }) => {
      await browserMgr.clickElement(resolveInstanceId(), ref, options)
    },
    clickAt: async (x: number, y: number) => {
      await browserMgr.clickAtCoordinates(resolveInstanceId(), x, y)
    },
    drag: async (x1: number, y1: number, x2: number, y2: number) => {
      await browserMgr.drag(resolveInstanceId(), x1, y1, x2, y2)
    },
    fill: async (ref: string, value: string) => {
      await browserMgr.fillElement(resolveInstanceId(), ref, value)
    },
    type: async (text: string) => {
      await browserMgr.typeText(resolveInstanceId(), text)
    },
    select: async (ref: string, value: string) => {
      await browserMgr.selectOption(resolveInstanceId(), ref, value)
    },
    setClipboard: async (text: string) => {
      await browserMgr.setClipboard(resolveInstanceId(), text)
    },
    getClipboard: async () => {
      return await browserMgr.getClipboard(resolveInstanceId())
    },
    screenshot: async (args?: any) => {
      return await browserMgr.screenshot(resolveInstanceId(), args)
    },
    screenshotRegion: async (args: any) => {
      return await browserMgr.screenshotRegion(resolveInstanceId(), args)
    },
    getConsoleLogs: async (args?: any) => {
      return await browserMgr.getConsoleLogs(resolveInstanceId(), args)
    },
    windowResize: async (args: any) => {
      return await browserMgr.windowResize(resolveInstanceId(), args.width, args.height)
    },
    getNetworkLogs: async (args?: any) => {
      return await browserMgr.getNetworkLogs(resolveInstanceId(), args)
    },
    waitFor: async (args: any) => {
      return await browserMgr.waitFor(resolveInstanceId(), args)
    },
    sendKey: async (args: any) => {
      await browserMgr.sendKey(resolveInstanceId(), args)
    },
    getDownloads: async (args?: any) => {
      return await browserMgr.getDownloads(resolveInstanceId(), args)
    },
    upload: async (ref: string, filePaths: string[]) => {
      await browserMgr.uploadFile(resolveInstanceId(), ref, filePaths)
    },
    scroll: async (direction: 'up' | 'down' | 'left' | 'right', amount?: number) => {
      await browserMgr.scroll(resolveInstanceId(), direction, amount)
    },
    goBack: async () => {
      await browserMgr.goBack(resolveInstanceId())
    },
    goForward: async () => {
      await browserMgr.goForward(resolveInstanceId())
    },
    evaluate: async (expression: string) => {
      return await browserMgr.evaluate(resolveInstanceId(), expression)
    },
    focusWindow: async (instanceId?: string) => {
      return await browserMgr.focusWindow(sessionId, instanceId)
    },
    releaseControl: async (instanceId?: string) => {
      return await browserMgr.releaseControl(sessionId, instanceId)
    },
    closeWindow: async (instanceId?: string) => {
      return await browserMgr.closeWindow(sessionId, instanceId)
    },
    hideWindow: async (instanceId?: string) => {
      return await browserMgr.hideWindow(sessionId, instanceId)
    },
    listWindows: async () => {
      return await browserMgr.listWindows(sessionId)
    },
  }
}
