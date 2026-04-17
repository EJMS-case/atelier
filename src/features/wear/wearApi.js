// ── F6 — WEAR TRACKING HELPERS ───────────────────────────────────────────────
// Bump wear_count on items referenced by a new outfit_log row, and compute
// cost-per-wear on demand. We do this app-side rather than via a DB trigger
// so the same code path works from every save entry point.

const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";
const H = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

/**
 * Increment wear_count by 1 for each id in the list. Uses PATCH per item —
 * slower but safer than an arbitrary-SQL RPC (no destructive op risk). These
 * calls fire-and-forget; failure never blocks the save.
 */
export async function bumpWearCounts(itemIds = []) {
  await Promise.all((itemIds || []).map(async (id) => {
    try {
      // Fetch current count
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?select=wear_count&id=eq.${id}`,
        { headers: H },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        {
          method: "PATCH",
          headers: { ...H, Prefer: "return=minimal" },
          body: JSON.stringify({ wear_count: current + 1 }),
        },
      );
    } catch (err) {
      console.warn("[F6] bumpWearCount failed for", id, err);
    }
  }));
}

/** Decrement (for unlog). Floored at 0. */
export async function unbumpWearCounts(itemIds = []) {
  await Promise.all((itemIds || []).map(async (id) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?select=wear_count&id=eq.${id}`,
        { headers: H },
      );
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      const current = rows[0]?.wear_count || 0;
      await fetch(
        `${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`,
        {
          method: "PATCH",
          headers: { ...H, Prefer: "return=minimal" },
          body: JSON.stringify({ wear_count: Math.max(0, current - 1) }),
        },
      );
    } catch (err) {
      console.warn("[F6] unbumpWearCount failed for", id, err);
    }
  }));
}

/**
 * Compute cost-per-wear, or null if we don't have enough data.
 */
export function costPerWear(item) {
  const price = Number(item?.price_paid);
  const wears = Number(item?.wear_count) || 0;
  if (!Number.isFinite(price) || price <= 0 || wears <= 0) return null;
  return price / wears;
}

/**
 * "Neglected" = last_worn older than the threshold (60 days) OR null and
 * item is at least 60 days old.
 */
export function neglectedItems(items, thresholdDays = 60) {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return (items || []).filter(it => {
    if (!it.last_worn) {
      // Item never worn — only include if it's been in the closet long enough
      const added = it.created_at ? new Date(it.created_at) : null;
      return added && added <= cutoff;
    }
    return it.last_worn < cutoffIso;
  });
}

/**
 * Top-N most worn items. Ties broken by most-recent last_worn.
 */
export function mostWornItems(items, n = 5) {
  return [...(items || [])]
    .filter(it => (it.wear_count || 0) > 0)
    .sort((a, b) => {
      const delta = (b.wear_count || 0) - (a.wear_count || 0);
      if (delta !== 0) return delta;
      return (b.last_worn || "").localeCompare(a.last_worn || "");
    })
    .slice(0, n);
}
