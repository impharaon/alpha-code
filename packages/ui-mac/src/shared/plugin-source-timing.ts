// Capture keeps the budget for real ~300s / 25.8MB archives; search indexes return independently.
// A source failure does not prevent the remaining source results from being returned.
export const PLUGIN_SOURCE_REQUEST_TIMEOUT_MS = 10 * 60_000
export const PLUGIN_SOURCE_DEADLINE_MS = 30_000
export const PLUGIN_SOURCE_SEARCH_REPLY_TIMEOUT_MS = 40_000
