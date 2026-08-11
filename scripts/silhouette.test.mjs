// ── SILHOUETTE SUMMARY TESTS ─────────────────────────────────────────────────
// Node-run tests for summarizeSilhouette (features/stylist/silhouette.js)
// — the pure function that turns her free-text About Me into the stylist
// prompt's HER BODY & FIT lines (roadmap A5).
//
// Run: npm run test:silhouette

import { summarizeSilhouette } from "../src/features/stylist/silhouette.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const has = (lines, re) => lines.some(l => re.test(l));

// ── Empty / missing → [] ─────────────────────────────────────────────────────
{
  assert(summarizeSilhouette({}).length === 0, "empty object → []");
  assert(summarizeSilhouette().length === 0, "undefined → []");
  assert(summarizeSilhouette(null).length === 0, "null → []");
  assert(summarizeSilhouette({ height: "", fitNotes: "  ", proportions: "" }).length === 0,
    "all-blank fields → []");
}

// ── Petite via multiple height formats ───────────────────────────────────────
{
  const PETITE = /petite frame/;
  assert(has(summarizeSilhouette({ height: "5'2\"" }), PETITE), `5'2" reads petite`);
  assert(has(summarizeSilhouette({ height: "5 ft 2" }), PETITE), "5 ft 2 reads petite");
  assert(has(summarizeSilhouette({ height: "5 foot 3" }), PETITE), "5 foot 3 reads petite");
  assert(has(summarizeSilhouette({ height: "157cm" }), PETITE), "157cm reads petite");
  assert(has(summarizeSilhouette({ height: "1.57m" }), PETITE), "1.57m reads petite");
  assert(has(summarizeSilhouette({ height: "petite" }), PETITE), "the word petite reads petite");
  const lines = summarizeSilhouette({ height: "5'2\"" });
  assert(lines.length === 1 && !has(lines, /height:/), "petite height is consumed, not re-passed raw");
}

// ── Tall / neutral heights ───────────────────────────────────────────────────
{
  assert(has(summarizeSilhouette({ height: "5'9\"" }), /tall frame/), `5'9" reads tall`);
  assert(has(summarizeSilhouette({ height: "178 cm" }), /tall frame/), "178 cm reads tall");
  const mid = summarizeSilhouette({ height: "5'6\"" });
  assert(!has(mid, /petite|tall frame/), `5'6" gets no petite/tall directive`);
  assert(summarizeSilhouette({ height: "average height" }).some(l => l === "height: average height"),
    "unparsed height passes through labeled");
}

// ── Torso balance — the styling logic must point the right way ───────────────
{
  const st = summarizeSilhouette({ torsoLength: "short torso" });
  assert(has(st, /lengthen the torso/), "short torso → lengthen-the-torso directive");
  assert(has(st, /mid\/lower rises/) && !has(st, /raise the visual waist/),
    "short torso favors LOWER rises, never the high-rise rebalance");
  const lt = summarizeSilhouette({ torsoLength: "Long torso, short legs" });
  assert(has(lt, /raise the visual waist/) && has(lt, /high-rise/),
    "long torso → raise-the-waist / high-rise directive");
  assert(has(summarizeSilhouette({ proportions: "short legs" }), /raise the visual waist/),
    "short legs alone keys the same rebalance as long torso");
  assert(!has(lt, /lengthen the torso/), "long torso never gets the short-torso line");
}

// ── Shoulders ────────────────────────────────────────────────────────────────
{
  assert(has(summarizeSilhouette({ proportions: "broad shoulders" }), /relaxed shoulder lines/),
    "broad shoulders → soft shoulder-line directive");
  assert(has(summarizeSilhouette({ proportions: "Strong shoulders" }), /skip heavy shoulder structure/),
    "strong shoulders keys the same directive");
  assert(has(summarizeSilhouette({ proportions: "narrow shoulders" }), /structured shoulders/),
    "narrow shoulders → structure-welcome directive");
}

// ── Shape + bust ─────────────────────────────────────────────────────────────
{
  assert(has(summarizeSilhouette({ proportions: "hourglass" }), /define the waist/),
    "hourglass → waist-definition directive");
  assert(has(summarizeSilhouette({ proportions: "curvy" }), /define the waist/),
    "curvy keys the hourglass directive");
  const pear = summarizeSilhouette({ proportions: "pear, fuller hips" });
  assert(has(pear, /eye up/) && has(pear, /skim the hip/), "pear → eye-up + skim-the-hip directive");
  assert(has(summarizeSilhouette({ proportions: "apple, soft middle" }), /skim, not cling/),
    "apple/midsection → skim-not-cling directive");
  assert(has(summarizeSilhouette({ proportions: "larger bust" }), /open V or scoop necklines/),
    "larger bust → open-neckline directive");
  assert(has(summarizeSilhouette({ fitNotes: "busty" }), /off the top/),
    "bust cue in fitNotes still fires the directive");
}

