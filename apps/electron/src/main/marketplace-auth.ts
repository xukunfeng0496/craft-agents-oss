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

/** Verify the session is actually valid (GET /api/me → 200) using the partition's
 * cookie jar — more reliable than mere cookie presence (which can be pre-auth). */
function verifySession(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = net.request({ url: ME_URL, session: portalSession(), useSessionCookies: true })
    req.on('response', (res) => {
      resolve(res.statusCode === 200)
      res.on('data', () => {})
      res.on('end', () => {})
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
        // skills.gz.cvte.cn (the callback set the cookie and redirected to the app).
        const onNavigate = (url: string) => {
          try {
            const u = new URL(url)
            if (u.host === HOST && !u.pathname.startsWith('/auth/')) {
              void readCookieHeader().then((cookie) =>
                settle(cookie ? { success: true } : { success: false, error: '登录未取得会话，请重试' }),
              )
            }
          } catch { /* non-URL navigation — ignore */ }
        }

        win.webContents.on('did-navigate', (_e, url) => onNavigate(url))
        win.webContents.on('did-redirect-navigation', (_e, url) => onNavigate(url))
        win.on('closed', () => settle({ success: false, error: '登录已取消' }))

        timer = setTimeout(() => settle({ success: false, error: '登录超时' }), LOGIN_TIMEOUT_MS)

        win.loadURL(LOGIN_URL).catch((err) =>
          settle({ success: false, error: err instanceof Error ? err.message : '无法打开登录页' }),
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
