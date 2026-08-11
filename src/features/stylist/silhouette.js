// ── ABOUT ME → SILHOUETTE GUIDANCE ───────────────────────────────────────────
// Pure translation (node-testable, no I/O): turns her free-text About Me
// (Settings → About Me, loadAboutMe) into compact dress-to-flatter lines for
// the stylist prompt's HER BODY & FIT block. Roadmap A5.
//
//   petite frame — favor cropped or tucked tops, high-rise bottoms, …
//   fit notes: prefer relaxed shoulders, avoid anything itchy
//   context: late 30s · finance, client-facing
//
// Design notes (same register as lookEdits.js / occasionMemory.js):
//   · Recognized cues (height, torso balance, shoulders, shape, bust) become
//     EXPLICIT proportion guidance — the model shouldn't have to derive
//     styling logic from "5'2\"" on its own.
//   · Unmatched free text still passes through as a labeled raw line — her
//     own words are signal even when no cue fires; fitNotes ALWAYS passes
//     through verbatim (capped) since it's guidance in her voice already.
//   · ageRange / professionalContext collapse into ONE context line — they
//     inform register, not silhouette.
//   · Soft by design: every line is "favor / lean / skip" taste steering,
//     never a hard rule the validator could enforce. No validator changes.
//   · Hard caps (≤6 lines, per-line char clip) — the block's token budget
//     stays flat (~80-100 tokens) no matter how much she writes.
//   · Thin data → [] — the caller simply doesn't render the block.

const MAX_LINES = 6;
const MAX_LINE_CHARS = 130;   // safety clip on every emitted line
const PASSTHROUGH_CHARS = 90; // raw free-text passthrough budget
const SHORT_FIELD_CHARS = 40; // height / age / profession snippets

const PETITE_MAX_INCHES = 64; // under 5'4" reads petite
const TALL_MIN_INCHES = 68;   // 5'8"+ reads tall

// Directive lines per cue family. Reasoned styling logic, soft phrasing:
//   · petite → unbroken vertical line; crop/tuck + high rise lengthens the leg.
//   · short torso (usually longer legs) → ELONGATE THE TORSO: lower rises,
//     untucked/half-tucked tops, tonal dressing; ultra-high-rise + full tuck
//     shortens it further.
//   · long torso (shorter legs) → RAISE THE VISUAL WAIST: high rise, cropped
//     tops/jackets, waist emphasis to lengthen the leg line.
//   · broad shoulders → soften the line up top; narrow → structure builds it.
//   · hourglass → show the waist; pear → eye up + skim the hip; soft middle →
//     skim not cling; tall → can carry volume and long lines.
//   · fuller bust → open necklines beat high crews with volume up top.
const DIRECTIVES = {
  petite: "petite frame — favor cropped or tucked tops, high-rise bottoms, and column lines that lengthen the leg; skip volume-on-volume",
  tall: "tall frame — she can carry volume, long lines, and midi/maxi lengths; strong proportions welcome",
  shortTorso: "short torso, longer legs — lengthen the torso: mid/lower rises, untucked or half-tucked tops, tonal top-to-bottom dressing",
  longTorso: "long torso, shorter legs — raise the visual waist: high-rise bottoms, cropped tops/jackets, waist emphasis to lengthen the leg",
  broadShoulders: "broad shoulders — favor soft, relaxed shoulder lines and V or scoop necklines; skip heavy shoulder structure",
  narrowShoulders: "narrow shoulders — structured shoulders, boat necks, and crisp tailoring up top build balance",
  hourglass: "hourglass/curvy — define the waist (wrap shapes, belting, fitted-through-the-middle); skip boxy volume that hides it",
  pear: "pear shape — draw the eye up with detail and structure on top; A-line or fluid bottoms that skim the hip",
  midsection: "softer midsection — pieces that skim, not cling, through the middle; open necklines and structure up top balance",
  bust: "fuller bust — favor open V or scoop necklines over high crews; keep extra volume and heavy detail off the top",
};

