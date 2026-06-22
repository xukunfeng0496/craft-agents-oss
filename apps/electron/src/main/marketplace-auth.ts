/**
 * CVTE skills-marketplace login (Electron).
 *
 * Downloading skills from skills.gz.cvte.cn requires a 统一门户 SSO session: the
 * server redirects `/auth/login` → home.cvte.com portal OAuth → its own
 * `/auth/callback`, which sets a **session cookie** on skills.gz.cvte.cn. There is
 * no client-side token (the code is consumed server-side), so the only way for the
 * app's Node fetches to authenticate is to carry that cookie.
 *
 * We complete the login in a BrowserWindow bound to a **persistent, shared** portal
 * session partition. Because the home.cvte.com portal session lives in that
 * partition, a user already signed in for the gateway SSO is not prompted again —
 * one 统一门户 login covers both (the "shared logic" is the portal session, not the
 * per-service credential). The captured cookie is read back from the partition and
 * injected into MarketplaceClient requests.
 */
import { BrowserWindow, session, net, type Session } from 'electron'
import type { MarketplaceAuthService } from '@craft-agent/server-core/runtime'
import type { PlatformServices } from '@craft-agent/server-core/runtime'

// Shared persistent portal session — reused across CVTE portal logins so the
// 统一门户 session is single-sign-on. Survives restarts (cookie persistence).
export const CVTE_PORTAL_PARTITION = 'persist:cvte-portal'

const ORIGIN = 'https://skills.gz.cvte.cn'
const HOST = 'skills.gz.cvte.cn'
const LOGIN_URL = `${ORIGIN}/auth/login`
const ME_URL = `${ORIGIN}/api/me`
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000

function portalSession(): Session {
  return session.fromPartition(CVTE_PORTAL_PARTITION)
}

/** Build a "name=value; …" Cookie header from the partition's skills cookies. */
async function readCookieHeader(): Promise<string | undefined> {
  const cookies = await portalSession().cookies.get({ url: ORIGIN })
  if (!cookies.length) return undefined
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
}

/** Verify a real logged-in session. NB: GET /api/me returns 200 even when logged
 * out (`{"user":null}`), so the status code is not enough — we must inspect the
 * body for a non-null user. Uses the partition's cookie jar (useSessionCookies). */
function verifySession(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = net.request({ url: ME_URL, session: portalSession(), useSessionCookies: true })
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        resolve(false)
        res.on('data', () => {})
        res.on('end', () => {})
        return
      }
      let body = ''
      res.on('data', (c) => { body += c.toString() })
      res.on('end', () => {
        try {
          const me = JSON.parse(body) as { user?: unknown }
          resolve(me?.user != null)
        } catch {
          resolve(false)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

export function createMarketplaceAuth(logger: PlatformServices['logger']): MarketplaceAuthService {
  return {
    async login(): Promise<{ success: boolean; error?: string }> {
      return new Promise((resolve) => {
        const win = new BrowserWindow({
          width: 520,
          height: 720,
          title: '登录技能市场',
          autoHideMenuBar: true,
          webPreferences: { partition: CVTE_PORTAL_PARTITION, nodeIntegration: false, contextIsolation: true },
        })

        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined

        const settle = (result: { success: boolean; error?: string }) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          win.removeAllListeners('closed')
          if (!win.isDestroyed()) win.close()
          logger?.info(`[marketplace-auth] login ${result.success ? 'succeeded' : `failed: ${result.error}`}`)
          resolve(result)
        }

        // Login completes when the window lands back on a non-/auth/ page of
        // skills.gz.cvte.cn AND /api/me confirms a real user (a cookie alone can be
        // pre-auth, and /api/me 200s even when logged out). Only settle on success
        // here — a not-yet-authed navigation just waits for the next one.
        const onNavigate = (url: string) => {
          try {
            const u = new URL(url)
            if (u.host === HOST && !u.pathname.startsWith('/auth/')) {
              void verifySession().then((ok) => { if (ok) settle({ success: true }) })
            }
          } catch { /* non-URL navigation — ignore */ }
        }

        win.webContents.on('did-navigate', (_e, url) => onNavigate(url))
        win.webContents.on('did-redirect-navigation', (_e, url) => onNavigate(url))
        win.on('closed', () => settle({ success: false, error: 'CANCELLED' }))

        timer = setTimeout(() => settle({ success: false, error: 'TIMEOUT' }), LOGIN_TIMEOUT_MS)

        // Pass the raw chromium error through (e.g. ERR_CONNECTION_RESET) so the
        // renderer can recognize a transport failure and show the clean network
        // message instead of a raw code.
        win.loadURL(LOGIN_URL).catch((err) =>
          settle({ success: false, error: err instanceof Error ? err.message : 'ERR_FAILED loading login page' }),
        )
      })
    },

    getCookie(): Promise<string | undefined> {
      return readCookieHeader()
    },

    isAuthenticated(): Promise<boolean> {
      return verifySession()
    },

    async logout(): Promise<void> {
      const ses = portalSession()
      const cookies = await ses.cookies.get({ url: ORIGIN })
      await Promise.all(cookies.map((c) => ses.cookies.remove(ORIGIN, c.name).catch(() => {})))
      logger?.info('[marketplace-auth] logged out (cleared skills.gz.cvte.cn cookies)')
    },
  }
}
