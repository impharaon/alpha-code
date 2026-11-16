// Robustness budgets, above the recorded ~300s / 25.8MB marketplace fetch.
// A source failure does not prevent the remaining source results from being returned.
export const PLUGIN_SOURCE_REQUEST_TIMEOUT_MS = 10 * 60_000
export const PLUGIN_SOURCE_DEADLINE_MS = 15 * 60_000
export const PLUGIN_SOURCE_SEARCH_REPLY_TIMEOUT_MS = 20 * 60_000
