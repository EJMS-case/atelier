// ── F2 — MOOD TAGS ───────────────────────────────────────────────────────────
// The chips on the Style Me panel. Each mood injects a short direction into
// the styling prompt so the same occasion can produce visually different
// outputs depending on how she wants to feel.

export const MOODS = [
  {
    key: "quiet-luxury",
    label: "Quiet Luxury",
    prompt: "MOOD: Quiet Luxury. Restrained, impeccable. Finest fabrics speaking softly. Column silhouettes in tonal neutrals. No logos, no statements beyond perfect cut. Think Totême editorial, The Row, Toteme denim + a fine cashmere crewneck.",
  },
  {
    key: "romantic",
    label: "Romantic",
    prompt: "MOOD: Romantic. Soft, feminine lines without being saccharine. Fluid silks, lace details, slipper-flat shoes, a well-judged pearl or gold layered chain. Dark Winter palette still rules — dusty blush + ivory, cherry + navy, never peach.",
  },
  {
    key: "edgy",
    label: "Edgy",
    prompt: "MOOD: Edgy. Sharp tailoring + leather. One unexpected proportion — oversized blazer thrown on a slip, a leather trouser, a motorcycle jacket over silk. Heeled boots OK when weather allows. Confidence, not costume.",
  },
  {
    key: "sporty",
    label: "Sporty",
    prompt: "MOOD: Sporty. Elevated athleisure or tailored athleisure. A luxe track pant, a fine-knit polo, a sharp baseball cap with a camel coat. Everything still curated — no logos, no actual workout gear, no sneakers.",
  },
  {
    key: "effortless",
    label: "Effortless",
    prompt: "MOOD: Effortless. The thrown-on look. Denim + a beautiful knit + one well-loved accessory. Feels unfussed but every piece is considered. Think French-girl Saturday morning, not trying.",
  },
];

export function moodPromptFor(moodKey) {
  const m = MOODS.find(m => m.key === moodKey);
  return m ? m.prompt : "";
}