// Free text arrives from controlled inputs but defend anyway: strings pass,
// finite numbers stringify, everything else ("[object Object]", arrays) → "".
function safeText(v) {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// "5'2\"" / "5 ft 2" / "5 foot 2" → 62; "157cm" → 61.8; "1.57m" → 61.8.
// Returns inches, or null when nothing parses (or the result is implausible).
function parseHeightInches(text) {
  const s = String(text).toLowerCase();
  let m = s.match(/(\d)\s*(?:['’]|ft\.?|feet|foot)\s*(\d{1,2})?/);
  let inches = null;
  if (m) inches = Number(m[1]) * 12 + (Number(m[2]) || 0);
  else if ((m = s.match(/(\d{2,3}(?:\.\d+)?)\s*cm/))) inches = Number(m[1]) / 2.54;
  else if ((m = s.match(/\b([12]\.\d{1,2})\s*m\b/))) inches = (Number(m[1]) * 100) / 2.54;
  return inches != null && inches >= 48 && inches <= 90 ? inches : null;
}

/**
 * Distill her About Me into prompt-ready silhouette/context lines.
 *
 * @param {Object} [aboutMe] - loadAboutMe() shape; all fields optional free
 *                             text: { height, torsoLength, fitNotes,
 *                             proportions, ageRange, professionalContext }
 * @returns {string[]} ≤6 compact lines (directives first, then her raw
 *                     notes, then the age/work context line); [] when empty
 */
export function summarizeSilhouette(aboutMe) {
  if (!aboutMe || typeof aboutMe !== "object" || Array.isArray(aboutMe)) return [];
  const height = safeText(aboutMe.height);
  const torso = safeText(aboutMe.torsoLength);
  const props = safeText(aboutMe.proportions);
  const fit = safeText(aboutMe.fitNotes);
  const age = safeText(aboutMe.ageRange);
  const work = safeText(aboutMe.professionalContext);

  // Cue scanning marks which fields were "understood", so only genuinely
  // unmatched text passes through raw. fitNotes feeds cues too but always
  // passes through regardless — it's already guidance in her words.
  const fields = { height, torso, props };
  const used = { height: false, torso: false, props: false };
  const fire = (re) => {
    let hit = false;
    for (const k of Object.keys(fields)) {
      if (fields[k] && re.test(fields[k])) { hit = true; used[k] = true; }
    }
    if (fit && re.test(fit)) hit = true;
    return hit;
  };

  const directives = [];

  // Height → petite / tall (explicit words beat parsing; parse covers the rest).
  const inches = parseHeightInches(height);
  if (inches != null) used.height = true;
  if (fire(/\bpetite\b/i) || (inches != null && inches < PETITE_MAX_INCHES)) {
    directives.push(DIRECTIVES.petite);
    used.height = true;
  } else if (fire(/\btall\b/i) || (inches != null && inches >= TALL_MIN_INCHES)) {
    directives.push(DIRECTIVES.tall);
    used.height = true;
  }

  // Torso balance. "short legs" is the long-torso problem stated from the
  // other end, so it keys the same rebalance; a short torso wins ties.
  const shortTorso = fire(/short(?:er|ish)?[\s-]*torso/i);
  const longTorso = fire(/long(?:er|ish)?[\s-]*torso/i);
  const shortLegs = fire(/short(?:er|ish)?[\s-]*legs?\b/i);
  if (shortTorso) directives.push(DIRECTIVES.shortTorso);
  else if (longTorso || shortLegs) directives.push(DIRECTIVES.longTorso);

  // Shoulders.
  const broad = fire(/(?:broad|strong|wide|athletic)[\s-]+shoulders?/i);
  const narrow = fire(/(?:narrow|sloped|small)[\s-]+shoulders?/i);
  if (broad) directives.push(DIRECTIVES.broadShoulders);
  else if (narrow) directives.push(DIRECTIVES.narrowShoulders);

  // Overall shape — one line max, most specific cue wins.
  if (fire(/hourglass|curvy/i)) directives.push(DIRECTIVES.hourglass);
  else if (fire(/\bpear\b|full(?:er)?[\s-]+hips|wide(?:r)?[\s-]+hips|bottom[\s-]*heavy/i)) directives.push(DIRECTIVES.pear);
  else if (fire(/\bapple\b|mid-?section|tummy|belly|soft(?:er)?[\s-]+middle/i)) directives.push(DIRECTIVES.midsection);

  // Bust.
  if (fire(/\bbusty\b|(?:large|larger|full|fuller|big|bigger)[\s-]+(?:bust|chest)|\bDD\b/i)) {
    directives.push(DIRECTIVES.bust);
  }

  // Raw passthroughs: fitNotes always; other fields only when no cue claimed
  // them. Labeled so the model knows which words are hers.
  const passthroughs = [];
  if (fit) passthroughs.push(`fit notes: ${clip(fit, PASSTHROUGH_CHARS)}`);
  if (torso && !used.torso) passthroughs.push(`torso: ${clip(torso, PASSTHROUGH_CHARS)}`);
  if (props && !used.props) passthroughs.push(`proportions: ${clip(props, PASSTHROUGH_CHARS)}`);
  if (height && !used.height) passthroughs.push(`height: ${clip(height, SHORT_FIELD_CHARS)}`);

  const lines = [...directives, ...passthroughs];

  // One compact register line — age + work context, never a directive.
  const ctx = [age, work].filter(Boolean).map(s => clip(s, SHORT_FIELD_CHARS));
  if (ctx.length) lines.push(`context: ${ctx.join(" · ")}`);

  return lines.slice(0, MAX_LINES).map(l => clip(l, MAX_LINE_CHARS));
}
