// Anthropic model IDs, by tier. Every call site imports from here — change a
// tier here to move all of its call sites at once.
export const MODEL_TOP = "claude-opus-4-8"; // stylist attempt 0, Settings re-detect
export const MODEL_STRONG = "claude-sonnet-5"; // stylist retries/fallback, shopping recs
export const MODEL_STANDARD = "claude-sonnet-4-6"; // most text/vision helpers
export const MODEL_FAST = "claude-haiku-4-5-20251001"; // cheap quick calls
