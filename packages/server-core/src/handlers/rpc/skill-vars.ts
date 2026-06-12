import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getSkillVars, setSkillVar, deleteSkillVar } from '@craft-agent/shared/skills'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skillVars.GET,
  RPC_CHANNELS.skillVars.SET,
] as const

export function registerSkillVarsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  /**
   * skillVars:get
   * Returns a map of { varName: boolean } — true means the variable has been set.
   * Values are NEVER returned to the renderer (secrets stay in the credential store).
   */
  server.handle(
    RPC_CHANNELS.skillVars.GET,
    async (_ctx, workspaceId: string, skillSlug: string, varNames: string[]) => {
      const stored = await getSkillVars(workspaceId, skillSlug, varNames)
      const result: Record<string, boolean> = {}
      for (const name of varNames) {
        result[name] = name in stored
      }
      return result
    },
  )

  /**
   * skillVars:set
   * Saves or deletes skill variable values.
   * An empty string value means "delete this variable".
   */
  server.handle(
    RPC_CHANNELS.skillVars.SET,
    async (_ctx, workspaceId: string, skillSlug: string, vars: Record<string, string>) => {
      for (const [varName, value] of Object.entries(vars)) {
        if (value === '') {
          await deleteSkillVar(workspaceId, skillSlug, varName)
        } else {
          await setSkillVar(workspaceId, skillSlug, varName, value)
        }
      }
    },
  )
}
