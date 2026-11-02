// ── ONE LOOK, ONE READ ───────────────────────────────────────────────────────
// Owner, 2026-11-02: "I just ran the evaluator on build me with the same
// outfit 3x and it gave me all different options." The 5.5 models take no
// `temperature` (a hard 400), so every tap of Evaluate was a fresh sample of
// the same question — a different score, different swaps, different tips. A
// stylist asked twice about the same outfit gives the same answer; three
// answers read as no opinion at all.
//
// So a read is remembered by WHAT IT READ: the pieces on the canvas, the
// rooms and weather she tagged, the look's origin (Style Me's card or the
// chat's latest word — a new chat turn is new context, so a new read), and the
// closet the swaps came from (a piece added or a closet switched changes what
// a swap can name). The same look asks again → the same card, at no cost and
// no wait. A changed look — an applied swap, a new chip — is a new question.
// "Ask for a fresh read" on the card is the one way to roll again on purpose;
// that read then becomes the look's answer.
//
// What it leaves out of the key on purpose: the learning blocks and the trend
// brief. They change with every chat turn and save, and keying on them would
// make the memory never hit. MAX_AGE_MS bounds how stale a read can get — the
// trend brief refreshes on a ~35-day cycle.
//
// Per device, like every background run (the API key is per device).

const STORAGE_KEY = "atelier:eval-memory";
const MAX_ENTRIES = 40;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// djb2 — short, stable, dependency-free; collisions are harmless here (the
// key also carries the sorted canvas ids in the clear).
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const sorted = (list) => [...new Set((list || []).filter(Boolean).map(String))].sort();

/** The key a read is remembered by. Pure; order-insensitive in every list. */
export function evalFingerprint({ canvasIds = [], occasions = [], weathers = [], origin = null, available = [] } = {}) {
  const originText = origin ? `${origin.source || ""}:${String(origin.text || "").trim()}` : "";
  return [
    sorted(canvasIds).join("|"),
    sorted(occasions).join("+"),
    sorted(weathers).join("+"),
    originText ? hash(originText) : "-",
    hash(sorted((available || []).map(it => it?.id ?? it)).join("|")),
  ].join("#");
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function store(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* quota / private mode: the next tap asks again */ }
}

/** The remembered run result for this fingerprint, or null. */
export function recallEval(fp, now = Date.now()) {
  if (!fp) return null;
  const hit = load()[fp];
  if (!hit || !hit.result || !Number.isFinite(hit.at) || now - hit.at > MAX_AGE_MS) return null;
  return hit.result;
}

/** Remember a run result; keeps the newest MAX_ENTRIES. */
export function rememberEval(fp, result, now = Date.now()) {
  if (!fp || !result) return;
  const map = load();
  map[fp] = { at: now, result };
  const keep = Object.entries(map)
    .filter(([, v]) => v && Number.isFinite(v.at) && now - v.at <= MAX_AGE_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  store(Object.fromEntries(keep));
}
