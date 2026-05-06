import { useState, useEffect, useCallback, useRef } from "react";
import { buildStylingPrompt } from "./prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory } from "./utils/closet-sampler.js";
import { generateValidatedLooks, ValidationError } from "./utils/styling-validator.js";
import { getRecentlySuggestedItems, recordGeneration, loadSuggestionCounts } from "./utils/rotation-tracker.js";
import { generateContactSheets } from "./utils/contact-sheet.js";
import { autoDetectItem } from "./lib/anthropic.js";
import { stripBackground } from "./lib/bgRemoval.js";
import { applyDetection } from "./features/closet/applyDetection.js";
import { MOODS, moodPromptFor } from "./features/stylist/moods.js";
import { saveLookFeedback, fetchItemFeedbackScores, lookHash } from "./features/stylist/feedback.js";
import { savePlan } from "./features/planner/plannerApi.js";
import { bumpWearCounts, unbumpWearCounts, costPerWear } from "./features/wear/wearApi.js";
import HomeView from "./features/home/HomeView.jsx";
import { s, si, ss } from "./ui/styles.js";
import { icons, Icon } from "./ui/icons.jsx";
import {
  CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, CATEGORIES, SET_TAGS, OCCASIONS, getSubcatL2, normalizeOccasion,
} from "./constants/taxonomy.js";
import {
  getSleeveType, filterByWeather, colorSortIdx, defaultSortComparator,
  normalizeItem, mergeItems, shuffle,
} from "./utils/item-helpers.js";
import {
  STORAGE_KEY, API_KEY_STORE, RMBG_KEY_STORE, SETS_META_KEY,
  THEME_KEY, RECENT_LOOKS_KEY,
  loadLocalItems, saveLocalItems, loadApiKey, saveApiKey, loadRmbgKey, saveRmbgKey,
  loadSetsMeta, saveSetsMeta, loadStylePrefs, loadAboutMe,
  migrateLocalStorage, reconcilePendingSyncFlag,
} from "./utils/storage.js";
import { compressImage } from "./utils/images.js";
import { sb } from "./lib/supabase.js";
import { migrateImages, migrateAndSync } from "./lib/migrate.js";
import {
  generateOutfit, classifyKnitAI, analyzeColorAI,
} from "./lib/ai/stylist.js";
import SettingsView from "./components/SettingsView.jsx";
import StyleInsightsView from "./components/StyleInsightsView.jsx";
import ShoppingView from "./components/ShoppingView.jsx";
import SavedView from "./components/SavedView.jsx";
import PlannerWrapper from "./components/PlannerWrapper.jsx";
import ColorAdvisorView from "./components/ColorAdvisorView.jsx";
import FilterBar from "./components/FilterBar.jsx";
import SetCard from "./components/SetCard.jsx";
import SetEditModal from "./components/SetEditModal.jsx";
import ItemCard from "./components/ItemCard.jsx";
import BulkAddView from "./components/BulkAddView.jsx";
import EditItemView from "./components/EditItemView.jsx";
import LookCard from "./components/LookCard.jsx";
import SilhouetteBuilder from "./features/builder/SilhouetteBuilder.jsx";

// Rename any pre-namespace localStorage keys from older app builds. Runs once
// per browser; no-op afterward. Must fire before any load*() helpers below.
migrateLocalStorage();

