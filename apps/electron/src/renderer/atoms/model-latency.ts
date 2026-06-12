/**
 * CVTE: per-model measured latency stats (rolling EMA over real usage).
 *
 * Fed by `latency_update` agent events (see claude-agent.ts telemetry);
 * displayed as "近期实测" hints in the model picker. Persisted to
 * localStorage so hints survive restarts and track gateway changes.
 */
import { atom } from 'jotai'

export interface ModelLatencyStat {
  /** EMA of time-to-first-content in ms */
  ttftMs: number
  /** EMA of output tokens per second (undefined until a sample carries it) */
  tokensPerSec?: number
  samples: number
  updatedAt: number
}

const STORAGE_KEY = 'cvte-model-latency-stats-v1'
const EMA_ALPHA = 0.3

function loadStats(): Record<string, ModelLatencyStat> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const modelLatencyStatsAtom = atom<Record<string, ModelLatencyStat>>(loadStats())

export const recordModelLatencyAtom = atom(
  null,
  (get, set, update: { model: string; ttftMs: number; tokensPerSec?: number }) => {
    if (!update.model || !(update.ttftMs > 0)) return
    const current = get(modelLatencyStatsAtom)
    const prev = current[update.model]
    const next: ModelLatencyStat = prev
      ? {
          ttftMs: Math.round(prev.ttftMs * (1 - EMA_ALPHA) + update.ttftMs * EMA_ALPHA),
          tokensPerSec: update.tokensPerSec !== undefined
            ? Math.round(((prev.tokensPerSec ?? update.tokensPerSec) * (1 - EMA_ALPHA) + update.tokensPerSec * EMA_ALPHA) * 10) / 10
            : prev.tokensPerSec,
          samples: prev.samples + 1,
          updatedAt: Date.now(),
        }
      : {
          ttftMs: Math.round(update.ttftMs),
          tokensPerSec: update.tokensPerSec,
          samples: 1,
          updatedAt: Date.now(),
        }
    const merged = { ...current, [update.model]: next }
    set(modelLatencyStatsAtom, merged)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    } catch {
      // localStorage full/unavailable — hints just won't persist
    }
  },
)

/** Format a stat as a compact picker hint, e.g. "实测首字 2.1s · 45 tok/s" */
export function formatLatencyHint(stat: ModelLatencyStat | undefined): string | null {
  if (!stat) return null
  const ttft = `${(stat.ttftMs / 1000).toFixed(1)}s`
  return stat.tokensPerSec !== undefined
    ? `实测首字 ${ttft} · ${stat.tokensPerSec} tok/s`
    : `实测首字 ${ttft}`
}
