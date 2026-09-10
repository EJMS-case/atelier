// ── WHAT THE APP HAS LEARNED ABOUT HER ───────────────────────────────────────
// One place that gathers EVERY signal she gives the app and turns it into the
// prompt blocks an advisory surface reads. Owner, 2026-09-10: "The app should
// learn from all discussions within the app, all saves, all outfits, all
// items in my closet, and all conversations in Claude, but hard rules should
// not be set — only preferences."
//
// Until now Style Me read most of these (loved looks, swap lessons, occasion
// memory, the fingerprint, About Me, colour pairs) while the builder chat and
// Evaluate look read three of them, and two things she has SAID were encoded
// nowhere she could see or edit. Now:
//   · STANDING PREFERENCES — "How I wear things": lines she sets herself in
//     Style Profile, seeded from what she has told the app (a blazer is always
//     open; tanks layer under a blazer at Work; …). Stored cross-device in
//     user_settings, key `style_notes`.
//   · CHAT LESSONS — after every stylist-chat turn, a small model distils any
//     preference she expressed ("I would never button a blazer") into a
//     one-line lesson. user_settings key `chat_lessons`, capped, editable in
//     Style Profile. The fingerprint reads them too.
//   · The rest — fingerprint, About Me, colour pairs, loved/disliked looks,
//     swap lessons, occasion memory, what reads current this season — fetched
//     once per session (soft-fail, memoised) and composed the same way for
//     every surface.
//
// Everything here is a PREFERENCE. The blocks say so, and the wording never
// calls a departure a violation: the stylist weighs it and says what it costs.
//
// Pure composition is exported separately from the fetching so tests can feed
// it data (scripts/stylist-standard.test.mjs).

import { z } from "zod";
import { sb } from "../../lib/supabase.js";
import { invokeTool } from "../../lib/ai/toolUse.js";
import { MODEL_FAST } from "../../constants/models.js";
import { STANDING_PREFERENCES } from "../../constants/styling.js";
import { loadAboutMe, loadStylePrefs } from "../../utils/storage.js";
import { resolveItemIds } from "../../utils/item-helpers.js";
import { autoColorPairs } from "../../utils/wardrobe-coverage.js";
import { summarizeSilhouette } from "./silhouette.js";
import { summarizeLookEdits } from "./lookEdits.js";
import { summarizeOccasionMemory } from "./occasionMemory.js";

export const STYLE_NOTES_KEY = "style_notes";
export const CHAT_LESSONS_KEY = "chat_lessons";
const LESSONS_CAP = 80;
const LOCAL_NOTES_KEY = "atelier:style-notes:v1";
const LOCAL_LESSONS_KEY = "atelier:chat-lessons:v1";

// ── Date / season ────────────────────────────────────────────────────────────
// The weather bands say how hot it is, not WHEN it is. July and October can
// share a "Warm" band yet call for different fabrics (linen and raffia vs
// suede and light wool). One line of calendar truth, shared by Style Me and
// the advisory surfaces.
const SEASON_BY_MONTH = [
  "deep winter", "late winter", "early spring", "mid spring", "late spring",
  "early summer", "high summer", "high summer", "early fall", "mid fall",
  "late fall", "early winter",
];
export function describeDateContext(now = new Date()) {
  const monthPhase = now.getDate() <= 10 ? "early" : now.getDate() <= 20 ? "mid" : "late";
  return `${monthPhase} ${now.toLocaleDateString("en-US", { month: "long" })} — ${SEASON_BY_MONTH[now.getMonth()]} in NYC`;
}

// ── Look lines ───────────────────────────────────────────────────────────────
// "[Work] navy Blouses + burgundy Trousers + black Heels" — the text-only
// exemplar format Style Me uses for loved / disliked looks. No ids, so a
// history line can never pollute item selection. Resolves against the
// WARDROBE (records, not offers): a past look can hold a piece from the other
// closet. Null below two pieces — a one-piece line teaches nothing.
export function describeLookLine(wardrobe, ids, occasion) {
  const pieces = resolveItemIds(wardrobe || [], ids || [])
    .slice(0, 8)
    .map(it => `${it.color || it.color_family || ""} ${it.subcategory || it.category}`.trim().replace(/\s+/g, " "));
  if (pieces.length < 2) return null;
  return `${occasion ? `[${occasion}] ` : ""}${pieces.join(" + ")}`;
}

