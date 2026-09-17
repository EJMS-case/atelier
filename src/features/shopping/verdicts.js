// ── HER VERDICTS ON PAST SUGGESTIONS ────────────────────────────────────────
// "I own this" / "Not for me" / "Want it" on each shopping card. Every save
// teaches (CLAUDE.md): the next run drops what she owns or dislikes before it
// reaches the screen (verifyGaps) and the prompt reads what she wants, so the
// list sharpens instead of repeating. user_settings key shopping_verdicts,
// capped. Pure composition exported for the test.

import { sb } from "../../lib/supabase.js";
import { gapKey, canonicalCategory, suggestionFamily } from "./verifyGaps.js";

export const VERDICTS_KEY = "shopping_verdicts";
const LOCAL_KEY = "atelier:shopping-verdicts";
const CAP = 80;

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch { return null; } }
function writeLocal(list) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch { /* private mode */ } }
const cleanList = (list) => (Array.isArray(list) ? list : []).filter(v => v && v.key && v.verdict);

export async function loadVerdicts() {
  const remote = await sb.getSettingJson(VERDICTS_KEY).catch(() => null);
  if (Array.isArray(remote)) { const list = cleanList(remote); writeLocal(list); return list; }
  return cleanList(readLocal() || []);
}

/** Pure: add or replace the verdict for one suggestion. */
export function withVerdict(list, gap, verdict) {
  const key = gapKey(gap);
  const rest = cleanList(list).filter(v => v.key !== key);
  if (!verdict) return rest;
  return [...rest, {
    key, verdict,
    category: canonicalCategory(gap?.category) || String(gap?.category || ""),
    family: suggestionFamily(gap),
    suggestion: String(gap?.suggestion || "").slice(0, 120),
    at: new Date().toISOString(),
  }].slice(-CAP);
}

export async function recordVerdict(gap, verdict) {
  const next = withVerdict(await loadVerdicts(), gap, verdict);
  writeLocal(next);
  sb.saveSettingJson(VERDICTS_KEY, next).catch(() => {});
  return next;
}

// `wants: false` when the funnel already carries her wants (HER SHOPPING
// LIST) and only the rule-outs are needed here.
export function describeVerdicts(list, { wants: includeWants = true } = {}) {
  const v = cleanList(list);
  const wants = includeWants ? v.filter(x => x.verdict === "yes").slice(-8) : [];
  const nos = v.filter(x => x.verdict === "no").slice(-8);
  const owns = v.filter(x => x.verdict === "own").slice(-8);
  const parts = [];
  if (wants.length) parts.push(`She WANTS (from past runs — build on these, don't repeat them verbatim): ${wants.map(x => x.suggestion).join("; ")}.`);
  if (owns.length) parts.push(`She already OWNS, in her words: ${owns.map(x => x.suggestion).join("; ")} — never suggest these again.`);
  if (nos.length) parts.push(`NOT her taste: ${nos.map(x => x.suggestion).join("; ")} — nothing like these.`);
  return parts.length ? `HER VERDICTS ON EARLIER SUGGESTIONS:\n${parts.join("\n")}` : "";
}
