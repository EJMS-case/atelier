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

// Public URL for an item's small grid thumbnail. Thumbs live under a `thumbs/`
// prefix in the same bucket, keyed by item id, so the URL is derivable without
// a DB column. Generated lazily client-side (see components/Thumb.jsx).
//
// `cacheKey` (normally the item's current image URL) is hashed into a query
// param so a replaced photo mints a fresh thumb URL. Without it, the stable
// URL + storage's max-age kept serving hour-old thumb bytes from the browser
// HTTP cache even after the server thumb was regenerated. Steady state is
// unaffected: same image → same hash → cache still works.
export function thumbUrl(itemId, cacheKey) {
  let v = "";
  if (cacheKey) {
    let h = 5381;
    const s = String(cacheKey);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    v = `?v=${(h >>> 0).toString(36)}`;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/thumbs/${itemId}${v}`;
}

// Decode a base64 data URL into a Blob + mime for storage uploads. Shared by
// uploadImage / uploadThumb / uploadInspirationImage (was triplicated inline).
function dataUrlToBlob(base64DataUrl, fallbackMime) {
  const [header, base64] = base64DataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || fallbackMime;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
}

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

  // Cascade cleanup after item delete. Best-effort (never throws) — a partial
  // cleanup is better than blocking the delete. Removes the deleted item ID from
  // every array it appears in across the three tables that reference garment IDs.
  async cascadeItemDelete(id) {
    try {
      // ── outfit_logs.garment_ids ───────────────────────────────────────────
      const logsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/outfit_logs?select=id,garment_ids&garment_ids=cs.{${id}}`,
        { headers: SB_HEADERS },
      );
      if (logsRes.ok) {
        const logs = await logsRes.json().catch(() => []);
        await Promise.all((logs || []).map(log =>
          fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${log.id}`, {
            method: "PATCH",
            headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
            body: JSON.stringify({ garment_ids: (log.garment_ids || []).filter(g => g !== id) }),
          }).catch(() => {}),
        ));
      }
    } catch { /* best-effort */ }

    try {
      // ── planned_outfits.items + outfits jsonb ─────────────────────────────
      const plansRes = await fetch(
        `${SUPABASE_URL}/rest/v1/planned_outfits?select=id,items,outfits&items=cs.{${id}}`,
        { headers: SB_HEADERS },
      );
      if (plansRes.ok) {
        const plans = await plansRes.json().catch(() => []);
        await Promise.all((plans || []).map(plan => {
          const newItems = (plan.items || []).filter(i => i !== id);
          const newOutfits = Array.isArray(plan.outfits)
            ? plan.outfits.map(o => ({ ...o, items: (o.items || []).filter(i => i !== id) }))
            : plan.outfits;
          return fetch(`${SUPABASE_URL}/rest/v1/planned_outfits?id=eq.${plan.id}`, {
            method: "PATCH",
            headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
            body: JSON.stringify({ items: newItems, outfits: newOutfits }),
          }).catch(() => {});
        }));
      }
    } catch { /* best-effort */ }

    try {
      // ── look_feedback.item_ids ────────────────────────────────────────────
      const fbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/look_feedback?select=id,item_ids&item_ids=cs.{${id}}`,
        { headers: SB_HEADERS },
      );
      if (fbRes.ok) {
        const feedbacks = await fbRes.json().catch(() => []);
        await Promise.all((feedbacks || []).map(fb =>
          fetch(`${SUPABASE_URL}/rest/v1/look_feedback?id=eq.${fb.id}`, {
            method: "PATCH",
            headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
            body: JSON.stringify({ item_ids: (fb.item_ids || []).filter(i => i !== id) }),
          }).catch(() => {}),
        ));
      }
    } catch { /* best-effort */ }
  },

  async ensureBucket() {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
    });
  },

  async uploadImage(itemId, base64DataUrl) {
    const { blob, mime } = dataUrlToBlob(base64DataUrl, "image/jpeg");

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${itemId}`, {
          method: "POST",
          headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
          body: blob,
        });
        // Cache-buster: the storage path is stable (same itemId), so without a
        // version query the browser/CDN keeps serving the OLD image after a
        // re-upload (e.g. re-cropping a cutout). A ?v= stamp forces a fresh
        // fetch of the new bytes.
        if (res.ok) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${itemId}?v=${Date.now()}`;
        lastErr = new Error(`Image upload failed (HTTP ${res.status}): ${await res.text()}`);
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  },

  // Upload a small grid thumbnail under `thumbs/<itemId>`. Mirrors uploadImage
  // but to the thumb path. Best-effort: one attempt, returns the public URL.
  async uploadThumb(itemId, base64DataUrl) {
    const { blob, mime } = dataUrlToBlob(base64DataUrl, "image/png");
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/thumbs/${itemId}`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Thumb upload failed (HTTP ${res.status})`);
    return thumbUrl(itemId);
  },

  async removeImage(itemId) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      // Remove the full image AND its derived thumbnail so deletes don't orphan.
      body: JSON.stringify({ prefixes: [itemId, `thumbs/${itemId}`] }),
    });
  },

  // Delete only the derived thumbnail. Called when an item's image URL changes
  // so every device rebuilds the thumb from the new image instead of rendering
  // the one derived from the replaced photo (Thumb.jsx self-heals on the 404).
  async removeThumb(itemId) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...STORAGE_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [`thumbs/${itemId}`] }),
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
  // Set last_worn on many items in ONE request (all get the same date) instead
  // of a PATCH per garment — logging a 6-piece outfit was firing 6 round-trips.
  async setLastWornBulk(ids = [], date) {
    const list = [...new Set(ids)].filter(Boolean);
    if (list.length === 0) return;
    const inList = list.map(encodeURIComponent).join(",");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=in.(${inList})`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
      body: JSON.stringify({ last_worn: date }),
    });
    if (!res.ok) throw new Error("Bulk last_worn update failed");
  },
  // Persist the one-time Visual-AI descriptor for a single item. Best-effort
  // per item so a batch enrichment can continue past one failure.
  async saveItemVision(id, visionData) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
      body: JSON.stringify({ vision_data: visionData }),
    });
    if (!res.ok) throw new Error(`Save vision failed (${res.status})`);
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "api_keys", value: JSON.stringify(settings) }),
      });
      if (!res.ok) console.warn("[sb] saveSettings failed:", res.status);
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "style_fingerprint", value: JSON.stringify(fp) }),
      });
      if (!res.ok) console.warn("[sb] saveStyleFingerprint failed:", res.status);
    } catch { /* swallow — non-fatal, regenerate on demand */ }
  },

  // ── Rotation state (key='rotation_state') ──
  // The stylist's anti-repeat memory ({ looks, counts } — see
  // rotation-tracker.js). localStorage is per-device; syncing through
  // user_settings lets the phone see what the laptop already suggested.
  async getRotationState() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.rotation_state&select=value`, {
        headers: SB_HEADERS,
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
    } catch { return null; }
  },
  async saveRotationState(state) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "rotation_state", value: JSON.stringify(state) }),
      });
      // A silent 4xx here disables cross-device anti-repeat — make it visible.
      if (!res.ok) console.warn("[sb] saveRotationState failed:", res.status);
    } catch { /* swallow — local rotation still works on this device */ }
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
    const { blob, mime } = dataUrlToBlob(base64DataUrl, "image/jpeg");
    const path = `inspiration/${id}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...STORAGE_HEADERS, "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Inspiration upload failed: ${res.status}`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  },

  // ── Planned outfits (calendar) ──
  async fetchPlansBetween(startIso, endIso) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&date=gte.${startIso}&date=lte.${endIso}&order=date.asc`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async fetchAllPlans() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&order=date.asc`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async savePlan(plan) {
    // Self-healing upsert: on PGRST204 ("column not found"), strip the
    // unknown column and retry. Lets newer client code (activity, day_label)
    // remain compatible with Supabase projects that haven't run the latest
    // migration — same pattern as saveOutfitLog.
    let payload = { ...plan, updated_at: new Date().toISOString() };
    for (let attempt = 0; attempt < 15; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/planned_outfits?on_conflict=date`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return res.json();
      let err;
      try { err = await res.json(); } catch { throw new Error(`savePlan failed ${res.status}`); }
      if (err.code === "PGRST204") {
        const match = err.message?.match(/find the '([^']+)' column/);
        if (match?.[1]) { delete payload[match[1]]; continue; }
      }
      throw new Error(err?.message || `savePlan failed ${res.status}`);
    }
    throw new Error("savePlan failed after stripping unknown columns");
  },
  async deletePlan(date) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?date=eq.${date}`,
      { method: "DELETE", headers: SB_HEADERS },
    );
    return res.ok;
  },
  async saveTrip(trip) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(trip),
    });
    if (!res.ok) throw new Error(`saveTrip failed ${res.status}`);
    return res.json();
  },
  async fetchTripsBetween(startIso, endIso) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?start_date=lte.${endIso}&end_date=gte.${startIso}&order=start_date.asc`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async fetchAllTrips() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?order=start_date.asc`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async updateTrip(id, patch) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`updateTrip failed ${res.status}`);
    return res.json();
  },
  async deleteTrip(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
      method: "DELETE", headers: SB_HEADERS,
    });
    return res.ok;
  },

  // ── Look feedback (thumbs up/down on generated looks) ──
  async saveLookFeedback({ lookHash, rating, itemIds, occasion, mood }) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/look_feedback`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation" },
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
  },
  // Returns { itemId: weightedSum } across all look_feedback rows. Positive sums
  // promote items in the cold-item sort; negative sums penalize them so disliked
  // items surface less frequently. Previously fetched only rating > 0 so thumbs-
  // down had no effect — now all ratings contribute. Each rating decays with a
  // 45-day half-life so her CURRENT taste outweighs months-old votes — a ✕ from
  // yesterday matters, a ✕ from last season barely registers.
  async fetchItemFeedbackScores() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/look_feedback?select=item_ids,rating,created_at`,
      { headers: SB_HEADERS },
    );
    if (!res.ok) return {};
    const rows = await res.json().catch(() => []);
    const HALF_LIFE_DAYS = 45;
    const now = Date.now();
    const scores = {};
    for (const row of rows) {
      const rating = Number(row.rating) || 0;
      if (rating === 0) continue;
      const ageDays = row.created_at
        ? Math.max(0, (now - new Date(row.created_at).getTime()) / 86400000)
        : 0;
      const weighted = rating * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      for (const id of row.item_ids || []) {
        scores[id] = (scores[id] || 0) + weighted;
      }
    }
    return scores;
  },

  // Loved looks — every thumbs-up she's given in Style Me, newest first. The
  // Favorites tab renders these directly: the thumbs-up IS her favorite signal
  // (the heart-driven `favorites` table went untouched for weeks while
  // look_feedback accumulated 20+ loves).
  async fetchLovedLooks() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/look_feedback?select=id,item_ids,occasion,created_at&rating=eq.1&order=created_at.desc`,
        { headers: SB_HEADERS },
      );
      if (!res.ok) return [];
      return (await res.json().catch(() => [])) || [];
    } catch { return []; }
  },

  // Un-love from the Favorites tab. Deletes the feedback row outright, which
  // also removes its (decayed) influence on stylist item scores — coherent:
  // the thumbs-up is the favorite, so removing one removes the other.
  async deleteLookFeedback(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/look_feedback?id=eq.${id}`, {
      method: "DELETE",
      headers: SB_HEADERS,
    });
    if (!res.ok) throw new Error("Remove loved look failed");
  },

  // Recent looks she rated with a thumbs down — { item_ids, occasion }. Used to
  // warn the stylist about combinations / items she actively disliked. Capped at
  // 10 most-recent rows so the prompt block stays compact.
  async fetchDislikedLooks() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/look_feedback?select=item_ids,occasion&rating=eq.-1&order=created_at.desc&limit=10`,
        { headers: SB_HEADERS },
      );
      if (!res.ok) return [];
      return (await res.json().catch(() => [])) || [];
    } catch { return []; }
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
