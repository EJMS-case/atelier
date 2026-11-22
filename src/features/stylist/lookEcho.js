// ── A LOOK THAT ECHOES ONE SHE WORE BEFORE ──────────────────────────────────
// Owner, 2026-11-22: "When I generate looks, is the app ever … reminding me of
// previous outfits when it gives me an outfit result? … I don't want it to
// change the recommendations it gives me … the looks it pulls from previous,
// saved, and/or hearted looks would have to be from over 3-4 weeks ago so I'm
// not being prompted to keep wearing the same things."
//
// Display only. This runs AFTER Style Me has answered, on the look it gave,
// and never reaches a prompt or the sampler, so it cannot change what she is
// shown. It finds the past look (saved, worn or hearted) that shares the most
// garments with the new one, among looks at least four weeks old, and the
// card says so in one line: "Echoes your Work look from Oct 12 ♥ — the camel
// blazer and the black trouser." Finishing pieces (shoes, bags, jewellery)
// don't count: two looks with the same black pump aren't the same look.
//
// Pure; exported for scripts/look-echo.test.mjs.

import { isGarment } from "../../constants/taxonomy.js";

export const ECHO_MIN_AGE_DAYS = 28;

const dayOf = (log) => String(log?.date_worn || log?.created_at || "").slice(0, 10);

/**
 * @param {string[]} lookIds          - the new look's piece ids
 * @param {Object[]} logs             - outfit_logs rows (saved and worn looks)
 * @param {Object}   o
 * @param {Map}      o.byId           - wardrobe id → piece
 * @param {Set}      [o.hearted]      - outfit_logs ids she hearted
 * @param {Date}     [o.now]
 * @returns {{ id, date, occasion, hearted, shared: Object[] } | null}
 */
export function lookEcho(lookIds, logs, { byId, hearted = new Set(), now = new Date(), minAgeDays = ECHO_MIN_AGE_DAYS } = {}) {
  const garments = new Set((lookIds || []).filter(id => {
    const it = byId?.get(id);
    return it && isGarment(it);
  }));
  if (garments.size < 2) return null;
  const cutoff = new Date(now.getTime() - minAgeDays * 86400000).toISOString().slice(0, 10);
  let best = null;
  for (const log of logs || []) {
    const day = dayOf(log);
    if (!day || day > cutoff) continue;
    const ids = Array.isArray(log.garment_ids) ? log.garment_ids : [];
    const shared = [...new Set(ids)].filter(id => garments.has(id));
    // Two garments in common is a resemblance; one is a coincidence.
    if (shared.length < 2) continue;
    const isHearted = hearted.has(log.id);
    const score = shared.length + (isHearted ? 0.5 : 0);
    if (!best || score > best.score || (score === best.score && day > best.date)) {
      best = { id: log.id, date: day, occasion: log.occasion || "", hearted: isHearted, shared, score };
    }
  }
  if (!best) return null;
  return {
    id: best.id, date: best.date, occasion: best.occasion, hearted: best.hearted,
    shared: best.shared.map(id => byId.get(id)).filter(Boolean),
  };
}

/** "Echoes your Work look from Oct 12 ♥ — the Camel Blazer and the Black Trouser." */
export function echoLine(echo) {
  if (!echo) return "";
  const when = new Date(`${echo.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const names = echo.shared.slice(0, 3).map(it => `the ${it.name}`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "";
  return `Echoes your ${echo.occasion ? `${echo.occasion} ` : ""}look from ${when}${echo.hearted ? " ♥" : ""}${list ? ` — ${list}` : ""}.`;
}
