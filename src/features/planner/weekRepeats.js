// ── NOT THE SAME PIECES TWICE IN ONE WEEK ───────────────────────────────────
// Owner, 2026-11-22: "when I choose a day from the planner and try to generate
// a look from there specifically, it's important that the planner doesn't show
// me items I already wore that week. This excludes items I plan on wearing
// later in the week."
//
// The week is Monday to Sunday. A day's Generate leaves out the garments on
// the days BEFORE it in that week (worn, or planned for earlier days), and
// never looks at the days after it: a look planned for Friday does not stop
// Wednesday from using its pieces.
//
// Garments only, and not outerwear: a coat, the shoes, the bag and the
// jewellery are meant to come back all week. And it can never empty a shelf:
// if leaving the week's pieces out would take every piece of a category the
// pool had (her only black trousers in a small closet), that category keeps
// them. A preference held by the pool, not a rule that refuses a look.
//
// Pure; exported for scripts/week-repeats.test.mjs.

import { flattenPlanItemIds } from "./outfits.js";
import { isGarment } from "../../constants/taxonomy.js";

/** The Monday of the week an iso date falls in. */
export function weekStartIso(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;   // Mon 0 … Sun 6
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Every piece on the days of `iso`'s week that come before it. */
export function earlierThisWeekIds(plansByIso, iso) {
  const start = weekStartIso(iso);
  const out = new Set();
  for (const [day, plan] of Object.entries(plansByIso || {})) {
    if (day >= start && day < iso) for (const id of flattenPlanItemIds(plan)) out.add(id);
  }
  return out;
}

const repeatsMatter = (it) => isGarment(it) && it.category !== "Outerwear";

/** The pool without this week's earlier garments; a category never empties. */
export function withoutWeekRepeats(pool, earlierIds) {
  const ids = earlierIds instanceof Set ? earlierIds : new Set(earlierIds || []);
  if (!ids.size) return pool || [];
  const drop = (it) => ids.has(it.id) && repeatsMatter(it);
  const kept = (pool || []).filter(it => !drop(it));
  const had = new Set((pool || []).map(it => it.category));
  const left = new Set(kept.map(it => it.category));
  const emptied = [...had].filter(c => !left.has(c));
  if (!emptied.length) return kept;
  return (pool || []).filter(it => !drop(it) || emptied.includes(it.category));
}
