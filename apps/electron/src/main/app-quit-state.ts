/**
 * Shared quit state to coordinate between main process modules.
 * Avoids circular dependencies between index.ts and window-manager.ts.
 */
let _isQuitting = false

export function setAppQuitting(): void {
  _isQuitting = true
}

export function isAppQuitting(): boolean {
  return _isQuitting
}