// ── Standing preferences + chat lessons (cross-device, soft-fail) ────────────

function readLocal(key) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : null; }
  catch { return null; }
}
function writeLocal(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode */ }
}
const cleanList = (list) => (Array.isArray(list) ? list : [])
  .map(x => (typeof x === "string" ? x : x?.lesson || "")).map(s => s.trim()).filter(Boolean);

// Supabase first (the truth), the device cache second, the seeds last. A
// stored EMPTY list is respected — she may have deleted every seed.
export async function loadStandingPreferences() {
  const remote = await sb.getSettingJson(STYLE_NOTES_KEY).catch(() => null);
  if (Array.isArray(remote)) { writeLocal(LOCAL_NOTES_KEY, remote); return cleanList(remote); }
  const local = readLocal(LOCAL_NOTES_KEY);
  return cleanList(local || STANDING_PREFERENCES);
}
export async function saveStandingPreferences(list) {
  const clean = cleanList(list);
  writeLocal(LOCAL_NOTES_KEY, clean);
  invalidateLearning();
  return sb.saveSettingJson(STYLE_NOTES_KEY, clean);
}
export async function loadChatLessons() {
  const remote = await sb.getSettingJson(CHAT_LESSONS_KEY).catch(() => null);
  if (Array.isArray(remote)) { writeLocal(LOCAL_LESSONS_KEY, remote); return cleanList(remote); }
  return cleanList(readLocal(LOCAL_LESSONS_KEY) || []);
}
export async function saveChatLessons(list) {
  const clean = cleanList(list).slice(-LESSONS_CAP);
  writeLocal(LOCAL_LESSONS_KEY, clean);
  invalidateLearning();
  return sb.saveSettingJson(CHAT_LESSONS_KEY, clean);
}

// Newest last; near-duplicates (same text ignoring case/punctuation) collapse
// onto the existing line so a repeated "blazer open" never stacks. Pure.
export function mergeLessons(existing, incoming, { cap = LESSONS_CAP } = {}) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const out = cleanList(existing);
  const seen = new Set(out.map(norm));
  for (const line of cleanList(incoming)) {
    const k = norm(line);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  return out.slice(-cap);
}

// ── Lesson extraction from a chat turn ───────────────────────────────────────
const LessonsSchema = z.object({ lessons: z.array(z.string()).max(3) });
const LessonsTool = {
  name: "return_lessons",
  description: "Return the standing preferences the client expressed in this exchange, if any.",
  input_schema: {
    type: "object",
    required: ["lessons"],
    properties: {
      lessons: {
        type: "array", maxItems: 3,
        items: { type: "string", description: "One standing preference, ≤22 words, written TO her in the second person ('You never button a blazer'). Only what SHE said or clearly corrected — never the stylist's own advice." },
      },
    },
  },
};

/**
 * Distil one chat exchange into 0–3 standing preferences. Returns the merged,
 * saved lesson list (or the existing one when nothing new was said). Never
 * throws — a missed lesson costs nothing; a broken chat would.
 */
export async function recordChatLessons({ userText, assistantText, apiKey }) {
  const existing = await loadChatLessons().catch(() => []);
  if (!apiKey || !userText || userText.trim().length < 12) return existing;
  try {
    const { lessons } = await invokeTool({
      apiKey,
      model: MODEL_FAST,
      maxTokens: 300,
      content: `A client is talking to her personal stylist while she builds an outfit. Extract ONLY standing preferences SHE expressed about how she dresses — things that should shape every future look ("I would never button a blazer", "I don't wear heels to the office", "I love a belt over a knit"). A question, a one-off request for today, or the stylist's own advice is NOT a preference. Return an empty list when there is none — most turns have none.\n\nSHE SAID:\n${userText.slice(0, 1500)}\n\nTHE STYLIST REPLIED (context only — never a source of preferences):\n${assistantText.slice(0, 800)}`,
      tool: LessonsTool,
      schema: LessonsSchema,
      kind: "chat_lessons",
    });
    if (!lessons?.length) return existing;
    const merged = mergeLessons(existing, lessons);
    if (merged.length !== existing.length) await saveChatLessons(merged);
    return merged;
  } catch {
    return existing;
  }
}