// Mark every existing local item as `pending_sync: true` once, so the new
// delete-protection merge (which drops local-only items without that flag)
// doesn't discard pre-existing unsynced data on first reload. No-op after.
reconcilePendingSyncFlag();



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
  // Weather is a Set so user can combine "Hot + Rainy" or "Cold + Rainy".
  // Empty Set === "Any". Stored as Set in state, joined to a string when
  // passed downstream so older filter/prompt code keeps working.
  const [weather,    setWeather]    = useState(() => new Set());
  const [mood,       setMood]       = useState(""); // F2 — mood tag key
  const [request,    setRequest]    = useState("");
  const [styleExcludes, setStyleExcludes] = useState(new Set()); // user-toggled exclusions
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [manualBuilderOpen, setManualBuilderOpen] = useState(false);
  const [feedbackScores, setFeedbackScores] = useState({});    // F2 — aggregate item scores
  const [recentlyWornItems, setRecentlyWornItems] = useState([]); // F2 — item IDs worn in last 3 days
  const [apiKey,     setApiKey]     = useState(() => loadApiKey());
  const [rmbgKey,    setRmbgKey]    = useState(() => loadRmbgKey());
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | synced | error
  const [editItem,   setEditItem]   = useState(null);
  const [closetSearch, setClosetSearch] = useState("");  // global closet search
  const [favorites,  setFavorites]  = useState([]);
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

        // Push up only the local-only items still flagged pending_sync.
        // Without this filter, an aggressive "sync everything local" would
        // re-create items that another device legitimately deleted.
        const sbIds = new Set(sbItems.map(it => it.id));
        const pendingLocalOnly = freshLocal.filter(it => !sbIds.has(it.id) && it.pending_sync);
        if (pendingLocalOnly.length > 0) {
          migrateAndSync(pendingLocalOnly, setItems, flashSync);
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
  useEffect(() => {
    const local = loadLocalItems();
    if (local.length > 0) setItems(local);

    sb.ensureBucket().catch(() => {});
    sb.fetchFavorites().then(setFavorites).catch(() => {});

    // F2 — load aggregate feedback scores so sampler can weight future picks
    fetchItemFeedbackScores().then(setFeedbackScores).catch(() => {});

    // F2 — compute items worn in last 3 days from outfit_logs
    sb.fetchOutfitLogs().then(logs => {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const ids = new Set();
      (logs || []).forEach(log => {
        if (log.date_worn && log.date_worn >= cutoff) {
          (log.garment_ids || []).forEach(id => ids.add(id));
        }
      });
      setRecentlyWornItems([...ids]);
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
    const updated = items.map(it => it.id === id ? {...it, ...resolvedFields} : it);
    persistItems(updated);
    flashSync("syncing");
    try {
      const item = updated.find(it => it.id === id);
      await sb.upsert(item);
      if (imageUploadFailed) {
        flashSync("error");
        alert("⚠️ Your changes were saved, but the photo failed to upload. The photo is stored locally — try editing the item again or use Settings → Force Sync.");
      } else {
        flashSync("synced");
      }
    } catch(e) {
      console.error("Failed to update item in Supabase:", e);
      flashSync("error");
    }
  }, [items, persistItems]);

  // Force-sync ALL items currently in React state to Supabase — used after bulk upload failures
  // Reads from live state (has base64 images), uploads them, saves URLs back
  const forceSyncAll = useCallback(async (onProgress) => {
    flashSync("syncing");
    let done = 0, failed = 0, imgFailed = 0;
    const updated = [...items];
    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      try {
        let toSave = item;
        if (item.image?.startsWith("data:")) {
          try {
            const url = await sb.uploadImage(item.id, item.image);
            toSave = { ...item, image: url };
            updated[i] = toSave;
            setItems(prev => prev.map(it => it.id === toSave.id ? toSave : it));
          } catch (imgErr) {
            console.error("Force sync image upload failed for", item.name, imgErr);
            imgFailed++;
          }
        }
        await sb.upsert(toSave);
        done++;
      } catch { failed++; }
      if (onProgress) onProgress(i + 1, updated.length, failed);
      await new Promise(r => setTimeout(r, 150));
    }
    saveLocalItems(updated);
    const anyProblems = failed > 0 || imgFailed > 0;
    anyProblems ? flashSync("error") : flashSync("synced");
    if (imgFailed > 0) {
      setTimeout(() => alert(`⚠️ ${imgFailed} photo(s) failed to upload to cloud storage. Item data was saved but those photos are only stored locally.`), 300);
    }
    return { done, failed };
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

  const normalizeLooks = (looks, fallbackOccasion) => looks.map(look => ({
    ...look,
    items: (look.items || []).map(item =>
      typeof item === "object" ? item.id : String(item).replace(/^ID:/i, "").trim()
    ),
    itemRoles: (look.items || []).reduce((acc, item) => {
      if (typeof item === "object" && item.id && item.role) acc[item.id] = item.role;
      return acc;
    }, {}),
    mood: look.vibe || look.mood || "",
    occasion: look.occasion || fallbackOccasion,
    styling: look.rationale || look.styling || "",
    colorStory: look.color_strategy || look.colorStory || "",
    reasoning: look.rationale || look.reasoning || "",
  }));

  // Join the multi-weather Set into a single label the downstream code
  // already understands ("Hot (85°F+) + Rainy"). The filter / prompt parse
  // each word independently, so this is the cleanest bridge.
  const weatherLabel = [...weather].join(" + ");

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null);
    let streamedAny = false;
    try {
      const onLook = (look) => {
        const normalized = normalizeLooks([look], occasion);
        setOutfits(prev => [...(prev || []), ...normalized]);
        if (!streamedAny) {
          streamedAny = true;
          setView("style");
          setStyling("partial"); // switch from full-page spinner to subtle banner
        }
      };
      const result = await generateOutfit(items, occasion, weatherLabel, request, apiKey, allLooks, loadStylePrefs(), loadAboutMe(), styleExcludes, { mood, feedbackScores, recentlyWornItems, onLook });
      const looks = result?.looks;
      if (!looks || !Array.isArray(looks) || looks.length === 0) {
        throw new Error("AI returned no looks — try again.");
      }
      // Replace streamed looks with the final validated set (may differ if retry happened)
      const normalizedLooks = normalizeLooks(looks, occasion);
      setOutfits(normalizedLooks);
      setAllLooks(prev => [...prev, ...normalizedLooks].slice(-30));
      setView("style");
    } catch(e) {
      setStyleErr(e.message || "Styling failed — check your API key.");
      console.error("Generation error:", e);
    } finally { setStyling(false); }
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
    // Sleeve length filter — uses subcategory mapping for Tops, sleeve_length field for Dresses
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
        if (it.category === "Dresses") return (it.sleeve_length || "").toLowerCase() === sl.toLowerCase();
        return true;   // don't filter non-Tops/Dresses items
      });
    }
    if (activeFilters.brand?.length)  base = base.filter(it => activeFilters.brand.includes(it.brand));
    if (activeFilters.color?.length) {
      base = base.filter(it => {
        const itemColor = (it.color || "").toLowerCase();
        const itemFamily = (it.color_family || "").toLowerCase();
        return activeFilters.color.some(c => {
          const cl = c.toLowerCase();
          return itemColor.includes(cl) || itemFamily.includes(cl) || itemColor === cl;
        });
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
        const fields = [it.name, it.brand, it.color, it.color_family, it.subcategory, it.category, it.notes].filter(Boolean);
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

          {/* WHAT'S THE WEATHER? — multi-select. Temperature chips are
              mutually exclusive (Hot xor Cold etc.); Rainy is a separate
              modifier so "Cold + Rainy" / "Hot + Rainy" / "Warm + Rainy"
              all work. Empty = Any. */}
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
              const toggleRainy = () => setWeather(prev => {
                const next = new Set(prev);
                if (next.has("Rainy")) next.delete("Rainy"); else next.add("Rainy");
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
                  <button
                    style={weather.has("Rainy")
                      ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                      : {...s.chip, fontSize:11, padding:"5px 11px"}}
                    onClick={toggleRainy}>
                    + Rainy
                  </button>
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
              ✦ Items matching your request will be force-included in look 1.
            </div>
          )}

          {styleErr && <p style={s.err}>{styleErr}</p>}
          <button style={{...s.btnPrimary, width:"100%"}}
            onClick={() => { handleStyle(); }}
            disabled={styling}>
            {styling
              ? <><span style={s.spinnerSm}/> Styling…</>
              : <><Icon path={icons.sparkle} size={15}/> Generate 3 Looks</>}
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
      `}</style>

      {/* ── HEADER ── */}
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.brand}>
            <span style={s.brandMark}>✦</span>
            <span style={s.brandName}>ATELIER</span>
            {syncLabel && (
              <span
                style={{...s.savedPill, background: syncColor, cursor: syncStatus === "error" ? "pointer" : "default"}}
                title={syncStatus === "error" ? "Tap to retry loading your wardrobe" : undefined}
                onClick={syncStatus === "error" ? reloadFromSupabase : undefined}
              >{syncStatus === "error" ? "⚠ offline — tap to retry" : syncLabel}</span>
            )}
          </div>
          <nav style={s.nav}>
            {[["home","Home"],["closet","Closet"],["style","Style Me"],["planner","Planner"],["favorites","Saved"]].map(([v,label]) => (
              <button key={v} onClick={() => {
                setView(v);
                // Clicking the Style Me nav always opens the generator
                // panel — matches the home CTA behavior so there's no
                // dead-end landing on the Style view with no panel open.
                if (v === "style") setStylePanelOpen(true);
              }}
                style={{...s.navBtn, ...(view===v ? s.navActive : {})}}>
                {label}
                {v==="closet" && items.length > 0 &&
                  <span style={s.badge}>{items.length}</span>}
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
            onEditItem={(item) => { setEditItem(item); setView("edit"); }}
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
                onEditItem={(item) => { setEditItem(item); setView("edit"); setEditingSet(null); }}
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
            const uncategorized = items.filter(it => !it.subcategory);
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
                          onEdit={() => { setEditItem(item); setView("edit"); }}
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
                          onEdit={() => { setEditItem(item); setView("edit"); }}
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
                  onEdit={() => { setEditItem(item); setView("edit"); }}
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

      {/* ── EDIT ── */}
      {view === "edit" && editItem && (
        <EditItemView
          item={editItem}
          allItems={items}
          setsMeta={setsMeta}
          onSave={(fields) => { updateItem(editItem.id, fields); setView("closet"); }}
          onDelete={() => { deleteItem(editItem.id); setView("closet"); }}
          onBack={() => setView("closet")}/>
      )}

      {/* ── LOOKS ── */}
      {view === "style" && manualBuilderOpen && (
        <SilhouetteBuilder
          items={items}
          apiKey={apiKey}
          onSave={async (log) => {
            const result = await sb.saveOutfitLog(log);
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
            }
            return Array.isArray(result) ? result[0] : result;
          }}
          onFavoriteLook={async (savedLog) => {
            const result = await sb.addFavorite("outfit", savedLog.id);
            setFavorites(prev => [...(Array.isArray(result) ? result : [result]), ...prev]);
          }}
          onSchedule={async (plan) => { await savePlan(plan); }}
          onClose={() => setManualBuilderOpen(false)}
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
              onEditItem={(item) => { setEditItem(item); setView("edit"); }}
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
        <ColorAdvisorView items={items} apiKey={apiKey}/>
      )}

      {/* ── PLANNER (F3) ── */}
      {view === "planner" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Planner</h2>
          </div>
          <PlannerWrapper items={items} onGoToStyleMe={() => setView("style")} onEditItem={(item) => { setEditItem(item); setView("edit"); }}/>
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
          onEditItem={(item) => { setEditItem(item); setView("edit"); }}
          onDeleteLog={async (id) => { await sb.deleteOutfitLog(id); }}
          onUnlog={async (id) => {
            // F6 — decrement wear counts when unlogging
            const log = (await sb.fetchOutfitLogs()).find(l => l.id === id);
            const ids = log?.garment_ids || [];
            await sb.updateOutfitLog(id, { date_worn: null });
            unbumpWearCounts(ids);
            const updated = items.map(it =>
              ids.includes(it.id) ? {...it, wear_count: Math.max(0, (it.wear_count || 0) - 1)} : it
            );
            persistItems(updated);
          }}
          onLogAsWorn={async (id, date) => {
            await sb.updateOutfitLog(id, { date_worn: date });
            // Also update per-item last_worn so rotation tracking sees the wear
            const log = (await sb.fetchOutfitLogs()).find(l => l.id === id);
            const ids = log?.garment_ids || [];
            await Promise.all(ids.map(gid => sb.updateItemLastWorn(gid, date)));
            bumpWearCounts(ids); // F6
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
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: today, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onSaveLook={async (log) => {
            const result = await sb.saveOutfitLog(log);
            // F6 — if the save included date_worn, bump counts too
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
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
        />
      )}

      {/* ── INSIGHTS ── */}
      {view === "insights" && (
        <StyleInsightsView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SHOPPING ── */}
      {view === "shop" && (
        <ShoppingView items={items} apiKey={apiKey} onBack={() => setView("closet")}/>
      )}

      {/* ── SETTINGS ── */}
      {view === "settings" && (
        <SettingsView
          apiKey={apiKey}
          rmbgKey={rmbgKey}
          items={items}
          onUpdateItem={updateItem}
          onSave={(k, rk) => {
            saveApiKey(k);  setApiKey(k);
            saveRmbgKey(rk); setRmbgKey(rk);
            sb.saveSettings({ anthropicKey: k, rmbgKey: rk }).catch(() => {});
            setView("closet");
          }}
          onAddItems={addItems}
          onForceSync={forceSyncAll}
          onBack={() => setView("closet")}/>
      )}
    </div>
  );
}
