// ── SUPABASE CLIENT ──────────────────────────────────────────────────────────
// Hand-rolled REST client (no @supabase/supabase-js). One public `sb` object
// centralizes every table + storage operation. The anon key is public — row
// policies enforce access on the server side.

export const SUPABASE_URL = "https://ljcwsrfmojbjdveefoqa.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY3dzcmZtb2piamR2ZWVmb3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODM1NDksImV4cCI6MjA5MDA1OTU0OX0.3LLv6JdwOvq_7woz3LUO8wnaoH8lSawiQJqk2Wmk4QE";

export const SB_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Prefer": "return=representation",
};

export const BUCKET = "wardrobe-images";
export const STORAGE_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

export const sb = {
  async fetchAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?select=*&order=created_at.asc`, {
      headers: SB_HEADERS
    });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  },

  // Self-healing upsert: strips unknown columns on PGRST204 and retries. This
  // protects old clients from breaking when a new migration hasn't run yet.
  async upsert(item) {
    const { image, pending_sync, ...rest } = item;
    // `pending_sync` is a UI-only flag for the local cross-device delete-
    // protection path; it must never hit Supabase.
    void pending_sync;
    let payload = image && !image.startsWith("data:") ? { ...rest, image } : { ...rest };
    if (payload.set_id === "") payload.set_id = null;
    // Empty strings reach numeric columns as `""` and PG rejects them.
    if (payload.price_paid === "") payload.price_paid = null;

    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return res.json();

      let err;
      try { err = await res.json(); } catch { throw new Error(`Upsert failed ${res.status}`); }

      if (err.code === "PGRST204") {
        const match = err.message?.match(/find the '([^']+)' column/);
        if (match?.[1]) { delete payload[match[1]]; continue; }
      }
      throw new Error(`Upsert failed: ${err.message || res.status}`);
    }
    throw new Error("Upsert failed after stripping unknown columns");
  },

  async remove(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Delete failed");
  },

  async ensureBucket() {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
  },

  async uploadImage(itemId, base64DataUrl) {
    const [header, base64] = base64DataUrl.split(",");
    const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${itemId}`, {
          method: "POST",
          headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
          body: blob,
        });
        if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${itemId}`;
        lastErr = new Error(`Image upload failed (HTTP ${res.status}): ${await res.text()}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  },

  async removeImage(itemId) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [itemId] }),
    });
  },

  // ── Outfit Logs ──
  // Mirrors the self-healing pattern in `upsert`: on PGRST204 (unknown
  // column, e.g. an older Supabase project that hasn't run the latest
  // migration), strip that column and retry. Saves the caller from having
  // to know which columns exist on which deploy.
  async saveOutfitLog(log) {
    let payload = { ...log };
    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "return=representation" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return res.json();
      let err;
      try { err = await res.json(); } catch { throw new Error(`Save outfit log failed ${res.status}`); }
      if (err.code === "PGRST204") {
        const match = err.message?.match(/find the '([^']+)' column/);
        if (match?.[1]) { delete payload[match[1]]; continue; }
      }
      throw new Error(`Save outfit log failed: ${err.message || res.status}`);
    }
    throw new Error("Save outfit log failed after stripping unknown columns");
  },
  async fetchOutfitLogs() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?select=*&order=date_worn.desc,created_at.desc`, {
      headers: SB_HEADERS,
    });
    if (!res.ok) return [];
    return res.json();
  },
  async deleteOutfitLog(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Delete outfit log failed");
  },
  async updateOutfitLog(id, patch) {
    let payload = { ...patch };
    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...SB_HEADERS, "Prefer": "return=representation" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return res.json();
      let err;
      try { err = await res.json(); } catch { throw new Error(`Update outfit log failed ${res.status}`); }
      if (err.code === "PGRST204") {
        const match = err.message?.match(/find the '([^']+)' column/);
        if (match?.[1]) { delete payload[match[1]]; continue; }
      }
      throw new Error(`Update outfit log failed: ${err.message || res.status}`);
    }
    throw new Error("Update outfit log failed after stripping unknown columns");
  },

  // ── Favorites ──
  async fetchFavorites() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?select=*&order=created_at.desc`, {
      headers: SB_HEADERS,
    });
    if (!res.ok) return [];
    return res.json();
  },
  async addFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({ type, reference_id: referenceId }),
    });
    if (!res.ok) throw new Error("Add favorite failed");
    return res.json();
  },
  async removeFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?type=eq.${type}&reference_id=eq.${referenceId}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Remove favorite failed");
  },
  async updateItemLastWorn(id, date) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({ last_worn: date }),
    });
    if (!res.ok) throw new Error("Update last_worn failed");
  },
  async listStorageImages() {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/wardrobe-images`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 500, offset: 0 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(f => f.name).filter(Boolean);
  },

  // ── User Settings (API key sync) ──
  async getSettings() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.api_keys&select=value`, {
        headers: SB_HEADERS,
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
    } catch { return null; }
  },
  async saveSettings(settings) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "api_keys", value: JSON.stringify(settings) }),
      });
    } catch { /* fallback to localStorage only */ }
  },

  // ── Style Fingerprint (one row per user, key='style_fingerprint') ──
  // Stored as JSON: { text, source_count, generated_at }. Lives in
  // user_settings (which already exists) to avoid a separate migration.
  async getStyleFingerprint() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.style_fingerprint&select=value`, {
        headers: SB_HEADERS,
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
    } catch { return null; }
  },
  async saveStyleFingerprint(fp) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "style_fingerprint", value: JSON.stringify(fp) }),
      });
    } catch { /* swallow — non-fatal, regenerate on demand */ }
  },

  // ── Inspiration images ──
  // Style references the AI uses ONLY as a vibe guide (see prompt wiring).
  // The image bytes live in the same `wardrobe-images` bucket under an
  // `inspiration/` prefix so we don't need a second bucket. The vibe_text is
  // written once on upload by the auto-summarizer.
  async fetchInspirations() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/inspiration_images?select=*&order=created_at.desc`, {
        headers: SB_HEADERS,
      });
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },
  async upsertInspiration(row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspiration_images`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`Upsert inspiration failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  },
  async removeInspiration(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspiration_images?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Delete inspiration failed");
  },
  async uploadInspirationImage(id, base64DataUrl) {
    const [header, base64] = base64DataUrl.split(",");
    const mime = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const path = `inspiration/${id}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Inspiration upload failed: ${res.status}`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  },

  // ── Sets ──
  async fetchSets() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/sets?select=*&order=created_at.desc`, { headers: SB_HEADERS });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },
  async upsertSet(set) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/sets`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(set),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },
  async deleteSet(id) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sets?id=eq.${id}`, { method: "DELETE", headers: SB_HEADERS });
    } catch { /* ignore — table may not exist */ }
  },
};
