import { join, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getCvteIdentity } from '@craft-agent/shared/config'
import type { MarketplaceClient as MarketplaceClientType } from '@craft-agent/shared/marketplace'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.marketplace.GET_REGISTRY,
  RPC_CHANNELS.marketplace.INSTALL_SKILL,
] as const

/**
 * Build a marketplace client from the persisted CVTE portal identity. The
 * account/email are sent as X-CSkills-User-Account/Email headers. Browsing the
 * registry is open (no identity needed); skill detail / install require the
 * account header — when absent, the registry returns 401 and the renderer guides
 * the user through portal SSO (which persists the identity).
 */
function buildClient(MarketplaceClient: typeof MarketplaceClientType): MarketplaceClientType {
  const identity = getCvteIdentity()
  return new MarketplaceClient({ account: identity?.account, email: identity?.email })
}

export function registerMarketplaceHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Fetch the marketplace registry from the remote registry server (open browse).
  server.handle(RPC_CHANNELS.marketplace.GET_REGISTRY, async () => {
    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    return buildClient(MarketplaceClient).getRegistry()
  })

  // Install a marketplace skill into a workspace's skills directory (needs identity).
  server.handle(RPC_CHANNELS.marketplace.INSTALL_SKILL, async (_ctx, workspaceId: string, skillName: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { MarketplaceClient } = await import('@craft-agent/shared/marketplace')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const files = await buildClient(MarketplaceClient).getSkillFiles(skillName)
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