// ── Composition (pure) ───────────────────────────────────────────────────────

/**
 * Turn gathered signals into prompt blocks. Every block is framed as what she
 * has shown or said — preferences to weigh, never rules to enforce.
 */
export function composeLearnedBlocks({
  fingerprint = "", standing = [], lessons = [], silhouette = [],
  manualPairs = [], autoPairs = [], prefs = {},
  lovedLines = [], dislikedLines = [], swapLessons = [], occasionMemory = [],
  dateContext = "", maxLessons = 20,
} = {}) {
  const blocks = [];
  if (fingerprint) {
    blocks.push(`HER STYLE FINGERPRINT (the app's read of what she actually wears — written to her, so "you" means Elyce; judge against her taste, not a generic one):\n${fingerprint}`);
  }
  if (standing.length) {
    blocks.push(`HOW SHE WEARS THINGS (standing preferences she set herself — written to her; honor them the way you'd honor a client's own words, and when a look departs from one, say so and say whether the departure earns its place):\n${standing.map(l => `• ${l}`).join("\n")}`);
  }
  const recentLessons = lessons.slice(-maxLessons);
  if (recentLessons.length) {
    blocks.push(`WHAT SHE HAS TOLD HER STYLIST IN CONVERSATION (distilled from her chats, newest last — the freshest read on her taste):\n${recentLessons.map(l => `• ${l}`).join("\n")}`);
  }
  if (Array.isArray(silhouette) && silhouette.length) {
    blocks.push(`HER BODY & FIT (dress to flatter):\n${silhouette.join("\n")}`);
  }
  const pairLabels = [...manualPairs, ...autoPairs.map(p => (typeof p === "string" ? p : p.label))];
  if (pairLabels.length) {
    const autoNotes = autoPairs.filter(p => p && typeof p === "object" && p.note).map(p => `${p.label} — ${p.note}`);
    blocks.push(`HER COLOR PAIRINGS (hand-picked favorites${autoPairs.length ? " + in-fashion pairs her closet supports this season" : ""} — neutrals ground any pair; reaching for a pair's partner is a signature move, and a neutral look that could easily take one is fair game to push): ${pairLabels.join(", ")}${autoNotes.length ? `\nWhy the in-fashion ones read current:\n${autoNotes.map(n => `• ${n}`).join("\n")}` : ""}`);
  }
  const modes = [];
  if (prefs?.direction) modes.push(`Her overall direction: ${prefs.direction}.`);
  if (prefs?.monochromaticMode) modes.push("She reaches for monochrome — head-to-toe in one family with texture doing the work.");
  if (prefs?.tonalPairing) modes.push("She reaches for tonal layering — shades within one family (navy + powder blue, burgundy + blush).");
  if (modes.length) blocks.push(`HER STYLE MODES (set by her in Style Profile):\n${modes.join("\n")}`);
  if (lovedLines.length) {
    blocks.push(`LOOKS SHE LOVED (newest first — the bar for polish and finish; don't copy them, match their ambition):\n${lovedLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (dislikedLines.length) {
    blocks.push(`COMBINATIONS SHE RATED DOWN (don't recreate these pairings):\n${dislikedLines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (swapLessons.length) {
    blocks.push(`HER EDITS TO SUGGESTED LOOKS (swap = what she took OUT → what she chose INSTEAD; ×N = the same correction N times — a repeated one is a settled preference, a single one is a data point):\n${swapLessons.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  }
  if (occasionMemory.length) {
    blocks.push(`WHAT SHE RETURNS TO, PER OCCASION:\n${occasionMemory.map(l => `• ${l}`).join("\n")}`);
  }
  if (dateContext) {
    blocks.push(`TODAY: ${dateContext}. Beyond the temperature band, what reads current is what reads right for this moment of the year — fabrics, colour depth, the weight of the shoe.`);
  }
  return { blocks, pairs: pairLabels };
}

// ── Gathering (memoised per session, soft-fail) ─────────────────────────────

let cache = null; // { at, key, value }
const TTL_MS = 10 * 60 * 1000;
export function invalidateLearning() { cache = null; }

/**
 * Everything the app has learned, as prompt blocks — for the builder chat,
 * Evaluate look, and the trip-day generator. Style Me gets most of these from
 * App's state already; it reads the standing preferences and chat lessons
 * through standingAndLessons() below.
 *
 * @param {Object}   opts
 * @param {Object[]} opts.wardrobe    - everything she owns (resolves history)
 * @param {Object[]} opts.available   - what she may pick from (auto pairs)
 * @param {number}   [opts.fingerprintMax]
 * @param {number}   [opts.maxAutoPairs]
 */
export async function learnedContext({ wardrobe = [], available = [], fingerprintMax = 1200, maxAutoPairs = 3 } = {}) {
  const key = `${fingerprintMax}|${maxAutoPairs}|${(available || []).length}|${(wardrobe || []).length}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.value;

  const safe = (p) => p.catch(() => null);
  const [fp, standing, lessons, favs, logs, lovedFb, disliked, edits] = await Promise.all([
    safe(sb.fingerprintTextCached(fingerprintMax)),
    safe(loadStandingPreferences()),
    safe(loadChatLessons()),
    safe(sb.fetchFavorites()),
    safe(sb.fetchOutfitLogs()),
    safe(sb.fetchLovedLooks()),
    safe(sb.fetchDislikedLooks()),
    safe(sb.fetchLookEdits()),
  ]);
  const resolveAgainst = (wardrobe && wardrobe.length) ? wardrobe : available;

  // Loved looks = hearted outfit_logs (same derivation App makes for Style Me).
  const lovedIds = new Set((favs || []).filter(f => f.type === "outfit").map(f => f.reference_id));
  const lovedLines = (logs || [])
    .filter(l => lovedIds.has(l.id) && (l.garment_ids || []).length >= 2)
    .slice(0, 5)
    .map(l => describeLookLine(resolveAgainst, l.garment_ids, l.occasion))
    .filter(Boolean);
  const dislikedLines = (disliked || [])
    .slice(0, 5)
    .map(r => describeLookLine(resolveAgainst, r.item_ids || r.garment_ids, r.occasion))
    .filter(Boolean);
  const swapLessons = summarizeLookEdits(edits || [], resolveAgainst);
  const occasionMemory = summarizeOccasionMemory({ logs: logs || [], lovedLooks: lovedFb || [], items: resolveAgainst });

  const prefs = loadStylePrefs();
  const manualPairs = prefs?.colorPairs || [];
  const autoPairs = (available || []).length
    ? autoColorPairs(available, { exclude: manualPairs, max: maxAutoPairs })
    : [];

  const value = composeLearnedBlocks({
    fingerprint: fp || "",
    standing: standing || [],
    lessons: lessons || [],
    silhouette: summarizeSilhouette(loadAboutMe()),
    manualPairs, autoPairs, prefs,
    lovedLines, dislikedLines, swapLessons, occasionMemory,
    dateContext: describeDateContext(),
  });
  value.standing = standing || [];
  value.lessons = lessons || [];
  cache = { at: Date.now(), key, value };
  return value;
}

// The two signals Style Me did NOT already receive from App. Memoised on the
// same cache-invalidation as above.
let standingCache = null;
export async function standingAndLessons() {
  if (standingCache && Date.now() - standingCache.at < TTL_MS) return standingCache.value;
  const [standing, lessons] = await Promise.all([
    loadStandingPreferences().catch(() => []),
    loadChatLessons().catch(() => []),
  ]);
  const value = { standing, lessons };
  standingCache = { at: Date.now(), value };
  return value;
}
const _invalidate = invalidateLearning;
export function invalidateAllLearning() { _invalidate(); standingCache = null; }