// ── Passthrough of her own words ─────────────────────────────────────────────
{
  const lines = summarizeSilhouette({ fitNotes: "hates anything itchy, no wool near skin" });
  assert(lines.length === 1 && /^fit notes: hates anything itchy/.test(lines[0]),
    "unmatched fitNotes pass through labeled");
  const both = summarizeSilhouette({ fitNotes: "broad shoulders bother me" });
  assert(has(both, /relaxed shoulder lines/) && has(both, /^fit notes: broad shoulders bother me$/),
    "matched fitNotes fire the directive AND still pass through verbatim");
  assert(summarizeSilhouette({ proportions: "athletic build" }).some(l => l === "proportions: athletic build"),
    "unmatched proportions pass through labeled");
  assert(summarizeSilhouette({ torsoLength: "pretty balanced" }).some(l => l === "torso: pretty balanced"),
    "unmatched torsoLength passes through labeled");
  assert(!has(summarizeSilhouette({ proportions: "narrow shoulders" }), /^proportions:/),
    "cue-consumed proportions do NOT double as a raw line");
}

// ── Context line (age + professional) ────────────────────────────────────────
{
  const lines = summarizeSilhouette({ ageRange: "Late 30s", professionalContext: "finance, client-facing" });
  assert(lines.length === 1 && lines[0] === "context: Late 30s · finance, client-facing",
    `age+work collapse to one context line (got ${JSON.stringify(lines)})`);
  assert(summarizeSilhouette({ ageRange: "40s" })[0] === "context: 40s", "age alone still renders");
  assert(summarizeSilhouette({ professionalContext: "WFH" })[0] === "context: WFH", "work alone still renders");
}

// ── Caps ─────────────────────────────────────────────────────────────────────
{
  const lines = summarizeSilhouette({
    height: "5'2\"",
    torsoLength: "short torso",
    proportions: "broad shoulders, pear, fuller bust",
    fitNotes: "prefers relaxed fits, nothing itchy",
    ageRange: "Late 30s",
    professionalContext: "creative director, client-facing, WFH 3 days a week",
  });
  assert(lines.length <= 6, `everything filled stays ≤6 lines (got ${lines.length})`);
  assert(has(lines, /petite/) && has(lines, /lengthen the torso/) && has(lines, /^fit notes:/),
    "directives and fit notes both survive the cap");
  const long = summarizeSilhouette({ fitNotes: "x".repeat(500) });
  assert(long[0].length <= 130 && long[0].endsWith("…"), "very long free text is clipped with ellipsis");
}

// ── Soft register — nothing the validator could read as a hard rule ──────────
{
  const lines = summarizeSilhouette({
    height: "5'2\"", torsoLength: "long torso", proportions: "broad shoulders, hourglass, fuller bust",
  });
  assert(lines.length > 0 && !lines.some(l => /MUST|NEVER|FORBIDDEN|HARD RULE|BANNED/.test(l)),
    "no hard-rule vocabulary in any directive");
}

// ── No-crash on weird input ──────────────────────────────────────────────────
{
  assert(Array.isArray(summarizeSilhouette({ height: 170, ageRange: 38 })), "numbers don't crash");
  assert(summarizeSilhouette({ height: ["5'2\""], fitNotes: { a: 1 } }).length === 0,
    "arrays/objects coerce to nothing rather than [object Object]");
  assert(summarizeSilhouette("petite").length === 0, "a bare string aboutMe → []");
  assert(Array.isArray(summarizeSilhouette({ height: "9'9\"", torsoLength: 0 })),
    "implausible height + falsy number don't crash");
  assert(!has(summarizeSilhouette({ height: "9'9\"" }), /tall frame/),
    "implausible parsed height is rejected, not read as tall");
  const spaced = summarizeSilhouette({ fitNotes: "  lots   of \n whitespace  " });
  assert(spaced[0] === "fit notes: lots of whitespace", "whitespace collapses in passthrough");
}

console.log(`\nsilhouette: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
