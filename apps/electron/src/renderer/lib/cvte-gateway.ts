// CVTE enterprise gateway — Anthropic-Messages protocol at the intranet host.
// Exposed as a first-class provider preset (D7/D8) so token.cvte.com resolves
// to a branded "CVTE" entry instead of falling through to "Custom"; selecting
// it collapses the form to key-only (endpoint/protocol/models are provisioned).
export const CVTE_GATEWAY_URL = 'https://token.cvte.com'
export const CVTE_GATEWAY_PRESET_KEY = 'cvte-cch'

/** Both the Anthropic host (token.cvte.com) and the OpenAI host (…/v1) are the CVTE gateway. */
export function isCvteGatewayUrl(url: string): boolean {
  if (!url) return false
  try {
    return new URL(url).host === new URL(CVTE_GATEWAY_URL).host
  } catch {
    return url.startsWith(CVTE_GATEWAY_URL)
  }
}
