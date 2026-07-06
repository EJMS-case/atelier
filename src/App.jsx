import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
// Outfit generation, knit classify, color analyze — sole entry points into
// the AI layer from App.jsx. The lower-level helpers (sampler / validator /
// prompt builder / rotation tracker) live behind generateOutfit and don't
// need to be re-imported here.
import { MOODS } from "./features/stylist/moods.js";
import { saveLookFeedback, fetchItemFeedbackScores, lookHash } from "./features/stylist/feedback.js";
import { generateStyleFingerprint } from "./features/stylist/styleFingerprint.js";
import { savePlan, deletePlan } from "./features/planner/plannerApi.js";
import { bumpWearCounts, unbumpWearCounts } from "./features/wear/wearApi.js";
import HomeView from "./features/home/HomeView.jsx";
import { s, si, ss } from "./ui/styles.js";
import { icons, Icon } from "./ui/icons.jsx";
import { SET_TAGS, OCCASIONS } from "./constants/taxonomy.js";
import { COLOR_FAMILY_RANGES, effectiveColorFamily } from "./constants/color.js";
import {
  colorSortIdx, defaultSortComparator, mergeItems,
} from "./utils/item-helpers.js";
import {
  THEME_KEY, RECENT_LOOKS_KEY,
  loadLocalItems, saveLocalItems, loadApiKey, saveApiKey, loadRmbgKey, saveRmbgKey,
  loadSetsMeta, saveSetsMeta, loadStylePrefs, loadAboutMe,
  migrateLocalStorage,
} from "./utils/storage.js";
import { sb } from "./lib/supabase.js";
import { migrateImages, migrateAndSync } from "./lib/migrate.js";
import {
  generateOutfit, classifyKnitAI, analyzeColorAI,
} from "./lib/ai/stylist.js";
// Inline imports — these render on the default Home/Closet view and would
// trigger a Suspense flash on first paint if lazy.
import FilterBar from "./components/FilterBar.jsx";
import SetCard from "./components/SetCard.jsx";
import ItemCard from "./components/ItemCard.jsx";
import LookCard from "./components/LookCard.jsx";

// Code-split everything else. Each chunk only ships when the matching view
// (or modal) is actually opened — shaves ~150kB off the initial bundle and
// keeps the closet/home cold-start fast.
const SettingsView      = lazy(() => import("./components/SettingsView.jsx"));
const StyleInsightsView = lazy(() => import("./components/StyleInsightsView.jsx"));
const ShoppingView      = lazy(() => import("./components/ShoppingView.jsx"));
const SavedView         = lazy(() => import("./components/SavedView.jsx"));
const PlannerWrapper    = lazy(() => import("./components/PlannerWrapper.jsx"));
const ColorAdvisorView  = lazy(() => import("./components/ColorAdvisorView.jsx"));
const SetEditModal      = lazy(() => import("./components/SetEditModal.jsx"));
const BulkAddView       = lazy(() => import("./components/BulkAddView.jsx"));
const EditItemView      = lazy(() => import("./components/EditItemView.jsx"));
const SilhouetteBuilder = lazy(() => import("./features/builder/SilhouetteBuilder.jsx"));
const InspirationView   = lazy(() => import("./features/inspiration/InspirationView.jsx"));

import { listInspirations, vibesFor } from "./features/inspiration/inspirationApi.js";
import { outfitsOf, buildPlanPayload, newOutfitId } from "./features/planner/outfits.js";
import { fetchPlansBetween } from "./features/planner/plannerApi.js";

// Minimal placeholder while a lazy chunk loads. Reuses the existing spinner
// styles so the visual register matches the rest of the app.
const RouteFallback = () => (
  <div style={{ padding: "40px 16px", display: "flex", justifyContent: "center" }}>
    <span style={s.spinner}/>
  </div>
);

// Rename any pre-namespace localStorage keys from older app builds. Runs once
// per browser; no-op afterward. Must fire before any load*() helpers below.
migrateLocalStorage();



// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [items,      setItems]      = useState(() => loadLocalItems());
  const [view,       setViewRaw]    = useState("home");
  const closetScrollRef = useRef(0);
  const viewRef = useRef("closet");
  const setView = useCallback((v) => {
    // Save scroll position when leaving closet
    if (viewRef.current === "closet" && v !== "closet") {
      closetScrollRef.current = window.scrollY;
    }
    viewRef.current = v;
    setViewRaw(v);
    // Restore scroll position when returning to closet
    if (v === "closet") {
      requestAnimationFrame(() => {
        window.scrollTo(0, closetScrollRef.current);
      });
    }
  }, []);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);
  const [filter,     setFilter]     = useState("All"); // legacy — still used for Sets view
  const [activeFilters, setActiveFilters] = useState({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const [outfits,    setOutfits]    = useState(null);
  const [allLooks,   setAllLooks]   = useState(() => {
    // Lazy-init from localStorage so anti-repeat history persists across sessions
    try {
      const raw = localStorage.getItem(RECENT_LOOKS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }); // history of all generated looks for anti-repeat
  const [styling,    setStyling]    = useState(false);
  const [styleErr,   setStyleErr]   = useState("");
  const [occasion,   setOccasion]   = useState("Work");
  // Weather is a Set (one temp chip at a time). Empty Set === "Any". Stored
  // as Set in state, joined to a string when passed downstream.
  const [weather,    setWeather]    = useState(() => new Set());
  const [mood,       setMood]       = useState(""); // F2 — mood tag key
  const [request,    setRequest]    = useState("");
  const [styleExcludes, setStyleExcludes] = useState(new Set()); // user-toggled exclusions
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [manualBuilderOpen, setManualBuilderOpen] = useState(false);
  // When the user taps Edit on a planner day, we open the SilhouetteBuilder
  // pre-populated with that plan. Schedule mode + the original date are
  // pre-selected so hitting Save updates the same pin in place.
  const [editingPlan, setEditingPlan] = useState(null); // { iso, plan }
  const [feedbackScores, setFeedbackScores] = useState({});    // F2 — aggregate item scores
  const [recentlyWornItems, setRecentlyWornItems] = useState([]); // F2 — item IDs worn in last 3 days
  const [apiKey,     setApiKey]     = useState(() => loadApiKey());
  const [rmbgKey,    setRmbgKey]    = useState(() => loadRmbgKey());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [editItem,   setEditItem]   = useState(null);
  // Remember which view launched the EditItem flow so Save/Back/Delete
  // return the user there instead of dumping them on the closet/home.
  // Editing a piece from Style Me used to land back on Home — annoying when
  // you wanted to keep flipping through the same look set.
  const [editReturnView, setEditReturnView] = useState("closet");
  // Where to send the user when the SilhouetteBuilder closes. Mirrors
  // editReturnView for the item-edit screen: capture the caller's view on
  // open, restore it on close — otherwise saving a planner edit dumps you
  // on the empty Style Me screen instead of the page you came from.
  const [builderReturnView, setBuilderReturnView] = useState(null);
  const [closetSearch, setClosetSearch] = useState("");  // global closet search
  const [favorites,  setFavorites]  = useState([]);
  // Hearted outfits, resolved to {garment_ids, occasion} — fed to the stylist
  // as elevated exemplars ("the bar"). Text-only in the prompt, so no W-IDs.
  const [lovedLooks, setLovedLooks] = useState([]);
  const [inspirations, setInspirations] = useState([]);
  // { text, source_count, generated_at } | null — loaded from user_settings
  // and refreshed via the Settings → Update Style Fingerprint button.
  const [styleFingerprint, setStyleFingerprint] = useState(null);
  // Lazy-load inspirations + fingerprint on first render. They live in their
  // own table/key and never block the closet boot — failures here shouldn't
  // break Style Me.
  useEffect(() => {
    listInspirations().then(setInspirations).catch(() => setInspirations([]));
    sb.getStyleFingerprint().then(setStyleFingerprint).catch(() => setStyleFingerprint(null));
  }, []);
  // ── Sets metadata ──
  const [setsMeta,       setSetsMeta]       = useState(() => loadSetsMeta());
  const [setsSearch,     setSetsSearch]     = useState("");
  const [setsTagFilter,  setSetsTagFilter]  = useState("");
  const [setsSort,       setSetsSort]       = useState("recent"); // recent | alpha | count
  const [editingSet,     setEditingSet]     = useState(null); // null or set_id for modal
  const syncTimer = useRef(null);

  // ── Persist allLooks to localStorage so anti-repeat history survives reloads
  useEffect(() => {
    try { localStorage.setItem(RECENT_LOOKS_KEY, JSON.stringify(allLooks)); } catch {}
  }, [allLooks]);

  // ── Flash sync status briefly
  const flashSync = (status) => {
    setSyncStatus(status);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => setSyncStatus("idle"), 3000);
  };

  // ── Pull from Supabase and merge — callable on mount AND as a manual retry
  const reloadFromSupabase = useCallback(() => {
    setSyncStatus("syncing");
    sb.fetchAll()
      .then(async sbItems => {
        // Remove test placeholder items (t1-t10) that were never real wardrobe entries
        const testIds = sbItems.filter(it => /^t\d+$/.test(it.id)).map(it => it.id);
        if (testIds.length > 0) {
          await Promise.all(testIds.map(id => sb.remove(id).catch(() => {})));
          sbItems = sbItems.filter(it => !/^t\d+$/.test(it.id));
        }

        const freshLocal = loadLocalItems();
        if (!sbItems || sbItems.length === 0) {
          if (freshLocal.length > 0) {
            setItems(freshLocal);
            migrateAndSync(freshLocal, setItems, flashSync);
          } else {
            setSyncStatus("idle");
          }
          return;
        }
        const merged = mergeItems(sbItems, freshLocal);
        setItems(merged);
        saveLocalItems(merged);

        // Push up local-only NEW items still flagged pending_sync.
        // Without this filter, an aggressive "sync everything local" would
        // re-create items that another device legitimately deleted.
        const sbIds = new Set(sbItems.map(it => it.id));
        const pendingLocalOnly = freshLocal.filter(it => !sbIds.has(it.id) && it.pending_sync);
        if (pendingLocalOnly.length > 0) {
          migrateAndSync(pendingLocalOnly, setItems, flashSync);
        }
        // Push up EDITED items still flagged pending_sync — these exist on
        // Supabase, but their latest edit never reached the server (network
        // blip, tab closed mid-save). The merged copy already has the local
        // values; retry the upsert here so other devices see them.
        const pendingEdits = merged.filter(it => sbIds.has(it.id) && it.pending_sync);
        for (const it of pendingEdits) {
          sb.upsert(it).then(() => {
            const cleared = loadLocalItems().map(x => x.id === it.id ? { ...x, pending_sync: false } : x);
            saveLocalItems(cleared);
            setItems(prev => prev.map(x => x.id === it.id ? { ...x, pending_sync: false } : x));
          }).catch(err => console.warn("[Atelier] Retry edit-sync failed for", it.id, err));
        }

        // Migrate any base64 images in the merged set to Storage
        const needsMigration = merged.filter(it => it.image?.startsWith("data:"));
        if (needsMigration.length > 0) {
          migrateImages(needsMigration, setItems, saveLocalItems);
        }

        flashSync("synced");
      })
      .catch(() => setSyncStatus("error"));
  }, []);

  // ── On mount: ensure Storage bucket exists, pull from Supabase, merge with local
  // (initial items came from the lazy useState init above, no need to re-read).
  useEffect(() => {
    sb.ensureBucket().catch(() => {});
    // F2 — load aggregate feedback scores so sampler can weight future picks
    fetchItemFeedbackScores().then(setFeedbackScores).catch(() => {});

    // Background refresh of the style fingerprint when history has grown enough
    // since it was last generated. It used to refresh ONLY from a Settings
    // button, so it silently went stale; this keeps "personal patterns" current
    // without the user doing anything. Fully best-effort.
    const maybeRefreshFingerprint = async (logs) => {
      if (!apiKey) return;
      const count = (logs || []).length;
      if (count < 5) return;
      try {
        const fp = await sb.getStyleFingerprint().catch(() => null);
        const have = fp?.source_count || 0;
        if (fp && count - have < 10) return;   // still fresh enough
        const plans = await sb.fetchAllPlans().catch(() => []);
        const fresh = await generateStyleFingerprint({ items, logs, plans, apiKey });
        if (fresh?.text) { setStyleFingerprint(fresh); sb.saveStyleFingerprint(fresh).catch(() => {}); }
      } catch { /* non-fatal — regenerate next session */ }
    };

    // Favorites + outfit history together → recently-worn (anti-repeat) and
    // loved looks (elevation exemplars for the stylist), plus the fingerprint
    // refresh above.
    Promise.all([sb.fetchFavorites(), sb.fetchOutfitLogs()]).then(([favs, logs]) => {
      setFavorites(favs || []);

      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const wornIds = new Set();
      (logs || []).forEach(log => {
        if (log.date_worn && log.date_worn >= cutoff) {
          (log.garment_ids || []).forEach(id => wornIds.add(id));
        }
      });
      setRecentlyWornItems([...wornIds]);

      // Loved looks = hearted outfit_logs (newest first, capped).
      const lovedIds = new Set((favs || []).filter(f => f.type === "outfit").map(f => f.reference_id));
      setLovedLooks(
        (logs || [])
          .filter(l => lovedIds.has(l.id) && (l.garment_ids || []).length >= 2)
          .slice(0, 6)
          .map(l => ({ garment_ids: l.garment_ids, occasion: l.occasion }))
      );

      maybeRefreshFingerprint(logs || []);
    }).catch(() => {});

    // Load sets metadata from Supabase and backfill any local-only sets.
    // fetchSets() returns null if the `sets` table is missing — in that case
    // we leave local meta alone so nothing is lost until the migration runs.
    sb.fetchSets().then(sbSets => {
      if (sbSets == null) return;
      const localMeta = loadSetsMeta();
      const merged = { ...localMeta };
      const remoteIds = new Set();
      sbSets.forEach(s => {
        remoteIds.add(s.id);
        merged[s.id] = { name: s.name, tags: s.tags || [], created_at: s.created_at };
      });
      // One-way backfill: push any local-only sets up to Supabase. This is
      // what propagates device-local set names across devices the first time
      // the table is available.
      Object.entries(localMeta).forEach(([id, meta]) => {
        if (!remoteIds.has(id)) {
          sb.upsertSet({ id, name: meta?.name || "", tags: meta?.tags || [] }).catch(() => {});
        }
      });
      setSetsMeta(merged);
      saveSetsMeta(merged);
    }).catch(() => {});

    // Try to load API keys from Supabase (cross-device sync)
    sb.getSettings().then(settings => {
      if (settings?.anthropicKey && !loadApiKey()) {
        saveApiKey(settings.anthropicKey);
        setApiKey(settings.anthropicKey);
      }
      if (settings?.rmbgKey && !loadRmbgKey()) {
        saveRmbgKey(settings.rmbgKey);
        setRmbgKey(settings.rmbgKey);
      }
    }).catch(() => {});

    reloadFromSupabase();
  }, [reloadFromSupabase]);

  // ── Persist to both localStorage and Supabase
  const persistItems = useCallback((updated) => {
    saveLocalItems(updated);
    setItems(updated);
  }, []);

  // ── Sets metadata helpers ──
  const updateSetMeta = useCallback((setId, data) => {
    setSetsMeta(prev => {
      const next = { ...prev, [setId]: { ...(prev[setId] || {}), ...data } };
      saveSetsMeta(next);
      sb.upsertSet({ id: setId, name: next[setId].name || "", tags: next[setId].tags || [] }).catch(() => {});
      return next;
    });
  }, []);

  const deleteSetMeta = useCallback((setId) => {
    setSetsMeta(prev => {
      const next = { ...prev };
      delete next[setId];
      saveSetsMeta(next);
      sb.deleteSet(setId).catch(() => {});
      return next;
    });
    // Unlink all items from this set
    const updated = items.map(it => it.set_id === setId ? { ...it, set_id: null, is_separable: false } : it);
    persistItems(updated);
    updated.filter(it => it.set_id === null && items.find(o => o.id === it.id)?.set_id === setId)
      .forEach(it => sb.upsert(it).catch(() => {}));
  }, [items, persistItems]);

  const getSetName = useCallback((setId, index) => {
    return setsMeta[setId]?.name || `Set ${index + 1}`;
  }, [setsMeta]);

  const addItems = useCallback(async (newItems) => {
    // Mark every new item pending_sync until Supabase confirms it. The merge
    // logic uses this flag to preserve local-only items on reload — without
    // it, an item uploaded optimistically could be dropped as "deleted
    // elsewhere" if the user reloads before upsert finishes.
    const pendingNew = newItems.map(it => ({ ...it, pending_sync: true }));
    const optimistic = [...items, ...pendingNew];
    setItems(optimistic);
    saveLocalItems(optimistic);
    flashSync("syncing");

    const BATCH = 5;
    const saved = [...items];
    let failedImages = [];
    let anyFailed = false;

    for (let i = 0; i < pendingNew.length; i += BATCH) {
      const batch = pendingNew.slice(i, i + BATCH);
      await Promise.all(batch.map(async (item) => {
        try {
          let toSave = item;
          if (item.image?.startsWith("data:")) {
            try {
              const url = await sb.uploadImage(item.id, item.image);
              toSave = { ...item, image: url };
            } catch (imgErr) {
              console.error("Image upload failed for", item.name, imgErr);
              failedImages.push(item.name);
              // Keep base64 in localStorage so it survives reload and can be retried
              toSave = item;
            }
          }
          await sb.upsert(toSave);
          // Upsert confirmed — strip the pending flag so future merges treat
          // the item as "lives in Supabase" rather than "local-only retry".
          const { pending_sync, ...confirmed } = toSave;
          void pending_sync;
          saved.push(confirmed);
          setItems(prev => prev.map(it => it.id === toSave.id ? confirmed : it));
        } catch(e) {
          console.error("Failed to save item to Supabase:", item.name, e);
          saved.push(item); // keep pending_sync: true; retry on next reload
          anyFailed = true;
        }
      }));
      if (i + BATCH < pendingNew.length) await new Promise(r => setTimeout(r, 300));
    }

    saveLocalItems(saved);
    if (failedImages.length > 0) {
      flashSync("error");
      setTimeout(() => alert(`⚠️ Photos failed to upload for ${failedImages.length} item(s):\n\n${failedImages.join("\n")}\n\nThe items were saved but without photos. Go to Settings → Force Sync to retry, or re-upload photos by editing each item.`), 300);
    } else {
      anyFailed ? flashSync("error") : flashSync("synced");
    }
  }, [items]);

  // Returns { ok, error, imageUploadFailed }. Callers can choose to await and
  // surface failure to the user (the EditItemView keeps the form open on
  // failure so unsynced edits aren't lost). Edits are tagged pending_sync so
  // mergeItems retains the local copy across reloads until the upsert lands.
  const updateItem = useCallback(async (id, fields) => {
    let resolvedFields = { ...fields };
    let imageUploadFailed = false;
    if (fields.image?.startsWith("data:")) {
      try {
        const url = await sb.uploadImage(id, fields.image);
        resolvedFields = { ...fields, image: url };
      } catch (imgErr) {
        console.error("Image upload failed during edit:", imgErr);
        imageUploadFailed = true;
      }
    }
    // Tag as pending so a refresh mid-sync doesn't wipe the change.
    const pendingUpdate = items.map(it => it.id === id ? {...it, ...resolvedFields, pending_sync: true} : it);
    persistItems(pendingUpdate);
    flashSync("syncing");
    try {
      const item = pendingUpdate.find(it => it.id === id);
      await sb.upsert(item);
      // Clear the flag now that Supabase has the change.
      const cleared = pendingUpdate.map(it => it.id === id ? {...it, pending_sync: false} : it);
      persistItems(cleared);
      if (imageUploadFailed) {
        flashSync("error");
        alert("⚠️ Your changes were saved, but the photo failed to upload. The photo is stored locally — try editing the item again or use Settings → Force Sync.");
        return { ok: false, error: "Photo upload failed (text changes saved).", imageUploadFailed: true };
      }
      flashSync("synced");
      return { ok: true };
    } catch(e) {
      console.error("Failed to update item in Supabase:", e);
      flashSync("error");
      // Leave pending_sync: true on the local row so mergeItems + the
      // reloadFromSupabase retry path can recover it on the next reload.
      return { ok: false, error: e.message || "Couldn't save to cloud — your edit is kept locally and will retry on next reload." };
    }
  }, [items, persistItems]);

  // Force-sync ALL items currently in React state to Supabase — used after bulk upload failures
  // Reads from live state (has base64 images), uploads them, saves URLs back
  const forceSyncAll = useCallback(async (onProgress) => {
    // Only sync items that have changed since the last successful upload.
    // Items get pending_sync: true on add or edit and have the flag cleared
    // once Supabase confirms. Walking the whole closet was wasteful — a
    // 393-item wardrobe took ~60s to re-upload every photo on every sync.
    const toSync = items.filter(it => it.pending_sync === true);
    if (toSync.length === 0) {
      flashSync("synced");
      return { done: 0, failed: 0, skipped: items.length, nothingToSync: true };
    }
    flashSync("syncing");
    let done = 0, failed = 0, imgFailed = 0;
    const updated = [...items];
    // Index for in-place replacement (toSync items may not be at the same
    // indices as the working `updated` array).
    const indexById = new Map(updated.map((it, i) => [it.id, i]));
    for (let i = 0; i < toSync.length; i++) {
      const item = toSync[i];
      try {
        let toSave = item;
        if (item.image?.startsWith("data:")) {
          try {
            const url = await sb.uploadImage(item.id, item.image);
            toSave = { ...item, image: url };
            const idx = indexById.get(toSave.id);
            if (idx != null) updated[idx] = toSave;
            setItems(prev => prev.map(it => it.id === toSave.id ? toSave : it));
          } catch (imgErr) {
            console.error("Force sync image upload failed for", item.name, imgErr);
            imgFailed++;
          }
        }
        await sb.upsert(toSave);
        // Clear the pending flag now that Supabase has it.
        const cleared = { ...toSave, pending_sync: false };
        const idx = indexById.get(cleared.id);
        if (idx != null) updated[idx] = cleared;
        setItems(prev => prev.map(it => it.id === cleared.id ? cleared : it));
        done++;
      } catch { failed++; }
      if (onProgress) onProgress(i + 1, toSync.length, failed);
      await new Promise(r => setTimeout(r, 150));
    }
    saveLocalItems(updated);
    const anyProblems = failed > 0 || imgFailed > 0;
    anyProblems ? flashSync("error") : flashSync("synced");
    if (imgFailed > 0) {
      setTimeout(() => alert(`⚠️ ${imgFailed} photo(s) failed to upload to cloud storage. Item data was saved but those photos are only stored locally.`), 300);
    }
    return { done, failed, skipped: items.length - toSync.length };
  }, [items]);

  const deleteItem = useCallback(async (id) => {
    const updated = items.filter(it => it.id !== id);
    persistItems(updated);
    flashSync("syncing");
    try {
      await sb.remove(id);
      sb.removeImage(id).catch(() => {}); // best-effort Storage cleanup
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  // Pre-fill the Style Me request with a phrasing the sampler / validator
  // can recognize, then jump to the panel. Used by ItemCard's spark button.
  const styleWithItem = useCallback((it) => {
    const desc = `${it.color ? it.color + " " : ""}${it.subcategory || it.category}`.trim();
    setRequest(`include my ${desc} "${it.name}"`);
    setView("style");
    setStylePanelOpen(true);
  }, [setView]);

  // "Build a similar look" from a saved log. Seeds Style Me with the original
  // look's silhouette description + its occasion / weather / mood, then opens
  // the panel. The free-text prompt nudges the AI to keep the silhouette shape
  // (e.g. midi-skirt + silk-blouse + heels) while varying colors and specific
  // pieces — not regenerate the same outfit.
  const buildSimilarLook = useCallback((log) => {
    const ids = log?.garment_ids || [];
    const wear = ids.map(id => items.find(it => it.id === id)).filter(Boolean);
    const silhouetteParts = wear.map(it => {
      const sub = (it.subcategory || it.category || "").toLowerCase().trim();
      const color = (it.color || "").toLowerCase().trim();
      const composed = [color, sub].filter(Boolean).join(" ");
      return composed || it.name?.toLowerCase() || "";
    }).filter(Boolean);
    const silhouette = silhouetteParts.join(" + ");
    if (silhouette) {
      setRequest(`Build a similar silhouette to: ${silhouette}. Keep the shape and category mix but vary the specific pieces and color story — different items, different palette, same overall vibe.`);
    } else {
      setRequest("");
    }
    // Pre-fill occasion / weather / mood from the original look so the user
    // doesn't have to re-set them. Multi-tag aware (legacy logs use the
    // singular field, newer ones use the plural array).
    const occ = (Array.isArray(log?.occasions) ? log.occasions[0] : null) || log?.occasion;
    if (occ) setOccasion(occ);
    const wx = (Array.isArray(log?.weathers) ? log.weathers[0] : null) || log?.weather;
    if (wx) setWeather(new Set([wx]));
    try {
      const meta = log?.collage_url ? JSON.parse(log.collage_url) : null;
      if (meta?.mood) setMood(meta.mood);
    } catch { /* meta not JSON — ignore */ }
    setView("style");
    setStylePanelOpen(true);
  }, [items, setView]);

  const isFav = useCallback((type, refId) =>
    favorites.some(f => f.type === type && f.reference_id === refId),
  [favorites]);

  const toggleFav = useCallback(async (type, refId) => {
    const existing = favorites.find(f => f.type === type && f.reference_id === refId);
    if (existing) {
      setFavorites(prev => prev.filter(f => f.id !== existing.id));
      await sb.removeFavorite(type, refId);
    } else {
      const result = await sb.addFavorite(type, refId);
      setFavorites(prev => [...result, ...prev]);
    }
  }, [favorites]);

  const normalizeLooks = (looks, fallbackOccasion) => looks.map(look => {
    const aiLayout = (() => {
      const ok = (c) =>
        typeof c.x === "number" && c.x >= 0 && c.x <= 85 &&
        typeof c.y === "number" && c.y >= 0 && c.y <= 88 &&
        typeof c.w === "number" && c.w >= 8 && c.w <= 65 &&
        typeof c.h === "number" && c.h >= 8 && c.h <= 88;
      const coords = (look.items || []).filter(item =>
        typeof item === "object" && item.id && ok(item)
      );
      // Only trust AI layout if every item has valid coordinates.
      const allItems = (look.items || []).filter(i => typeof i === "object" && i.id);
      if (coords.length < allItems.length || coords.length < 2) return null;
      return coords.map(item => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h }));
    })();
    return {
      ...look,
      items: (look.items || []).map(item =>
        typeof item === "object" ? item.id : String(item).replace(/^ID:/i, "").trim()
      ),
      itemRoles: (look.items || []).reduce((acc, item) => {
        if (typeof item === "object" && item.id && item.role) acc[item.id] = item.role;
        return acc;
      }, {}),
      layout_data: look.layout_data || aiLayout || undefined,
      mood: look.vibe || look.mood || "",
      occasion: look.occasion || fallbackOccasion,
      styling: look.rationale || look.styling || "",
      colorStory: look.color_strategy || look.colorStory || "",
      reasoning: look.rationale || look.reasoning || "",
    };
  });

  // Join the multi-weather Set into a single label the downstream code
  // already understands ("Hot (85°F+) + Rainy"). The filter / prompt parse
  // each word independently, so this is the cleanest bridge.
  const weatherLabel = [...weather].join(" + ");

  // Style Me uses single-look generation by default — the first look arrives
  // in ~20s instead of waiting ~60s for all three. "Style 2 more" generates
  // additional looks sequentially in the background; the App-level outfits
  // state means the user can navigate away while it runs and come back to
  // find new looks waiting.
  const generateAndAppendLooks = async (count, mode) => {
    // mode === "fresh" replaces outfits; mode === "append" keeps existing
    // looks and adds new ones (used by "Style 2 more").
    let streamedAny = false;
    try {
      const onLook = (look) => {
        const normalized = normalizeLooks([look], occasion);
        setOutfits(prev => mode === "append"
          ? [...(prev || []), ...normalized]
          : [...(prev || []), ...normalized]);
        if (!streamedAny) {
          streamedAny = true;
          if (mode === "fresh") setView("style");
          setStyling("partial");
        }
      };
      const inspirationVibes = vibesFor(inspirations, occasion, [...weather][0] || "")
        .map(r => r.vibe_text)
        .filter(Boolean);
      const fingerprintText = styleFingerprint?.text || "";
      const result = await generateOutfit(
        items, occasion, weatherLabel, request, apiKey, allLooks,
        loadStylePrefs(), loadAboutMe(), styleExcludes,
        { mood, feedbackScores, recentlyWornItems, onLook, inspirationVibes, styleFingerprint: fingerprintText, lovedLooks, count }
      );
      const looks = result?.looks;
      if (!looks || !Array.isArray(looks) || looks.length === 0) {
        throw new Error("AI returned no looks — try again.");
      }
      const normalizedLooks = normalizeLooks(looks, occasion);
      // Replace the streamed slice for THIS generation with the validated
      // final set. For "fresh", normalizedLooks is the whole thing; for
      // "append", we need to keep prior looks and replace only the tail.
      setOutfits(prev => {
        if (mode === "append") {
          // Discard the (possibly partial) tail streamed in this batch and
          // splice in the validated final looks.
          const priorCount = (prev?.length || 0) - normalizedLooks.length;
          const head = (prev || []).slice(0, Math.max(0, priorCount));
          return [...head, ...normalizedLooks];
        }
        return normalizedLooks;
      });
      setAllLooks(prev => [...prev, ...normalizedLooks].slice(-30));
    } catch(e) {
      setStyleErr(e.message || "Styling failed — check your API key.");
      console.error("Generation error:", e);
    }
  };

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null);
    await generateAndAppendLooks(1, "fresh");
    setStyling(false);
  };

  // "Style 2 more" — appends two additional looks to the existing set without
  // clearing what's already there. Runs after the first look has arrived.
  const handleStyleMore = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (styling) return; // a generation is already in flight
    setStyling("partial"); setStyleErr("");
    await generateAndAppendLooks(2, "append");
    setStyling(false);
  };

  // Apply multi-select filters
  const isSetView = activeFilters.category?.includes("Sets");
  const setGroupsRaw = isSetView ? (() => {
    const groups = {};
    items.filter(it => it.set_id).forEach(it => {
      if (!groups[it.set_id]) groups[it.set_id] = [];
      groups[it.set_id].push(it);
    });
    return Object.entries(groups).map(([setId, groupItems]) => ({
      setId,
      items: groupItems,
      name: setsMeta[setId]?.name || "",
      tags: setsMeta[setId]?.tags || [],
      created_at: setsMeta[setId]?.created_at || groupItems[0]?.created_at || "",
    }));
  })() : null;

  // Filter + sort sets
  const setGroups = setGroupsRaw ? (() => {
    let result = [...setGroupsRaw];
    // Search filter
    if (setsSearch.trim()) {
      const q = setsSearch.toLowerCase().trim();
      result = result.filter(g =>
        g.name.toLowerCase().includes(q) ||
        g.items.some(it => it.name.toLowerCase().includes(q) || (it.brand || "").toLowerCase().includes(q))
      );
    }
    // Tag filter
    if (setsTagFilter) {
      result = result.filter(g => g.tags.includes(setsTagFilter));
    }
    // Sort
    if (setsSort === "alpha") {
      result.sort((a, b) => (a.name || "Set").localeCompare(b.name || "Set"));
    } else if (setsSort === "count") {
      result.sort((a, b) => b.items.length - a.items.length);
    } else {
      result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return result;
  })() : null;

  const filtered = (() => {
    let base = items;
    const cats = activeFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length)  base = base.filter(it => cats.includes(it.category));
    if (activeFilters.subcategory?.length) base = base.filter(it => activeFilters.subcategory.includes(it.subcategory));
    // Sleeve length filter — maps Tops subcategories to a sleeve length.
    if (activeFilters.sleeveLength) {
      const sl = activeFilters.sleeveLength;
      const TOPS_SLEEVE_MAP = {
        "Tanks": "Sleeveless",
        "T-Shirts": "Short Sleeve", "Polos": "Short Sleeve", "Short Sleeve": "Short Sleeve",
        "Blouses": "Long Sleeve", "Shirts": "Long Sleeve", "Tops": "Long Sleeve",
        "Light Knit Tops": "Long Sleeve",
      };
      base = base.filter(it => {
        if (it.category === "Tops") return TOPS_SLEEVE_MAP[it.subcategory] === sl;
        return true;   // sleeve filter applies to Tops only
      });
    }
    if (activeFilters.brand?.length)  base = base.filter(it => activeFilters.brand.includes(it.brand));
    if (activeFilters.color?.length) {
      base = base.filter(it => {
        // Family is derived from the actual color string when possible, so
        // a "Gray" item saved with the legacy "Neutral" family resolves to
        // "Gray" and stays out of the Neutrals bucket.
        const family = effectiveColorFamily(it);
        return activeFilters.color.includes(family);
      });
    }
    // Sets filter
    if (activeFilters.sets === "Sets Only") base = base.filter(it => it.set_id);
    if (activeFilters.sets === "Separates Only") base = base.filter(it => !it.set_id);
    if (activeFilters.sets === "Part of a Set") base = base.filter(it => it.set_id && it.is_separable);
    // Last Worn filter
    if (activeFilters.lastWorn) {
      const now = new Date();
      const days = parseInt(activeFilters.lastWorn);
      if (days > 0) {
        const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        base = base.filter(it => !it.last_worn || new Date(it.last_worn) < cutoff);
      }
    }
    // Global search filter — matches name, brand, color, subcategory, notes
    if (closetSearch.trim()) {
      const q = closetSearch.toLowerCase().trim();
      base = base.filter(it => {
        const fields = [it.name, it.brand, it.color, it.color_family, it.subcategory, it.category, it.notes, it.pattern].filter(Boolean);
        return fields.some(f => f.toLowerCase().includes(q));
      });
    }
    return isSetView ? [] : [...base].sort(defaultSortComparator);
  })();

  // Sync status indicator
  const syncLabel = syncStatus === "syncing" ? "⟳ syncing"
    : syncStatus === "synced"  ? "✓ saved"
    : syncStatus === "error"   ? "⚠ offline"
    : null;
  const syncColor = syncStatus === "error" ? "var(--color-danger)"
    : syncStatus === "synced" ? "var(--color-success)" : "var(--color-accent)";

  // Style Me generator — rendered on both Closet and Style views via
  // `{stylePanelNode}` below. Position:fixed, so DOM location doesn't
  // matter. Extracted so the Style view has a panel to open (previously
  // the nav chip would land on an empty "go back and try again" state).
  const stylePanelNode = (
    <div style={s.stylePanel}>
      {!stylePanelOpen ? (
        /* ── Collapsed: one-tap button ── */
        <button style={{...s.btnPrimary, width:"100%", padding:"14px 20px"}}
          onClick={() => setStylePanelOpen(true)}>
          <Icon path={icons.sparkle} size={15}/> Style Me
        </button>
      ) : (
        /* ── Expanded: full controls ── */
        <>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
            <div style={s.panelLabel}>✦ STYLE ME</div>
            <button onClick={() => setStylePanelOpen(false)}
              style={{background:"none", border:"none", color:"var(--color-text-muted)", fontSize:18, cursor:"pointer", padding:"0 4px", lineHeight:1}}>✕</button>
          </div>

          {/* WHERE ARE YOU GOING? — occasion pills.
              No auto-override of styleExcludes anymore — clicking an occasion
              changes the occasion only. Her exclusion toggles below are HER
              decision and stay sticky across occasion changes. */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>WHERE ARE YOU GOING?</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {OCCASIONS.map(o => (
              <button key={o}
                style={occasion === o
                  ? {...s.chip, ...s.chipActive, fontSize:11, padding:"6px 12px"}
                  : {...s.chip, fontSize:11, padding:"6px 12px"}}
                onClick={() => setOccasion(o)}>
                {o}
              </button>
            ))}
          </div>

          {/* WHAT'S THE WEATHER? — one temperature chip at a time. Empty = Any. */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>WHAT'S THE WEATHER?</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {(() => {
              const TEMP_CHIPS = [
                ["Hot (85°F+)","Hot"],
                ["Warm (70-84°F)","Warm"],
                ["Mild (55-69°F)","Mild"],
                ["Cool (40-54°F)","Cool"],
                ["Cold (below 40°F)","Cold"],
              ];
              const TEMPS = new Set(TEMP_CHIPS.map(([v]) => v));
              const isAny = weather.size === 0;
              const toggleTemp = (val) => setWeather(prev => {
                const next = new Set(prev);
                if (next.has(val)) { next.delete(val); return next; }
                // Drop any other temperature chip — only one temp at a time.
                TEMP_CHIPS.forEach(([v]) => next.delete(v));
                next.add(val);
                return next;
              });
              return (
                <>
                  <button
                    style={isAny
                      ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                      : {...s.chip, fontSize:11, padding:"5px 11px"}}
                    onClick={() => setWeather(new Set())}>Any</button>
                  {TEMP_CHIPS.map(([val,label]) => (
                    <button key={val}
                      style={weather.has(val)
                        ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                        : {...s.chip, fontSize:11, padding:"5px 11px"}}
                      onClick={() => toggleTemp(val)}>
                      {label}
                    </button>
                  ))}
                </>
              );
            })()}
          </div>

          {/* MOOD — F2 */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>MOOD (OPTIONAL)</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            <button
              style={mood === ""
                ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                : {...s.chip, fontSize:11, padding:"5px 11px"}}
              onClick={() => setMood("")}>
              None
            </button>
            {MOODS.map(m => (
              <button key={m.key}
                style={mood === m.key
                  ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                  : {...s.chip, fontSize:11, padding:"5px 11px"}}
                onClick={() => setMood(m.key)}>
                {m.label}
              </button>
            ))}
          </div>

          {/* DON'T INCLUDE — user exclusion toggles */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>DON'T INCLUDE</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {[
              ["no-jeans","No Jeans"],
              ["no-skirts","No Skirts"],
              ["no-dresses","No Dresses"],
              ["trousers-only","Trousers Only"],
              ["no-boots","No Boots"],
              ["heels-only","Heels Only"],
              ["no-knits","No Knits"],
            ].map(([key,label]) => (
              <button key={key}
                style={styleExcludes.has(key)
                  ? {...s.chip, background:"var(--color-danger)", borderColor:"var(--color-danger)", color:"#fff", fontSize:11, padding:"5px 11px", fontWeight:500}
                  : {...s.chip, fontSize:11, padding:"5px 11px"}}
                onClick={() => setStyleExcludes(prev => {
                  const next = new Set(prev);
                  // Handle mutual exclusivity
                  if (key === "trousers-only" && !next.has(key)) { next.delete("no-skirts"); }
                  if (key === "heels-only" && !next.has(key)) { next.delete("no-boots"); }
                  next.has(key) ? next.delete(key) : next.add(key);
                  return next;
                })}>
                {label}
              </button>
            ))}
          </div>

          {/* ANYTHING SPECIFIC? */}
          <input placeholder="Anything specific? (e.g. 'include my red blazer', 'all black', 'navy and brown')"
            value={request} onChange={e=>setRequest(e.target.value)}
            style={{...s.input, width:"100%", fontSize:12, marginBottom:8}}/>
          {request && (
            <div style={{fontSize:10, color:"var(--color-text-muted)", marginTop:-4, marginBottom:8, fontStyle:"italic"}}>
              ✦ Used as the theme for all 3 looks. Named pieces are force-included.
            </div>
          )}

          {styleErr && <p style={s.err}>{styleErr}</p>}
          <button style={{...s.btnPrimary, width:"100%"}}
            onClick={() => { handleStyle(); }}
            disabled={styling}>
            {styling
              ? <><span style={s.spinnerSmLight}/> Styling…</>
              : <><Icon path={icons.sparkle} size={15}/> Style Me</>}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={s.app}>
      {/* GLOBAL KEYFRAMES */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Serif+Display&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; }
        input, select, button { font-family: inherit; }
        /* Hide horizontal scrollbar on the nav (Chrome/Safari) — the row
           still scrolls, just without the always-visible track. */
        nav::-webkit-scrollbar { display: none; }
        /* iPhone-class widths: tighten the header so all chips fit before
           overflow-scroll kicks in. */
        @media (max-width: 480px) {
          header > div { padding: 0 12px !important; }
          nav button { padding: 6px 6px !important; font-size: 11px !important; letter-spacing: 0.04em !important; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <button
            onClick={() => setView("closet")}
            style={{ ...s.brand, background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
            aria-label="Go to closet"
            title="Go to your closet"
          >
            <span style={s.brandMark}>✦</span>
            <span style={s.brandName}>ATELIER</span>
            {items.length > 0 && (
              <span style={s.badge}>{items.length}</span>
            )}
            {syncLabel && (
              <span
                style={{...s.savedPill, background: syncColor, cursor: syncStatus === "error" ? "pointer" : "default"}}
                title={syncStatus === "error" ? "Tap to retry loading your wardrobe" : undefined}
                onClick={(e) => { if (syncStatus === "error") { e.stopPropagation(); reloadFromSupabase(); } }}
              >{syncStatus === "error" ? "⚠ offline — tap to retry" : syncLabel}</span>
            )}
          </button>
          <nav style={s.nav}>
            {/* "Closet" link removed — the ATELIER brand button now takes
                users to the full closet grid. Home (the curated dashboard)
                stays as a distinct destination. */}
            {[["home","Home"],["style","Style Me"],["planner","Planner"],["favorites","Saved"],["inspiration","Inspo"]].map(([v,label]) => (
              <button key={v} onClick={() => {
                setView(v);
                // Clicking the Style Me nav always opens the generator
                // panel — matches the home CTA behavior so there's no
                // dead-end landing on the Style view with no panel open.
                if (v === "style") setStylePanelOpen(true);
              }}
                style={{...s.navBtn, ...(view===v ? s.navActive : {})}}>
                {label}
                {v === "style" && styling && (
                  <span
                    style={{
                      display: "inline-block",
                      marginLeft: 6,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--color-accent)",
                      animation: "pulse 1.4s ease-in-out infinite",
                      verticalAlign: "middle",
                    }}
                    title="Styling in background"
                  />
                )}
              </button>
            ))}
            <button
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              style={s.navBtn}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              <Icon path={theme === "dark" ? icons.sun : icons.moon} size={15}/>
            </button>
            <button onClick={() => setView("settings")}
              style={{...s.navBtn, ...(view==="settings" ? s.navActive : {})}}>
              <Icon path={icons.settings} size={15}/>
            </button>
          </nav>
        </div>
      </header>

      <Suspense fallback={<RouteFallback/>}>
      {/* ── CLOSET ── */}
      {view === "home" && (
        <div style={s.page}>
          <div style={{ ...s.pageHeader, justifyContent: "center" }}>
            <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Atelier</h2>
          </div>
          <HomeView
            items={items}
            onOpenPlanner={() => setView("planner")}
            onOpenStyle={() => { setView("style"); setStylePanelOpen(true); }}
            onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
            onStyleItem={(item) => {
              setRequest(`Style around my ${item.name}`);
              setView("style");
              setStylePanelOpen(true);
            }}
          />
        </div>
      )}

      {view === "closet" && (
        <div style={s.page}>
          <FilterBar items={items} activeFilters={activeFilters} onChange={setActiveFilters}/>

          {/* Global search bar */}
          <div style={{ position:"relative", marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search by brand, color, item type..."
              value={closetSearch}
              onChange={e => setClosetSearch(e.target.value)}
              style={{
                width:"100%", padding:"10px 14px 10px 36px", boxSizing:"border-box",
                border:"1px solid var(--color-border)", borderRadius:8, fontSize:13,
                fontFamily:"'DM Sans',Inter,system-ui,sans-serif",
                background:"#FDFBF9", color:"#2C2420", outline:"none",
              }}
            />
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {closetSearch && (
              <button onClick={() => setClosetSearch("")}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                  background:"none", border:"none", color:"var(--color-text-muted)", cursor:"pointer", fontSize:16, padding:"0 4px" }}>
                ✕
              </button>
            )}
          </div>
          {closetSearch.trim() && (
            <div style={{ fontSize:11, color:"var(--color-text-muted)", marginBottom:8 }}>
              {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{closetSearch.trim()}"
            </div>
          )}

          {/* Sets visual grid view */}
          {isSetView && (<>
            {/* Sets search + filter bar */}
            <div style={ss.filterBar}>
              <div style={ss.searchRow}>
                <input
                  style={ss.searchInput}
                  placeholder="Search sets…"
                  value={setsSearch}
                  onChange={e => setSetsSearch(e.target.value)}
                />
                <select style={ss.sortSelect} value={setsSort} onChange={e => setSetsSort(e.target.value)}>
                  <option value="recent">Recently Created</option>
                  <option value="alpha">A – Z</option>
                  <option value="count">Most Items</option>
                </select>
              </div>
              <div style={ss.tagRow}>
                {SET_TAGS.map(tag => (
                  <button key={tag}
                    style={setsTagFilter === tag ? {...s.chip,...s.chipActive} : s.chip}
                    onClick={() => setSetsTagFilter(prev => prev === tag ? "" : tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Sets grid */}
            {setGroups?.length === 0 ? (
              <div style={s.empty}>
                <div style={s.emptyMark}>✦</div>
                <p style={s.emptyText}>
                  {setsSearch || setsTagFilter
                    ? "No sets match your search."
                    : "No coord sets yet. Link pieces as a set in Edit Item."}
                </p>
              </div>
            ) : (
              <>
                <div style={ss.countLabel}>{setGroups.length} set{setGroups.length !== 1 ? "s" : ""}</div>
                <div style={ss.grid}>
                  {setGroups.map((group, gi) => (
                    <SetCard
                      key={group.setId}
                      group={group}
                      index={gi}
                      onEdit={() => setEditingSet(group.setId)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Set Edit Modal */}
            {editingSet && (
              <SetEditModal
                setId={editingSet}
                meta={setsMeta[editingSet] || { name: "", tags: [] }}
                groupItems={items.filter(it => it.set_id === editingSet)}
                allItems={items}
                onSave={(data) => { updateSetMeta(editingSet, data); setEditingSet(null); }}
                onDelete={() => { deleteSetMeta(editingSet); setEditingSet(null); }}
                onClose={() => setEditingSet(null)}
                onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); setEditingSet(null); }}
                onAddItem={(item) => updateItem(item.id, { set_id: editingSet, is_separable: true })}
              />
            )}
          </>)}

          {/* Landing view: Recently Added + uncategorized when no filters active */}
          {!isSetView && !activeFilters.category?.length && !activeFilters.subcategory?.length && !activeFilters.color?.length && !activeFilters.brand?.length && !activeFilters.sets && !activeFilters.lastWorn && (() => {
            const now = Date.now();
            const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
            const recentItems = items
              .filter(it => it.created_at && (now - new Date(it.created_at).getTime()) < TWO_WEEKS)
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            // True uncategorized = missing top-level category. Subcategory is
            // not always available (Belts/Jumpsuits have no subcategory list
            // in taxonomy.js, so checking !it.subcategory left them stranded).
            const uncategorized = items.filter(it => !it.category);
            const showRecent = recentItems.length > 0;
            const showUncat = uncategorized.length > 0;
            if (!showRecent && !showUncat) return null;
            return (
              <div>
                {showRecent && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "var(--color-text-2)", marginBottom: 10, textTransform: "uppercase" }}>
                      Recently Added
                    </div>
                    <div style={s.grid}>
                      {recentItems.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}
                          onStyleItem={styleWithItem}/>
                      ))}
                    </div>
                  </div>
                )}
                {showUncat && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "var(--color-text-2)", marginBottom: 10, textTransform: "uppercase" }}>
                      Needs Categorizing
                    </div>
                    <div style={s.grid}>
                      {uncategorized.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}
                          onStyleItem={styleWithItem}/>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Regular grid — when a category/filter is selected OR search is active */}
          {!isSetView && (closetSearch.trim() || activeFilters.category?.length > 0 || activeFilters.subcategory?.length > 0 || activeFilters.color?.length > 0 || activeFilters.brand?.length > 0 || !!activeFilters.sets || !!activeFilters.lastWorn) && (filtered.length === 0 ? (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>No items match your filters.</p>
            </div>
          ) : (
            <div style={s.grid}>
              {filtered.map(item => (
                <ItemCard key={item.id} item={item} allItems={items}
                  onDelete={deleteItem}
                  onEdit={() => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
                  isFavorited={isFav("piece", item.id)}
                  onToggleFav={() => toggleFav("piece", item.id)}
                  onStyleItem={styleWithItem}/>
              ))}
            </div>
          ))}

          {/* Empty wardrobe state */}
          {items.length === 0 && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>Your wardrobe is empty — add your first piece.</p>
              <button style={s.btnPrimary} onClick={() => setView("add")}>
                <Icon path={icons.plus} size={15}/> Add Items
              </button>
            </div>
          )}

          {stylePanelNode}

          {/* FAB */}
          <button style={s.fab} onClick={() => setView("add")}>
            <Icon path={icons.plus} size={22}/>
          </button>
        </div>
      )}

      {/* ── ADD ── */}
      {view === "add" && (
        <BulkAddView onAdd={addItems} onBack={() => setView("closet")} rmbgKey={rmbgKey} apiKey={apiKey}/>
      )}

      {/* ── INSPIRATION ── */}
      {view === "inspiration" && (
        <InspirationView
          apiKey={apiKey}
          items={inspirations}
          setItems={setInspirations}
          onBack={() => setView("home")}/>
      )}

      {/* ── EDIT ── */}
      {view === "edit" && editItem && (
        <EditItemView
          item={editItem}
          allItems={items}
          setsMeta={setsMeta}
          rmbgKey={rmbgKey}
          onSave={async (fields) => {
            const result = await updateItem(editItem.id, fields);
            if (result?.ok) setView(editReturnView || "closet");
            return result;
          }}
          onDelete={() => { deleteItem(editItem.id); setView(editReturnView || "closet"); }}
          onBack={() => setView(editReturnView || "closet")}
          onStyleAround={(it) => { styleWithItem(it); setEditItem(null); }}/>
      )}

      {/* ── LOOKS ── */}
      {view === "style" && manualBuilderOpen && (
        <SilhouetteBuilder
          items={items}
          apiKey={apiKey}
          initialLook={editingPlan ? {
            // Synthetic "log shape" so SilhouetteBuilder's initialSelections
            // distribution picks the right slots. We carry the plan's
            // occasion/weather + saved canvas layout so the user's manual
            // arrangement isn't lost between edits.
            garment_ids: editingPlan.plan?.items || [],
            occasion:    editingPlan.plan?.occasion,
            weather:     editingPlan.plan?.weather,
            occasions:   editingPlan.plan?.occasions,
            weathers:    editingPlan.plan?.weathers,
            notes:       editingPlan.plan?.notes,
            layout_data: editingPlan.plan?.layout_data,
          } : null}
          initialSaveMode={editingPlan ? "schedule" : "looks"}
          initialScheduleDate={editingPlan?.iso || null}
          onSave={async (log) => {
            // Mirror SavedView's onSave: when SilhouetteBuilder set
            // editing_log_id (user opened an existing log via the Edit
            // affordance), PATCH that row rather than INSERTing — and either
            // way strip editing_log_id, which isn't a real column.
            const { editing_log_id, ...patch } = log;
            const result = editing_log_id
              ? await sb.updateOutfitLog(editing_log_id, patch)
              : await sb.saveOutfitLog(patch);
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
              savePlan({ date: log.date_worn, items: log.garment_ids || [], source: "worn", occasion: log.occasion || "Work", notes: null }).catch(() => {});
            }
            return Array.isArray(result) ? result[0] : result;
          }}
          onFavoriteLook={async (savedLog) => {
            const result = await sb.addFavorite("outfit", savedLog.id);
            setFavorites(prev => [...(Array.isArray(result) ? result : [result]), ...prev]);
          }}
          onSchedule={async (plan) => {
            // A planner/trip day stores its looks in the `outfits` JSONB array;
            // the calendar grid reads the legacy top-level `items` mirror.
            // Supabase's merge-duplicates upsert only writes the columns we
            // send, so a bare savePlan({date, items}) updates `items` but
            // leaves a STALE `outfits[]` behind — which made trip days keep
            // showing the previously generated look (read from outfits[]) even
            // though the calendar (read from items) updated. So we ALWAYS
            // reconcile against the existing row's outfits[] and write a
            // consistent payload, updating just the target outfit slot.
            try {
              const rows = await fetchPlansBetween(plan.date, plan.date);
              const existing = (Array.isArray(rows) && rows[0]) || null;
              const current = outfitsOf(existing);
              // tripOutfitIdx identifies which outfit on a multi-look day is
              // being edited; a plain planner-day edit targets the primary (#0).
              const idx = editingPlan?.tripOutfitIdx ?? 0;
              if (current.length === 0) {
                current.push({ id: newOutfitId(), label: "", occasion: plan.occasion || null, items: plan.items || [] });
              } else if (current[idx]) {
                current[idx] = { ...current[idx], items: plan.items || [], occasion: current[idx].occasion || plan.occasion || null };
              } else {
                current.push({ id: newOutfitId(), label: "", occasion: plan.occasion || null, items: plan.items || [] });
              }
              const isTrip = editingPlan?.tripOutfitIdx != null || existing?.source === "trip";
              const merged = buildPlanPayload({
                date: plan.date,
                outfits: current,
                source: existing?.source || (isTrip ? "trip" : plan.source) || "planner",
                notes: existing?.notes ?? plan.notes ?? null,
                weather: existing?.weather ?? plan.weather ?? null,
                activity: existing?.activity ?? null,
                day_label: existing?.day_label ?? null,
              });
              // Persist the manual canvas arrangement for the primary outfit
              // (the only slot whose layout currently round-trips at the row).
              if (idx === 0 && plan.layout_data) merged.layout_data = plan.layout_data;
              else if (existing?.layout_data) merged.layout_data = existing.layout_data;
              await savePlan(merged);
            } catch {
              // Last-resort fallback so a fetch hiccup still saves *something*.
              await savePlan(plan);
            }
          }}
          onClose={() => {
            setManualBuilderOpen(false);
            setEditingPlan(null);
            // Return to whatever view opened the builder (Saved, Planner,
            // etc.). Clear the saved return so the next opener can set it.
            if (builderReturnView && builderReturnView !== "style") {
              setView(builderReturnView);
            }
            setBuilderReturnView(null);
          }}
        />
      )}

      {view === "style" && !manualBuilderOpen && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Your Looks</h2>
            <button
              onClick={() => setManualBuilderOpen(true)}
              style={{...s.btnSecondary, padding:"6px 12px", fontSize:12, marginLeft:"auto"}}>
              Build manually
            </button>
          </div>
          {styling === true && (
            <div style={s.empty}>
              <span style={s.spinner}/>
              <p style={s.emptyText}>Styling your wardrobe…</p>
            </div>
          )}
          {styling === "partial" && (
            <div style={{display:"flex", alignItems:"center", gap:8, padding:"6px 16px 2px", fontSize:12, color:"var(--color-text-muted)"}}>
              <span style={s.spinner}/>
              Generating more looks…
            </div>
          )}
          {outfits && outfits.map((look, i) => (
            <LookCard key={i} look={look} items={items}
              onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
              onRate={async (lk, rating) => {
                try {
                  const itemIds = (lk.items || []).map(it => typeof it === "object" ? it.id : it);
                  await saveLookFeedback({
                    lookHash: lookHash({ occasion: lk.occasion || occasion, itemIds, mood }),
                    rating,
                    itemIds,
                    occasion: lk.occasion || occasion,
                    mood: mood || null,
                  });
                  // refresh aggregate scores so next generation reflects the new rating
                  const scores = await fetchItemFeedbackScores().catch(() => null);
                  if (scores) setFeedbackScores(scores);
                } catch (err) {
                  console.warn("[F2] saveLookFeedback failed:", err);
                }
              }}
              onSaveLook={async (log) => {
                await sb.saveOutfitLog(log);
                const dateWorn = log.date_worn;
                const ids = log.garment_ids || [];
                if (dateWorn) {
                  await Promise.all(ids.map(id => sb.updateItemLastWorn(id, dateWorn)));
                  bumpWearCounts(ids); // F6 — track wear count
                  const updated = items.map(it =>
                    ids.includes(it.id)
                      ? {...it, last_worn: dateWorn, wear_count: (it.wear_count || 0) + 1}
                      : it
                  );
                  persistItems(updated);
                }
                flashSync("synced");
              }}
              onStyleItem={(it) => {
                setRequest(`use my ${it.color ? it.color + " " : ""}${it.subcategory || it.category} "${it.name}"`);
                setStylePanelOpen(true);
              }}/>
          ))}
          {/* "Style 2 more" — show once we have at least one look but fewer
              than 3, and no generation is in flight. Lets the user stretch
              the first-look-fast flow into the full 3-up when they want it. */}
          {outfits && outfits.length > 0 && outfits.length < 3 && !styling && (
            <button
              onClick={handleStyleMore}
              style={{
                ...s.btnSecondary,
                width: "100%",
                padding: "12px 16px",
                marginTop: 12,
                fontSize: 13,
                letterSpacing: "0.06em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}>
              <Icon path={icons.sparkle} size={14}/> Style {3 - outfits.length} more
            </button>
          )}
          {!outfits && !styling && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>Ready when you are — pick an occasion and generate your first looks.</p>
              <button style={{...s.btnPrimary, padding:"12px 24px"}}
                onClick={() => setStylePanelOpen(true)}>
                <Icon path={icons.sparkle} size={15}/> Open Style Me
              </button>
              <button style={{...s.btnSecondary, padding:"10px 20px", marginTop:10}}
                onClick={() => setManualBuilderOpen(true)}>
                Build a look manually
              </button>
            </div>
          )}
          {stylePanelNode}
        </div>
      )}

      {/* ── COLOR ADVISOR ── */}
      {view === "color" && (
        <ColorAdvisorView items={items} apiKey={apiKey} onBack={() => setView("settings")}/>
      )}

      {/* ── PLANNER (F3) ── */}
      {view === "planner" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Planner</h2>
          </div>
          <PlannerWrapper
            items={items}
            apiKey={apiKey}
            onGoToStyleMe={() => setView("style")}
            onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
            onEditPlan={(iso, plan) => {
              setEditingPlan({ iso, plan });
              setBuilderReturnView(viewRef.current);
              setManualBuilderOpen(true);
              setView("style");
            }}
            onBuildDay={(iso, existingIds, tripOutfitIdx = null) => {
              // tripOutfitIdx is set when Build is opened from a specific
              // outfit on a trip-detail day. We carry it through editingPlan
              // so the save path can update outfits[idx] in the JSONB array
              // instead of overwriting the legacy `items` column (which the
              // trip view doesn't read from when outfits[] is present).
              setEditingPlan({ iso, plan: { date: iso, items: existingIds }, tripOutfitIdx });
              setBuilderReturnView(viewRef.current);
              setManualBuilderOpen(true);
              setView("style");
            }}
          />
        </div>
      )}

      {/* ── SAVED (Looks / History / Favorites) ── */}
      {view === "favorites" && (
        <SavedView
          items={items}
          apiKey={apiKey}
          favorites={favorites}
          toggleFav={toggleFav}
          isFav={isFav}
          onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
          onDeleteLog={async (id) => { await sb.deleteOutfitLog(id); }}
          onUnlog={async (log) => {
            // F6 — decrement wear counts when unlogging. Callers pass the
            // full log object so we don't have to refetch the entire table
            // to find garment_ids / date_worn for a single row.
            const ids = log?.garment_ids || [];
            const dateWorn = log?.date_worn;
            await sb.updateOutfitLog(log.id, { date_worn: null });
            unbumpWearCounts(ids);
            // Clear the matching planner pin (if it was created by the
            // wear-log auto-pin and hasn't been overwritten manually).
            if (dateWorn) deletePlan(dateWorn).catch(() => {});
            const updated = items.map(it =>
              ids.includes(it.id) ? {...it, wear_count: Math.max(0, (it.wear_count || 0) - 1)} : it
            );
            persistItems(updated);
          }}
          onLogAsWorn={async (log, date) => {
            await sb.updateOutfitLog(log.id, { date_worn: date });
            const ids = log?.garment_ids || [];
            await Promise.all(ids.map(gid => sb.updateItemLastWorn(gid, date)));
            bumpWearCounts(ids); // F6
            // Pin this look to the planner on the date worn so the calendar
            // reflects what she actually wore (user request: "items I mark
            // as worn, put them on the calendar on the date that I wore them").
            savePlan({ date, items: ids, source: "worn", occasion: log?.occasion || "Work", notes: null }).catch(() => {});
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: date, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onWearAgain={async (log) => {
            const today = new Date().toISOString().slice(0, 10);
            const newLog = {
              garment_ids: log.garment_ids,
              date_worn: today,
              occasion: log.occasion,
              notes: null,
              collage_url: log.collage_url,
            };
            await sb.saveOutfitLog(newLog);
            const ids = log.garment_ids || [];
            await Promise.all(ids.map(id => sb.updateItemLastWorn(id, today)));
            bumpWearCounts(ids); // F6
            // Mirror the wear onto the planner calendar.
            savePlan({ date: today, items: ids, source: "worn", occasion: log.occasion || "Work", notes: null }).catch(() => {});
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: today, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onSaveLook={async (log) => {
            // Update path — SilhouetteBuilder set editing_log_id when the
            // user opened an existing saved look via the Edit affordance.
            if (log.editing_log_id) {
              const { editing_log_id, ...patch } = log;
              const result = await sb.updateOutfitLog(editing_log_id, patch);
              return Array.isArray(result) ? result[0] : result;
            }
            const result = await sb.saveOutfitLog(log);
            // F6 — if the save included date_worn, bump counts too
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
              // Pin to the planner on the date worn.
              savePlan({ date: log.date_worn, items: log.garment_ids || [], source: "worn", occasion: log.occasion || "Work", notes: null }).catch(() => {});
            }
            return Array.isArray(result) ? result[0] : result;
          }}
          onFavoriteLook={async (savedLog) => {
            const result = await sb.addFavorite("outfit", savedLog.id);
            setFavorites(prev => [...(Array.isArray(result) ? result : [result]), ...prev]);
          }}
          onSchedule={async (plan) => {
            await savePlan(plan);
          }}
          onStyleItem={(it) => {
            setRequest(`use my ${it.color ? it.color + " " : ""}${it.subcategory || it.category} "${it.name}"`);
            setView("style");
            setStylePanelOpen(true);
          }}
          onBuildSimilar={buildSimilarLook}
        />
      )}

      {/* ── INSIGHTS ── */}
      {view === "insights" && (
        <StyleInsightsView items={items} apiKey={apiKey} onBack={() => setView("settings")}/>
      )}

      {/* ── SHOPPING ── */}
      {view === "shop" && (
        <ShoppingView items={items} apiKey={apiKey} onBack={() => setView("settings")}/>
      )}

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <SettingsView
          apiKey={apiKey}
          rmbgKey={rmbgKey}
          items={items}
          onUpdateItem={updateItem}
          onSave={(k, rk, opts = {}) => {
            saveApiKey(k);  setApiKey(k);
            saveRmbgKey(rk); setRmbgKey(rk);
            sb.saveSettings({ anthropicKey: k, rmbgKey: rk }).catch(() => {});
            // Auto-save (silent) doesn't navigate; only the explicit
            // Save Settings button bounces back to closet.
            if (!opts.silent) setView("closet");
          }}
          onAddItems={addItems}
          onForceSync={forceSyncAll}
          styleFingerprint={styleFingerprint}
          setStyleFingerprint={setStyleFingerprint}
          onNavigate={setView}
          onBack={() => setView("closet")}/>
      )}
      </Suspense>
    </div>
  );
}
