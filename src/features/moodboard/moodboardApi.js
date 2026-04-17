// ── F5 — MOODBOARD API ───────────────────────────────────────────────────────
// CRUD against the moodboards table. Also handles uploading pasted inspo
// images to the existing `wardrobe-images` bucket under a moodboard-prefixed
// key, so moodboards share the same storage path as closet photos.

const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";
const BUCKET = "wardrobe-images";
const H = {
  "Content-Type": "application/json",
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

export async function listMoodboards() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/moodboards?select=*&order=created_at.desc`,
    { headers: H },
  );
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchMoodboard(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/moodboards?select=*&id=eq.${id}`,
    { headers: H },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows[0] || null;
}

export async function upsertMoodboard(board) {
  const payload = { ...board, updated_at: new Date().toISOString() };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/moodboards`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `upsertMoodboard failed ${res.status}`);
  }
  return res.json();
}

export async function deleteMoodboard(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/moodboards?id=eq.${id}`,
    { method: "DELETE", headers: H },
  );
  return res.ok;
}

/**
 * Upload an inspo image (base64 data URL) to the shared bucket and return
 * its public URL.
 */
export async function uploadInspoImage(boardId, base64DataUrl) {
  const [header, b64] = base64DataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });

  const path = `moodboard-${boardId}-${Date.now()}`;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    },
  );
  if (!res.ok) throw new Error(`Inspo upload failed ${res.status}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}
