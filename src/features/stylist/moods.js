// ── VIBE VOCABULARY ──────────────────────────────────────────────────────────
// NOTE: the mood-chip feature (MOODS array + moodPromptFor) that used to live
// here was removed by owner request — she never used moods, and "Sporty" in
// particular will never be how she dresses. Occasion + weather + the free-text
// request now fully drive generation. Legacy saved looks may still carry a
// stored mood string in their metadata; readers display it tolerantly, and
// normalizeVibe (coerce-shapes.js) maps stray "sporty" values onto
// "Effortless" so old data degrades gracefully.

// Finite set of vibes the AI may assign to a generated look. Kept as a plain
// array so it can be imported into both the Zod schema (enum) and the prompt
// (one canonical source). Picked to cover the dominant editorial / day-to-day
// styles without exploding into synonyms.
export const VIBE_VOCABULARY = [
  "Quiet Luxury",
  "Romantic",
  "Edgy",
  "Effortless",
  "Editorial",
  "Polished Classic",
  "Modern Minimal",
  "Power Dressing",
  "Downtown Cool",
];
