// ── SHARED UI PALETTE ────────────────────────────────────────────────────────
// Single source for the per-view PALETTE consts that used to be copy-pasted
// across Home / recap / builder / planner / VisionPilot. Every value is a CSS
// custom property defined in src/styles/tokens.css.
//
// Accent comes in two registers:
//   - `accent` → var(--color-accent), the soft brand gold.
//   - views whose accent renders the deep burgundy (#6D1A2E) use
//     var(--color-accent-strong) — spread a local override:
//       const PALETTE = { ...SHARED, accent: "var(--color-accent-strong)" }
//     NOTE: code that builds hex-alpha colors by string concatenation
//     (`${PALETTE.accent}0A`) needs a literal hex, not a var() — those views
//     keep the raw #6D1A2E in their local override instead.

export const PALETTE = {
  ink:    "var(--color-ink)",
  soft:   "var(--color-text)",
  muted:  "var(--color-text-muted)",
  bg:     "var(--color-surface)",
  cream:  "var(--color-bg)",
  line:   "var(--color-border-strong)",
  soft_line: "var(--color-border)",
  accent: "var(--color-accent)",
};
