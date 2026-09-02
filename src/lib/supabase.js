// ── SUPABASE CLIENT ──────────────────────────────────────────────────────────
// Hand-rolled REST client for data (no @supabase/supabase-js here — that is
// used in auth.js for the token lifecycle only). One public `sb` object
// centralizes every table + storage operation.
//
// Headers are built PER REQUEST, not once at module load. A module-level
// constant captures whatever token existed at import time — i.e. none — and can
// never carry a session that arrives after sign-in. Every call site must use
// sbHeaders()/storageHeaders(), never a hoisted copy of the result.

import { getAccessToken } from "./auth.js";
import { SUPABASE_URL, SUPABASE_KEY, BUCKET } from "./supabaseConfig.js";
import { selfHealingWrite } from "./selfHealingWrite.js";

export { SUPABASE_URL, SUPABASE_KEY, BUCKET };

// `apikey` still identifies the project and is always the anon key.
// `Authorization` carries the user's session when signed in, and falls back to
// the anon key when signed out — so a signed-out client behaves exactly as it
// did before login existed. That fallback is what makes the rollout safe while
// table policies are still open; it becomes a no-op once they are closed.
export function sbHeaders(extra) {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${token || SUPABASE_KEY}`,
    "Prefer": "return=representation",
    ...extra,
  };
}

export function storageHeaders(extra) {
  const token = getAccessToken();
  return {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${token || SUPABASE_KEY}`,
    ...extra,
  };
}

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
      headers: sbHeaders()
    });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  },

  // Writes through selfHealingWrite: a column the live project has not been
  // migrated to yet is stripped and the row saves without it. The `""` → null
  // normalizations below are upsert's own — PG rejects an empty string in a
  // numeric or uuid column, and no amount of retrying fixes that.
  async upsert(item) {
    const { image, pending_sync, ...rest } = item;
    // `pending_sync` is a UI-only flag for the local cross-device delete-
    // protection path; it must never hit Supabase.
    void pending_sync;
    const payload = image && !image.startsWith("data:") ? { ...rest, image } : { ...rest };
    if (payload.set_id === "") payload.set_id = null;
    // Empty strings reach numeric columns as `""` and PG rejects them.
    if (payload.price_paid === "") payload.price_paid = null;
    // Same for the uuid closet_id column (multi-closet, Phase A).
    if (payload.closet_id === "") payload.closet_id = null;

    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/wardrobe_items`,
      headers: () => ({ ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" }),
      body: payload,
      label: "Upsert",
    });
  },

  // ── Closets (multi-closet, Phase A) ──
  // Full read of the small `closets` table (two seeded rows + any future
  // additions). Callers cache the result (see utils/storage.js loadClosets).
  async fetchClosets() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/closets?select=*&order=created_at.asc`, {
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error("Fetch closets failed");
    return res.json();
  },

  async remove(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(),
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
        { headers: sbHeaders() },
      );
      if (logsRes.ok) {
        const logs = await logsRes.json().catch(() => []);
        await Promise.all((logs || []).map(log =>
          fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${log.id}`, {
            method: "PATCH",
            headers: { ...sbHeaders(), "Prefer": "return=minimal" },
            body: JSON.stringify({ garment_ids: (log.garment_ids || []).filter(g => g !== id) }),
          }).catch(() => {}),
        ));
      }
    } catch { /* best-effort */ }

    try {
      // ── planned_outfits.items + outfits jsonb ─────────────────────────────
      const plansRes = await fetch(
        `${SUPABASE_URL}/rest/v1/planned_outfits?select=id,items,outfits&items=cs.{${id}}`,
        { headers: sbHeaders() },
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
            headers: { ...sbHeaders(), "Prefer": "return=minimal" },
            body: JSON.stringify({ items: newItems, outfits: newOutfits }),
          }).catch(() => {});
        }));
      }
    } catch { /* best-effort */ }

    try {
      // ── look_feedback.item_ids ────────────────────────────────────────────
      const fbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/look_feedback?select=id,item_ids&item_ids=cs.{${id}}`,
        { headers: sbHeaders() },
      );
      if (fbRes.ok) {
        const feedbacks = await fbRes.json().catch(() => []);
        await Promise.all((feedbacks || []).map(fb =>
          fetch(`${SUPABASE_URL}/rest/v1/look_feedback?id=eq.${fb.id}`, {
            method: "PATCH",
            headers: { ...sbHeaders(), "Prefer": "return=minimal" },
            body: JSON.stringify({ item_ids: (fb.item_ids || []).filter(i => i !== id) }),
          }).catch(() => {}),
        ));
      }
    } catch { /* best-effort */ }
  },

  async ensureBucket() {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
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
          headers: { ...storageHeaders(), "Content-Type": mime, "x-upsert": "true" },
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
      headers: { ...storageHeaders(), "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Thumb upload failed (HTTP ${res.status})`);
    return thumbUrl(itemId);
  },

  // Server-side copy of an item's full image to a new object key (closet
  // duplication). The twin must own its own bytes — deleting the original
  // later calls removeImage(originalId), which would otherwise blank the
  // twin's photo too. Thumbs are NOT copied: Thumb.jsx derives one lazily
  // for the new id. Returns the copy's public URL (same ?v= cache-buster
  // convention as uploadImage).
  async copyImage(fromId, toId) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ bucketId: BUCKET, sourceKey: String(fromId), destinationKey: String(toId) }),
    });
    if (!res.ok) throw new Error(`Image copy failed (HTTP ${res.status})`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${toId}?v=${Date.now()}`;
  },

  async removeImage(itemId) {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
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
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [`thumbs/${itemId}`] }),
    });
  },

  // ── Outfit Logs ──
  // Self-healing like `upsert`, so a caller never has to know which columns
  // exist on which deploy.
  async saveOutfitLog(log) {
    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/outfit_logs`,
      headers: () => ({ ...sbHeaders(), "Prefer": "return=representation" }),
      body: log,
      label: "Save outfit log",
    });
  },
  async fetchOutfitLogs() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?select=*&order=date_worn.desc,created_at.desc`, {
      headers: sbHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },
  async deleteOutfitLog(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error("Delete outfit log failed");
  },
  async updateOutfitLog(id, patch) {
    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/outfit_logs?id=eq.${id}`,
      method: "PATCH",
      headers: () => ({ ...sbHeaders(), "Prefer": "return=representation" }),
      body: patch,
      label: "Update outfit log",
    });
  },

  // ── Favorites ──
  async fetchFavorites() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?select=*&order=created_at.desc`, {
      headers: sbHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },
  async addFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites`, {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "return=representation" },
      body: JSON.stringify({ type, reference_id: referenceId }),
    });
    if (!res.ok) throw new Error("Add favorite failed");
    return res.json();
  },
  async removeFavorite(type, referenceId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/favorites?type=eq.${type}&reference_id=eq.${referenceId}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error("Remove favorite failed");
  },
  // Set last_worn on many items in ONE request (all get the same date) instead
  // of a PATCH per garment — logging a 6-piece outfit was firing 6 round-trips.
  // (The per-item updateItemLastWorn this replaced is deleted — zero callers.)
  async setLastWornBulk(ids = [], date) {
    const list = [...new Set(ids)].filter(Boolean);
    if (list.length === 0) return;
    const inList = list.map(encodeURIComponent).join(",");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=in.(${inList})`, {
      method: "PATCH",
      headers: { ...sbHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({ last_worn: date }),
    });
    if (!res.ok) throw new Error("Bulk last_worn update failed");
  },
  // Move many items to a closet in ONE request — same id=in.(…) bulk-PATCH
  // pattern as setLastWornBulk (multi-closet, Phase A).
  async setClosetBulk(ids = [], closetId) {
    const list = [...new Set(ids)].filter(Boolean);
    if (list.length === 0) return;
    const inList = list.map(encodeURIComponent).join(",");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=in.(${inList})`, {
      method: "PATCH",
      headers: { ...sbHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({ closet_id: closetId }),
    });
    if (!res.ok) throw new Error("Bulk closet move failed");
  },
  // Persist the one-time Visual-AI descriptor for a single item. Best-effort
  // per item so a batch enrichment can continue past one failure.
  async saveItemVision(id, visionData) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wardrobe_items?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(), "Prefer": "return=minimal" },
      body: JSON.stringify({ vision_data: visionData }),
    });
    if (!res.ok) throw new Error(`Save vision failed (${res.status})`);
  },
  async listStorageImages() {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/wardrobe-images`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 500, offset: 0 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(f => f.name).filter(Boolean);
  },

  // ── User Settings ──
  // API keys are deliberately NOT synced here. This table is reachable with the
  // anon key, which ships in the client bundle, so anything stored in it is
  // readable by anyone. Keys live in localStorage only, per device. Migration
  // 0026 enforces this server-side by hiding the `api_keys` row from the
  // `public` role.
  //
  // Mount-time batch: App reads style_fingerprint and
  // rotation_state at startup — separate GETs against the same table.
  // The first getter call kicks off ONE key=in.(…) fetch; each key is served
  // from it exactly once, then falls back to its per-key fetch so refresh
  // flows (Settings button, post-save re-reads) always hit the network.
  _settingsBatch: null,
  _batchServed: new Set(),
  _settingsRow(key) {
    if (this._batchServed.has(key)) return null;
    this._batchServed.add(key);
    if (!this._settingsBatch) {
      this._settingsBatch = (async () => {
        try {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=in.(style_fingerprint,rotation_state,brand_discovery)&select=key,value`, {
            headers: sbHeaders(),
          });
          if (!res.ok) return null;
          const rows = await res.json();
          const map = {};
          for (const r of rows || []) map[r.key] = r.value ?? null;
          return map;
        } catch { return null; }
      })();
    }
    // null map (fetch failed) → caller falls through to its own fetch.
    return this._settingsBatch.then(map => (map ? { raw: map[key] ?? null } : null));
  },
  // ── Style Fingerprint (one row per user, key='style_fingerprint') ──
  // Stored as JSON: { text, source_count, generated_at }. Lives in
  // user_settings (which already exists) to avoid a separate migration.
  //
  // fingerprintTextCached: session-memoized text for on-demand prompt callers
  // (evaluateLook, generateTripDayLook) — ONE GET per session, soft-fails to
  // "" so those features work without a fingerprint or offline-from-Supabase.
  _fpTextPromise: null,
  fingerprintTextCached(maxLen = 1200) {
    if (!this._fpTextPromise) {
      this._fpTextPromise = this.getStyleFingerprint()
        .then(fp => String(fp?.text || ""))
        .catch(() => "");
    }
    return this._fpTextPromise.then(t => t.slice(0, maxLen));
  },
  // In-flight sharing only (cleared once settled) — concurrent mount-time
  // callers (App's initial load effect + maybeRefreshFingerprint) used to
  // fire two identical GETs. NOT a result cache: Settings' refresh button
  // and post-save re-reads still hit the network.
  _fpInflight: null,
  getStyleFingerprint() {
    if (this._fpInflight) return this._fpInflight;
    const p = (async () => {
      try {
        const hit = await this._settingsRow("style_fingerprint");
        if (hit) return hit.raw ? JSON.parse(hit.raw) : null;
        const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.style_fingerprint&select=value`, {
          headers: sbHeaders(),
        });
        if (!res.ok) return null;
        const rows = await res.json();
        return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
      } catch { return null; }
    })();
    this._fpInflight = p;
    p.finally(() => { if (this._fpInflight === p) this._fpInflight = null; });
    return p;
  },
  async saveStyleFingerprint(fp) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "style_fingerprint", value: JSON.stringify(fp) }),
      });
      if (!res.ok) console.warn("[sb] saveStyleFingerprint failed:", res.status);
    } catch { /* swallow — non-fatal, regenerate on demand */ }
  },

  // ── Brand discovery (key='brand_discovery') ──
  // Cached Brand Atlas result: { brands, generated_at, web, dismissed }.
  // Cross-device on purpose — a scouting run is a real AI spend; every device
  // should reuse it. Mount read rides the settings batch above.
  async getBrandDiscovery() {
    try {
      const hit = await this._settingsRow("brand_discovery");
      if (hit) return hit.raw ? JSON.parse(hit.raw) : null;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.brand_discovery&select=value`, {
        headers: sbHeaders(),
      });
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0]?.value ? JSON.parse(rows[0].value) : null;
    } catch { return null; }
  },
  async saveBrandDiscovery(data) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
        method: "POST",
        headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: "brand_discovery", value: JSON.stringify(data) }),
      });
      if (!res.ok) console.warn("[sb] saveBrandDiscovery failed:", res.status);
    } catch { /* swallow — the in-memory copy still renders this session */ }
  },

  // ── Rotation state (key='rotation_state') ──
  // The stylist's anti-repeat memory ({ looks, counts } — see
  // rotation-tracker.js). localStorage is per-device; syncing through
  // user_settings lets the phone see what the laptop already suggested.
  async getRotationState() {
    try {
      const hit = await this._settingsRow("rotation_state");
      if (hit) return hit.raw ? JSON.parse(hit.raw) : null;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?key=eq.rotation_state&select=value`, {
        headers: sbHeaders(),
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
        headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
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
        headers: sbHeaders(),
      });
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },
  async upsertInspiration(row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspiration_images`, {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`Upsert inspiration failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data[0] : data;
  },
  async removeInspiration(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/inspiration_images?id=eq.${id}`, {
      method: "DELETE",
      headers: sbHeaders(),
    });
    if (!res.ok) throw new Error("Delete inspiration failed");
  },
  async uploadInspirationImage(id, base64DataUrl) {
    const { blob, mime } = dataUrlToBlob(base64DataUrl, "image/jpeg");
    const path = `inspiration/${id}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: { ...storageHeaders(), "Content-Type": mime, "x-upsert": "true" },
      body: blob,
    });
    if (!res.ok) throw new Error(`Inspiration upload failed: ${res.status}`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  },

  // ── Planned outfits (calendar) ──
  async fetchPlansBetween(startIso, endIso) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&date=gte.${startIso}&date=lte.${endIso}&order=date.asc`,
      { headers: sbHeaders() },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async fetchAllPlans() {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?select=*&order=date.asc`,
      { headers: sbHeaders() },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async savePlan(plan) {
    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/planned_outfits?on_conflict=date`,
      headers: () => ({ ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" }),
      body: { ...plan, updated_at: new Date().toISOString() },
      label: "savePlan",
      preferServerMessage: true,
    });
  },
  async deletePlan(date) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/planned_outfits?date=eq.${date}`,
      { method: "DELETE", headers: sbHeaders() },
    );
    return res.ok;
  },
  // Trips carry the Phase B columns (destination_closet_id, destination_city,
  // status) when the caller provides them. Self-healing, so the base trip row
  // still saves against a project that lacks one of them.
  async saveTrip(trip) {
    const payload = { ...trip };
    // Empty string reaches the uuid destination_closet_id column and PG
    // rejects it — same normalization as `upsert`'s closet_id.
    if (payload.destination_closet_id === "") payload.destination_closet_id = null;
    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/trips`,
      headers: () => ({ ...sbHeaders(), "Prefer": "return=representation" }),
      body: payload,
      label: "saveTrip",
      preferServerMessage: true,
    });
  },
  async fetchTripsBetween(startIso, endIso) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trips?start_date=lte.${endIso}&end_date=gte.${startIso}&order=start_date.asc`,
      { headers: sbHeaders() },
    );
    if (!res.ok) return [];
    return res.json().catch(() => []);
  },
  async updateTrip(id, patch) {
    const payload = { ...patch };
    if (payload.destination_closet_id === "") payload.destination_closet_id = null;
    return selfHealingWrite({
      url: `${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`,
      method: "PATCH",
      headers: () => ({ ...sbHeaders(), "Prefer": "return=representation" }),
      body: payload,
      label: "updateTrip",
      preferServerMessage: true,
    });
  },
  async deleteTrip(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trips?id=eq.${id}`, {
      method: "DELETE", headers: sbHeaders(),
    });
    return res.ok;
  },

  // ── Trip items (Phase B — trips + packing) ──
  // The single ACTIVE trip, if any. Pool resolution (useVisibleWardrobe.js)
  // keys off this row; soft-fails to null so the app boots closet-scoped when
  // offline or on a pre-migration project.
  // Soft-fails to null by default (App's mount fetch). Pass {strict: true}
  // where "couldn't read" must NOT be mistaken for "no active trip" — the
  // only-one-active-trip guard in Start Trip fails closed on it.
  async fetchActiveTrip({ strict = false } = {}) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/trips?status=eq.active&order=start_date.desc&limit=1`,
        { headers: sbHeaders() },
      );
      if (!res.ok) throw new Error("Fetch active trip failed");
      const rows = await res.json();
      return (Array.isArray(rows) && rows[0]) || null;
    } catch (e) {
      if (strict) throw e;
      return null;
    }
  },
  // outfit_ids-only refresh for an EXISTING trip_items row. A PATCH (not an
  // upsert) so a status change racing in from the packing checklist is never
  // clobbered back by a reconcile.
  async updateTripItemOutfits(tripId, itemId, outfitIds) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trip_items?trip_id=eq.${tripId}&item_id=eq.${encodeURIComponent(itemId)}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(), "Prefer": "return=minimal" },
        body: JSON.stringify({ outfit_ids: outfitIds }),
      },
    );
    if (!res.ok) throw new Error("Trip item outfit_ids update failed");
  },
  // Throws on failure (rather than soft-[] like the fetchers above): the
  // wave-2 reconcile must distinguish "no rows" from "couldn't read" — an
  // error mistaken for an empty list would clobber packed statuses. Both
  // callers catch (App soft-fails to [], TripDetailView keeps its last copy).
  async fetchTripItems(tripId) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trip_items?trip_id=eq.${tripId}&select=*`,
      { headers: sbHeaders() },
    );
    if (!res.ok) throw new Error(`fetchTripItems failed ${res.status}`);
    return res.json();
  },
  // Replace a trip's trip_items wholesale: DELETE then bulk POST (PostgREST
  // accepts an array body). Used when (re)pinning a trip's outfits — the row
  // set is derived from the outfits, so a full rewrite is the honest shape.
  async replaceTripItems(tripId, rows = []) {
    const del = await fetch(`${SUPABASE_URL}/rest/v1/trip_items?trip_id=eq.${tripId}`, {
      method: "DELETE", headers: sbHeaders(),
    });
    if (!del.ok) throw new Error(`replaceTripItems delete failed ${del.status}`);
    if (!rows.length) return [];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_items`, {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "return=representation" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`replaceTripItems insert failed ${res.status}`);
    return res.json();
  },
  // Targeted upsert (wave 2 reconcile): insert new rows / refresh outfit_ids
  // on existing ones without the full DELETE+POST of replaceTripItems —
  // a wholesale replace would wipe packed statuses the reconcile must keep.
  async upsertTripItems(rows = []) {
    if (!rows.length) return [];
    const res = await fetch(`${SUPABASE_URL}/rest/v1/trip_items?on_conflict=trip_id,item_id`, {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`upsertTripItems failed ${res.status}`);
    return res.json();
  },
  // Targeted delete (wave 2 reconcile): rows no longer referenced by any
  // outfit come off the list. item_id is TEXT (wardrobe ids), so encode.
  async deleteTripItems(tripId, itemIds = []) {
    const list = [...new Set(itemIds)].filter(Boolean);
    if (list.length === 0) return;
    const inList = list.map(encodeURIComponent).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trip_items?trip_id=eq.${tripId}&item_id=in.(${inList})`,
      { method: "DELETE", headers: sbHeaders() },
    );
    if (!res.ok) throw new Error(`deleteTripItems failed ${res.status}`);
  },
  // Bulk status flip (suggested | packed | left_behind) — same id=in.(…)
  // pattern as setLastWornBulk. item_id is TEXT (wardrobe ids), so encode.
  async setTripItemStatus(tripId, itemIds = [], status) {
    const list = [...new Set(itemIds)].filter(Boolean);
    if (list.length === 0) return;
    const inList = list.map(encodeURIComponent).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trip_items?trip_id=eq.${tripId}&item_id=in.(${inList})`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(), "Prefer": "return=minimal" },
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) throw new Error(`setTripItemStatus failed ${res.status}`);
  },

  // ── Look feedback (thumbs up/down on generated looks) ──
  async saveLookFeedback({ lookHash, rating, itemIds, occasion }) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/look_feedback`, {
      method: "POST",
      headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        look_hash: lookHash,
        rating,
        item_ids: itemIds,
        occasion,
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
      { headers: sbHeaders() },
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
        { headers: sbHeaders() },
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
      headers: sbHeaders(),
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
        { headers: sbHeaders() },
      );
      if (!res.ok) return [];
      return (await res.json().catch(() => [])) || [];
    } catch { return []; }
  },

  // ── Look edits (in-place editor corrections — the SWAP LESSONS signal) ──
  // One row per swap/remove/add she makes on a suggested look. Fire-and-forget
  // on the write path (never block or break the editor); the read path feeds
  // the stylist prompt + the style fingerprint.
  async saveLookEdit({ action, occasion, weather, outItemId, inItemId }) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/look_edits`, {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({
          action,
          occasion: occasion || null,
          weather: weather || null,
          out_item_id: outItemId || null,
          in_item_id: inItemId || null,
        }),
      });
    } catch { /* best-effort — an unlogged edit costs one lesson, not the edit */ }
  },
  // Newest first, capped — the aggregator collapses repeats so 120 rows is
  // months of signal.
  // In-flight sharing per limit (cleared once settled): App's mount path
  // fires this twice concurrently (the unconditional SWAP-LESSONS load and
  // the fingerprint-staleness check), which was two identical GETs.
  _lookEditsInflight: {},
  fetchLookEdits(limit = 120) {
    if (this._lookEditsInflight[limit]) return this._lookEditsInflight[limit];
    const p = (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/look_edits?select=action,occasion,weather,out_item_id,in_item_id,created_at&order=created_at.desc&limit=${limit}`,
          { headers: sbHeaders() },
        );
        if (!res.ok) return [];
        return (await res.json().catch(() => [])) || [];
      } catch { return []; }
    })();
    this._lookEditsInflight[limit] = p;
    p.finally(() => { if (this._lookEditsInflight[limit] === p) delete this._lookEditsInflight[limit]; });
    return p;
  },

  // ── Sets ──
  async fetchSets() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/sets?select=*&order=created_at.desc`, { headers: sbHeaders() });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },
  async upsertSet(set) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/sets`, {
        method: "POST",
        headers: { ...sbHeaders(), "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(set),
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },
  async deleteSet(id) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sets?id=eq.${id}`, { method: "DELETE", headers: sbHeaders() });
    } catch { /* ignore — table may not exist */ }
  },
};
