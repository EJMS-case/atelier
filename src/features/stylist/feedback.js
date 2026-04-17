// ── F2 — LOOK FEEDBACK ───────────────────────────────────────────────────────
// Thin Supabase REST client for per-look thumbs up/down. Writes straight to
// the `look_feedback` table added in migration 0002. Reads aggregate
// per-item scores so the sampler can up/down-weight items that earned signal.

const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
// Anon key — same public key as used elsewhere in App.jsx.
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";
const HEADERS = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

/**
 * Record a thumbs-up / thumbs-down on a generated look.
 * @param {Object} params
 * @param {string}   params.lookHash   - stable hash of (occasion|sorted item IDs)
 * @param {number}   params.rating     - +1 for up, -1 for down
 * @param {string[]} params.itemIds    - item IDs in the look
 * @param {string}   params.occasion
 * @param {string}   [params.mood]
 */
export async function saveLookFeedback({ lookHash, rating, itemIds, occasion, mood }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/look_feedback`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      look_hash: lookHash,
      rating,
      item_ids: itemIds,
      occasion,
      mood: mood || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `feedback save failed ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch aggregate +1 / -1 totals per item id. Returns a map keyed by item id.
 * Heavy down-votes → sampler penalty; heavy up-votes → sampler boost.
 */
export async function fetchItemFeedbackScores() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/look_feedback?select=item_ids,rating`,
    { headers: HEADERS },
  );
  if (!res.ok) return {};
  const rows = await res.json().catch(() => []);
  const scores = {};
  for (const row of rows) {
    const rating = Number(row.rating) || 0;
    for (const id of row.item_ids || []) {
      scores[id] = (scores[id] || 0) + rating;
    }
  }
  return scores;
}

/**
 * Deterministic hash so identical looks collapse. Not crypto — just a quick
 * fingerprint for upsert de-duplication.
 */
export function lookHash({ occasion, itemIds, mood }) {
  const base = `${occasion || ""}|${mood || ""}|${[...(itemIds || [])].sort().join(",")}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (Math.imul(h, 31) + base.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
