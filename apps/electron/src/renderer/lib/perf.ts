/**
 * Renderer-side Performance Instrumentation
 *
 * Tracks session switch timing from click to render complete.
 * Logs via electron-log to the main log file.
 *
 * Usage:
 *   // In SessionList click handler:
 *   rendererPerf.startSessionSwitch(sessionId)
 *
 *   // In ChatTabPanel when session loads:
 *   rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
 *
 *   // When render is complete:
 *   rendererPerf.endSessionSwitch(sessionId)
 */

import log from 'electron-log/renderer'

const perfLog = log.scope('perf')
const STREAMING_WINDOW_MS = 1000

interface SessionSwitchMetric {
  sessionId: string
  startTime: number
  marks: Array<{ name: string; elapsed: number }>
  endTime?: number
  duration?: number
}

interface StreamingPerfWindow {
  sessionId: string
  startedAt: number
  lastUpdatedAt: number
  deltaEvents: number
  deltaChars: number
  processedEvents: number
  processedEventMs: number
  maxProcessedEventMs: number
  atomUpdates: number
  atomUpdateMs: number
  maxAtomUpdateMs: number
  groupingRuns: number
  groupingMs: number
  maxGroupingMs: number
  groupedMessages: number
  groupedTurns: number
  renderCommits: number
  renderActualMs: number
  renderBaseMs: number
  maxRenderActualMs: number
  resizeObserverCallbacks: number
  smoothScrollCalls: number
  animatedHeightAdjustments: number
}

// Pending session switches (keyed by sessionId)
const pendingSwitches = new Map<string, SessionSwitchMetric>()

// Recent completed metrics for analysis
const recentMetrics: SessionSwitchMetric[] = []
const MAX_RECENT_METRICS = 50

// Debug mode detection (matches main process pattern)
let debugMode = false
const streamingPerfWindows = new Map<string, StreamingPerfWindow>()

function createStreamingWindow(sessionId: string, now = performance.now()): StreamingPerfWindow {
  return {
    sessionId,
    startedAt: now,
    lastUpdatedAt: now,
    deltaEvents: 0,
    deltaChars: 0,
    processedEvents: 0,
    processedEventMs: 0,
    maxProcessedEventMs: 0,
    atomUpdates: 0,
    atomUpdateMs: 0,
    maxAtomUpdateMs: 0,
    groupingRuns: 0,
    groupingMs: 0,
    maxGroupingMs: 0,
    groupedMessages: 0,
    groupedTurns: 0,
    renderCommits: 0,
    renderActualMs: 0,
    renderBaseMs: 0,
    maxRenderActualMs: 0,
    resizeObserverCallbacks: 0,
    smoothScrollCalls: 0,
    animatedHeightAdjustments: 0,
  }
}

function flushStreamingWindow(window: StreamingPerfWindow): void {
  if (!debugMode) return
  perfLog.info('streaming.window', {
    sessionId: window.sessionId,
    windowMs: Math.max(0, window.lastUpdatedAt - window.startedAt),
    deltaEvents: window.deltaEvents,
    deltaChars: window.deltaChars,
    processedEvents: window.processedEvents,
    processedEventMs: Number(window.processedEventMs.toFixed(2)),
    maxProcessedEventMs: Number(window.maxProcessedEventMs.toFixed(2)),
    atomUpdates: window.atomUpdates,
    atomUpdateMs: Number(window.atomUpdateMs.toFixed(2)),
    maxAtomUpdateMs: Number(window.maxAtomUpdateMs.toFixed(2)),
    groupingRuns: window.groupingRuns,
    groupingMs: Number(window.groupingMs.toFixed(2)),
    maxGroupingMs: Number(window.maxGroupingMs.toFixed(2)),
    groupedMessages: window.groupedMessages,
    groupedTurns: window.groupedTurns,
    renderCommits: window.renderCommits,
    renderActualMs: Number(window.renderActualMs.toFixed(2)),
    renderBaseMs: Number(window.renderBaseMs.toFixed(2)),
    maxRenderActualMs: Number(window.maxRenderActualMs.toFixed(2)),
    resizeObserverCallbacks: window.resizeObserverCallbacks,
    smoothScrollCalls: window.smoothScrollCalls,
    animatedHeightAdjustments: window.animatedHeightAdjustments,
  })
}

function getStreamingWindow(sessionId: string): StreamingPerfWindow {
  const now = performance.now()
  const current = streamingPerfWindows.get(sessionId)

  if (!current) {
    const created = createStreamingWindow(sessionId, now)
    streamingPerfWindows.set(sessionId, created)
    return created
  }

  if ((now - current.startedAt) >= STREAMING_WINDOW_MS) {
    current.lastUpdatedAt = now
    flushStreamingWindow(current)
    const next = createStreamingWindow(sessionId, now)
    streamingPerfWindows.set(sessionId, next)
    return next
  }

  current.lastUpdatedAt = now
  return current
}

/**
 * Initialize perf tracking. Call this once on app startup.
 * In Electron renderer, we check if we're in dev mode.
 */
export function initRendererPerf(isDebug: boolean): void {
  debugMode = isDebug
  if (debugMode) {
    perfLog.info('Renderer performance tracking enabled')
  }
}

/**
 * Check if perf tracking is enabled
 */
export function isRendererPerfEnabled(): boolean {
  return debugMode
}

/**
 * Start tracking a session switch.
 * Call this when user clicks on a session in the list.
 * Clears any other pending switches (user navigated away before completion).
 */
