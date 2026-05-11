// ── F3 — PLANNED OUTFITS API ─────────────────────────────────────────────────
// Thin Supabase REST client for the `planned_outfits` table.

const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";
const H = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

/** Fetch plans for a date range (inclusive). */
export async function fetchPlansBetween(startIso, endIso) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&date=gte.${startIso}&date=lte.${endIso}&order=date.asc`,
    { headers: H },
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

/** Fetch every plan in the table — used by the style fingerprint, which
 *  intentionally summarizes ALL of the user's planned + worn history. */
export async function fetchAllPlans() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&order=date.asc`,
    { headers: H },
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

/** Upsert (one plan per date). */
export async function savePlan(plan) {
  const payload = { ...plan, updated_at: new Date().toISOString() };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/planned_outfits`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `savePlan failed ${res.status}`);
  }
  return res.json();
}

/** Delete a plan for a date. */
export async function deletePlan(date) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/planned_outfits?date=eq.${date}`,
    { method: "DELETE", headers: H },
  );
  return res.ok;
}
