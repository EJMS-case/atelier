// ── THE FORMALITY SCALE, ONCE ────────────────────────────────────────────────
// wardrobe_items.formality is how DRESSY a piece is, 1–8, not where she wears
// it. She defined each step herself (owner, 2026-11-23):
//
//   "Lounge should also include sports bras and leggings. Sweats, lounge
//    sets, sweats sets. These are also good for travel. … No sleep."
//   "Casual could be any daytime activity including lunches and brunch."
//   "All work is polished."  ·  "Formal should read 'cocktail'."
//
// Before this the scale was written four ways: the Edit select ("casual,
// travel", "work, dinner, an event", "formal"), the stylist prompt and THE
// STANDARD ("4 Smart Casual, 5 Business Casual, 6 Business Professional",
// which told the model her everyday office pieces were business casual), and
// two band tables that disagreed. The packer read a Travel Day as 3–4 while
// every prompt dressed it from lounge; Lounge was 1–2 in one and 2 in the other.
// Now the words, the names the model reads, and the bands live here, and every
// one of those sites reads them.
//
// A leaf module with no imports: the prompt module, standardLines.js and
// item-helpers all read it without a cycle.

/** The select she files on: [value, words]. Edit, Add Items, the Select bar. */
export const FORMALITY_SCALE = [
  [1, "active, gym"],
  [2, "lounge: sweat sets, leggings, sports bras · travel"],
  [3, "casual: daytime, lunch, brunch"],
  [4, "elevated casual, an easy dinner"],
  [5, "work"],
  [6, "dressier work, a work dinner"],
  [7, "cocktail"],
  [8, "black tie"],
];

/** The one-word name per step that a prompt reads (`f5 Work`). */
export const FORMALITY_NAMES = {
  1: "Active", 2: "Lounge", 3: "Casual", 4: "Elevated Casual",
  5: "Work", 6: "Dressier Work", 7: "Cocktail", 8: "Black Tie",
};

/**
 * Which steps a room reaches for. Soft everywhere: LOOK FACTS name a piece
 * outside its band, the packer scores distance from it, nothing filters.
 * Travel Day is 1–3 from what she has flown in (live, 2026-11-23: Never
 * Better sets f1, lounge zip-ups and pants f2–f3, a leather jacket over).
 */
export const FORMALITY_BANDS = {
  Active: [1, 2],
  Lounge: [1, 2],
  "Travel Day": [1, 3],
  Casual: [3, 4],
  Vacation: [3, 4],
  Dinner: [4, 6],
  Work: [5, 6],
  "Work Dinner": [5, 6],
  Occasion: [7, 8],
};

/** "f1 Active, f2 Lounge, …" for a prompt. */
export const FORMALITY_LEGEND = Object.entries(FORMALITY_NAMES)
  .map(([f, name]) => `f${f} ${name}`).join(", ");

/** "Casual ≈ 3–4, Lounge ≈ 1–2, …" for a prompt. */
export const FORMALITY_BAND_LEGEND = Object.entries(FORMALITY_BANDS)
  .map(([room, [lo, hi]]) => `${room} ≈ ${lo}–${hi}`).join(", ");