export function startSessionSwitch(sessionId: string): void {
  if (!debugMode) return

  // Clear any other pending switches - user navigated away before they completed
  pendingSwitches.clear()

  const metric: SessionSwitchMetric = {
    sessionId,
    startTime: performance.now(),
    marks: [],
  }
  pendingSwitches.set(sessionId, metric)

  // Log the tap immediately (0ms elapsed) - shows the start of the flow
  perfLog.info(`${sessionId.slice(0, 8)}... session-list.tap: 0.0ms`)
}

/**
 * Add a checkpoint mark during session switch.
 * Use for intermediate steps like 'session.loaded', 'agent.status', etc.
 */
export function markSessionSwitch(sessionId: string, markName: string): void {
  if (!debugMode) return

  const metric = pendingSwitches.get(sessionId)
  if (!metric) return

  const elapsed = performance.now() - metric.startTime
  metric.marks.push({ name: markName, elapsed })

  perfLog.info(`${sessionId.slice(0, 8)}... ${markName}: ${elapsed.toFixed(1)}ms`)
}

/**
 * End session switch tracking and log final duration.
 * Call this when the chat display has fully rendered.
 */
export function endSessionSwitch(sessionId: string): number | null {
  if (!debugMode) return null

  const metric = pendingSwitches.get(sessionId)
  if (!metric) return null

  metric.endTime = performance.now()
  metric.duration = metric.endTime - metric.startTime

  // Store in recent metrics
  recentMetrics.push(metric)
  if (recentMetrics.length > MAX_RECENT_METRICS) {
    recentMetrics.shift()
  }

  // Clean up pending
  pendingSwitches.delete(sessionId)

  // Log completion with breakdown
  const marksStr = metric.marks.map((m) => `${m.name}:${m.elapsed.toFixed(0)}ms`).join(' → ')
  perfLog.info(
    `Session switch complete: ${metric.duration.toFixed(1)}ms` +
      (marksStr ? ` (${marksStr})` : '')
  )

  return metric.duration
}

/**
 * Get recent session switch metrics for analysis
 */
export function getRecentMetrics(): SessionSwitchMetric[] {
  return [...recentMetrics]
}

/**
 * Get statistics for session switch times
 */
export function getSessionSwitchStats(): {
  count: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
} | null {
  if (recentMetrics.length === 0) return null

  const durations = recentMetrics
    .filter((m) => m.duration !== undefined)
    .map((m) => m.duration!)

  if (durations.length === 0) return null

  const sorted = [...durations].sort((a, b) => a - b)
  const sum = durations.reduce((a, b) => a + b, 0)

  return {
    count: durations.length,
    avgMs: sum / durations.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  }
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  pendingSwitches.clear()
  recentMetrics.length = 0
  streamingPerfWindows.clear()
}

export function recordStreamingEventProcessing(
  sessionId: string,
  eventType: string,
  elapsedMs: number,
  deltaChars = 0
): void {
  if (!debugMode) return
  const window = getStreamingWindow(sessionId)
  if (eventType === 'text_delta') {
    window.deltaEvents += 1
    window.deltaChars += deltaChars
  }
  window.processedEvents += 1
  window.processedEventMs += elapsedMs
  window.maxProcessedEventMs = Math.max(window.maxProcessedEventMs, elapsedMs)
}

export function recordStreamingAtomUpdate(
  sessionId: string,
  elapsedMs: number
): void {
  if (!debugMode) return
  const window = getStreamingWindow(sessionId)
  window.atomUpdates += 1
  window.atomUpdateMs += elapsedMs
  window.maxAtomUpdateMs = Math.max(window.maxAtomUpdateMs, elapsedMs)
}

export function recordStreamingTurnGrouping(
  sessionId: string,
  elapsedMs: number,
  messageCount: number,
  turnCount: number
): void {
  if (!debugMode) return
  const window = getStreamingWindow(sessionId)
  window.groupingRuns += 1
  window.groupingMs += elapsedMs
  window.maxGroupingMs = Math.max(window.maxGroupingMs, elapsedMs)
  window.groupedMessages = messageCount
  window.groupedTurns = turnCount
}

export function recordStreamingRenderCommit(
  sessionId: string,
  actualDuration: number,
  baseDuration: number
): void {
  if (!debugMode) return
  const window = getStreamingWindow(sessionId)
  window.renderCommits += 1
  window.renderActualMs += actualDuration
  window.renderBaseMs += baseDuration
  window.maxRenderActualMs = Math.max(window.maxRenderActualMs, actualDuration)
}

export function recordStreamingLayoutMetric(
  sessionId: string,
  metric: 'resizeObserverCallbacks' | 'smoothScrollCalls' | 'animatedHeightAdjustments',
  count = 1
): void {
  if (!debugMode) return
  const window = getStreamingWindow(sessionId)
  window[metric] += count
}

export function flushStreamingPerf(sessionId?: string): void {
  if (!debugMode) return
  if (sessionId) {
    const window = streamingPerfWindows.get(sessionId)
    if (!window) return
    flushStreamingWindow(window)
    streamingPerfWindows.delete(sessionId)
    return
  }

  for (const [id, window] of streamingPerfWindows) {
    flushStreamingWindow(window)
    streamingPerfWindows.delete(id)
  }
}

// Export as namespace for convenient usage
export const rendererPerf = {
  init: initRendererPerf,
  isEnabled: isRendererPerfEnabled,
  startSessionSwitch,
  markSessionSwitch,
  endSessionSwitch,
  getRecentMetrics,
  getStats: getSessionSwitchStats,
  recordStreamingEventProcessing,
  recordStreamingAtomUpdate,
  recordStreamingTurnGrouping,
  recordStreamingRenderCommit,
  recordStreamingLayoutMetric,
  flushStreamingPerf,
  clear: clearMetrics,
}

export default rendererPerf
