// Helpers for the `mist-network://` pseudo-provider convention shared across
// the tik-choco app family (see tc-docs/drafts/llm-settings-common-v1.md
// §2.2). tc-books doesn't create these entries itself (no AI Network
// "provider" role — see lib/network.ts, consumer-only), but the shared
// `tc-shared-llm-config-v1` config is co-owned: another app on the same
// origin (e.g. tc-translate) may have written one in. The AI接続 tab must
// recognize such a provider/preset and special-case it (no HTTP model fetch,
// no Base URL edit fields) rather than treating it as a broken connection.
export const NETWORK_PROVIDER_LABEL = "AI Network";
export const NETWORK_PROVIDER_URL_PREFIX = "mist-network://";

export function isNetworkProviderBaseUrl(baseUrl: string): boolean {
  return baseUrl.trim().startsWith(NETWORK_PROVIDER_URL_PREFIX);
}
