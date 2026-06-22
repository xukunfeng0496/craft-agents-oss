import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.marketplace.GET_REGISTRY,
  RPC_CHANNELS.marketplace.INSTALL_SKILL,
  RPC_CHANNELS.marketplace.LOGIN,
  RPC_CHANNELS.marketplace.GET_AUTH_STATUS,
  RPC_CHANNELS.marketplace.LOGOUT,
] as const

export function registerMarketplaceHandlers(server: RpcServer, deps: HandlerDeps): void {
  // The skills.gz.cvte.cn session cookie (from the in-app portal login), if any,
  // so registry/download requests carry the marketplace session.
  const marketplaceCookie = () => deps.platform.marketplaceAuth?.getCookie() ?? Promise.resolve(undefined)

  // Fetch the marketplace registry from the remote registry server
  server.handle(RPC_CHANNELS.marketplace.GET_REGISTRY, async () => {
    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    const client = new MarketplaceClient({ cookie: await marketplaceCookie() })
    return client.getRegistry()
  })

  // In-app marketplace login (shares the portal session with the gateway SSO)
  server.handle(RPC_CHANNELS.marketplace.LOGIN, async (): Promise<{ success: boolean; error?: string }> => {
    if (!deps.platform.marketplaceAuth) return { success: false, error: 'Marketplace login not supported on this platform' }
    return deps.platform.marketplaceAuth.login()
  })

  server.handle(RPC_CHANNELS.marketplace.GET_AUTH_STATUS, async (): Promise<{ authenticated: boolean }> => {
    const authenticated = (await deps.platform.marketplaceAuth?.isAuthenticated()) ?? false
    return { authenticated }
  })

  server.handle(RPC_CHANNELS.marketplace.LOGOUT, async (): Promise<{ success: boolean }> => {
    await deps.platform.marketplaceAuth?.logout()
    return { success: true }
  })

  // Install a marketplace skill into a workspace's skills directory
  server.handle(RPC_CHANNELS.marketplace.INSTALL_SKILL, async (_ctx, workspaceId: string, skillName: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const client = new MarketplaceClient({ cookie: await marketplaceCookie() })
    const files = await client.getSkillFiles(skillName)
    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillName)

    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true })
    }

    for (const file of files) {
      const filePath = join(skillDir, file.path)
      const dir = dirname(filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, file.content, 'utf-8')
    }

    deps.platform.logger?.info(`MARKETPLACE_INSTALL: Installed ${skillName} (${files.length} files) to ${skillDir}`)
  })
}
