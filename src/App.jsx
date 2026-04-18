import { useState, useEffect, useCallback, useRef } from "react";
import { buildStylingPrompt } from "./prompts/styling-system-prompt.js";
import { sampleClosetItems, formatInventory } from "./utils/closet-sampler.js";
import { generateValidatedLooks, ValidationError } from "./utils/styling-validator.js";
import { getRecentlySuggestedItems, recordGeneration, loadSuggestionCounts } from "./utils/rotation-tracker.js";
import { generateContactSheets } from "./utils/contact-sheet.js";
import { autoDetectItem } from "./lib/anthropic.js";
import { stripBackground } from "./lib/bgRemoval.js";
import { applyDetection } from "./features/closet/applyDetection.js";
import { getLocalWeatherLabel } from "./lib/weather.js";
import { MOODS, moodPromptFor } from "./features/stylist/moods.js";
import { saveLookFeedback, fetchItemFeedbackScores, lookHash } from "./features/stylist/feedback.js";
import CalendarView from "./features/planner/CalendarView.jsx";
import SilhouetteBuilder from "./features/builder/SilhouetteBuilder.jsx";
import MoodboardView from "./features/moodboard/MoodboardView.jsx";
import WearView from "./features/wear/WearView.jsx";
import { bumpWearCounts, unbumpWearCounts, costPerWear } from "./features/wear/wearApi.js";
import HomeView from "./features/home/HomeView.jsx";
import { s, si, ss } from "./ui/styles.js";
import { icons, Icon } from "./ui/icons.jsx";
import {
  CATEGORY_ORDER, TAXONOMY, SUBCATEGORY_L3, CATEGORIES, SET_TAGS, OCCASIONS, getSubcatL2,
} from "./constants/taxonomy.js";
import {
  STYLE_PROFILE, CASUAL_STYLE_PROFILE, STYLING_PRINCIPLES, STYLE_PREFS,
  OCCASION_SLOTS, STYLING_STRATEGIES,
} from "./constants/styling.js";
import { COLOR_FAMILIES, COLOR_SORT_ORDER, SLEEVE_SORT, LENGTH_SORT, WEIGHT_SORT } from "./constants/color.js";
import {
  getSleeveType, filterByWeather, colorSortIdx, defaultSortComparator,
  normalizeItem, mergeItems, shuffle,
} from "./utils/item-helpers.js";
import {
  STORAGE_KEY, API_KEY_STORE, RMBG_KEY_STORE, SETS_META_KEY,
  loadLocalItems, saveLocalItems, loadApiKey, saveApiKey, loadRmbgKey, saveRmbgKey,
  loadSetsMeta, saveSetsMeta,
} from "./utils/storage.js";
import { compressImage, imageToBase64, removeBackground } from "./utils/images.js";
import { sb, SUPABASE_URL, SUPABASE_KEY, SB_HEADERS, STORAGE_HEADERS, BUCKET } from "./lib/supabase.js";
import {
  generateOutfit, generateElevation, classifyKnitAI, analyzeColorAI,
  generateStyleProfile, generateShoppingRecs, buildImgSource, colorHex,
} from "./lib/ai/stylist.js";
import ColorResultCard from "./components/ColorResultCard.jsx";
import ShoppingDimensionsCard from "./components/ShoppingDimensionsCard.jsx";
import FilterBar from "./components/FilterBar.jsx";
import ItemCard from "./components/ItemCard.jsx";
import { SetCard, SetEditModal, SetPanel } from "./components/Sets.jsx";
import EditorialCollage, { buildCollageLayout } from "./components/EditorialCollage.jsx";
import LookCard from "./components/LookCard.jsx";
import SaveLookModal from "./components/SaveLookModal.jsx";
import BulkAddView from "./components/BulkAddView.jsx";
import EditItemView from "./components/EditItemView.jsx";
import ColorAdvisorView from "./components/ColorAdvisorView.jsx";





// ── DARK WINTER COLOR SWATCHES ────────────────────────────────────────────────















// ── IMAGE MIGRATION HELPERS ───────────────────────────────────────────────────
// Upload base64 images from a list of items to Storage, update state + DB
async function migrateImages(items, setItemsFn, saveLocalFn) {
  for (const item of items) {
    try {
      const url = await sb.uploadImage(item.id, item.image);
      const updated = { ...item, image: url };
      await sb.upsert(updated);
      if (setItemsFn) {
        setItemsFn(prev => {
          const next = prev.map(it => it.id === item.id ? updated : it);
          saveLocalFn(next);
          return next;
        });
      }
    } catch {
      // Keep base64 as fallback if upload fails
    }
  }
}

// Upload images + push metadata to Supabase — processes sequentially to avoid rate limits
async function migrateAndSync(items, setItemsFn, flashSyncFn) {
  flashSyncFn("syncing");
  let failed = 0;
  for (const item of items) {
    try {
      let toSave = item;
      if (item.image?.startsWith("data:")) {
        try {
          const url = await sb.uploadImage(item.id, item.image);
          toSave = { ...item, image: url };
          if (setItemsFn) {
            setItemsFn(prev => prev.map(it => it.id === item.id ? toSave : it));
          }
        } catch { /* keep base64 in state, upsert without image */ }
      }
      await sb.upsert(toSave);
    } catch { failed++; }
    // Small pause between items to avoid rate limits
    await new Promise(r => setTimeout(r, 150));
  }
  failed > 0 ? flashSyncFn("error") : flashSyncFn("synced");
}

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
  const [filter,     setFilter]     = useState("All"); // legacy — still used for Sets view
  const [activeFilters, setActiveFilters] = useState({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const [outfits,    setOutfits]    = useState(null);
  const [outfitNotes, setOutfitNotes] = useState(null); // notes from AI when fewer than 3 looks
  const [allLooks,   setAllLooks]   = useState(() => {
    // Lazy-init from localStorage so anti-repeat history persists across sessions
    try {
      const raw = localStorage.getItem("atelier-recent-looks");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }); // history of all generated looks for anti-repeat
  const [styling,    setStyling]    = useState(false);
  const [styleErr,   setStyleErr]   = useState("");
  const [occasion,   setOccasion]   = useState("Work");
  const [weather,    setWeather]    = useState("");
  const [mood,       setMood]       = useState(""); // F2 — mood tag key
  const [request,    setRequest]    = useState("");
  const [styleExcludes, setStyleExcludes] = useState(new Set()); // user-toggled exclusions
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false); // F2 — auto-location fetch
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
    try { localStorage.setItem("atelier-recent-looks", JSON.stringify(allLooks)); } catch {}
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

        // Push ALL local items that are missing from Supabase (aggressive sync)
        const sbIds = new Set(sbItems.map(it => it.id));
        const localOnly = freshLocal.filter(it => !sbIds.has(it.id));
        if (localOnly.length > 0) {
          // Batch upsert local-only items to Supabase (this backfills missing data)
          migrateAndSync(localOnly, setItems, flashSync);
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

    // Load sets metadata from Supabase (falls back to localStorage)
    sb.fetchSets().then(sbSets => {
      if (sbSets && sbSets.length > 0) {
        const meta = { ...loadSetsMeta() };
        sbSets.forEach(s => { meta[s.id] = { name: s.name, tags: s.tags || [], created_at: s.created_at }; });
        setSetsMeta(meta);
        saveSetsMeta(meta);
      }
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
    const optimistic = [...items, ...newItems];
    setItems(optimistic);
    saveLocalItems(optimistic);
    flashSync("syncing");

    const BATCH = 5;
    const saved = [...items];
    let failedImages = [];
    let anyFailed = false;

    for (let i = 0; i < newItems.length; i += BATCH) {
      const batch = newItems.slice(i, i + BATCH);
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
          saved.push(toSave);
          setItems(prev => prev.map(it => it.id === toSave.id ? toSave : it));
        } catch(e) {
          console.error("Failed to save item to Supabase:", item.name, e);
          saved.push(item);
          anyFailed = true;
        }
      }));
      if (i + BATCH < newItems.length) await new Promise(r => setTimeout(r, 300));
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

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (items.length < 3) { setStyleErr(`Add at least 3 items first (you have ${items.length}).`); return; }
    setStyling(true); setStyleErr(""); setOutfits(null); setOutfitNotes(null);
    try {
      const result = await generateOutfit(items, occasion, weather, request, apiKey, allLooks, loadStylePrefs(), loadAboutMe(), styleExcludes, { mood, feedbackScores, recentlyWornItems });
      console.log("Generation result:", JSON.stringify(result).slice(0, 500));
      const looks = result?.looks;
      // Capture notes for partial results
      if (result?.notes) setOutfitNotes(result.notes);
      if (!looks || !Array.isArray(looks) || looks.length === 0) {
        // If notes explain why fewer than 3 looks, show that
        if (result?.notes) {
          throw new Error(result.notes);
        }
        throw new Error("AI returned no looks — try again.");
      }
      // Normalize items: new format uses {id, role} objects, legacy uses plain strings
      // Convert to flat ID arrays for compatibility with LookCard, SaveLookModal, etc.
      // but preserve the rich data on the look object for new UI fields
      const normalizedLooks = looks.map(look => ({
        ...look,
        // Flatten items to plain ID array for collage/save compatibility
        items: (look.items || []).map(item =>
          typeof item === "object" ? item.id : String(item).replace(/^ID:/i, "").trim()
        ),
        // Preserve item roles separately for the new UI
        itemRoles: (look.items || []).reduce((acc, item) => {
          if (typeof item === "object" && item.id && item.role) {
            acc[item.id] = item.role;
          }
          return acc;
        }, {}),
        // Map new fields to legacy fields for backward compatibility
        mood: look.vibe || look.mood || "",
        occasion: look.occasion || occasion,
        styling: look.rationale || look.styling || "",
        colorStory: look.color_strategy || look.colorStory || "",
        reasoning: look.rationale || look.reasoning || "",
      }));
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
  const syncColor = syncStatus === "error" ? "#C0392B"
    : syncStatus === "synced" ? "#3D7A4E" : "#C4A882";

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
              <button key={v} onClick={() => setView(v)}
                style={{...s.navBtn, ...(view===v ? s.navActive : {})}}>
                {label}
                {v==="closet" && items.length > 0 &&
                  <span style={s.badge}>{items.length}</span>}
              </button>
            ))}
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
            onOpenWear={() => setView("favorites")}
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
                border:"1px solid #E8E0D8", borderRadius:8, fontSize:13,
                fontFamily:"'DM Sans',Inter,system-ui,sans-serif",
                background:"#FDFBF9", color:"#2C2420", outline:"none",
              }}
            />
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
              stroke="#9A8E84" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {closetSearch && (
              <button onClick={() => setClosetSearch("")}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                  background:"none", border:"none", color:"#9A8E84", cursor:"pointer", fontSize:16, padding:"0 4px" }}>
                ✕
              </button>
            )}
          </div>
          {closetSearch.trim() && (
            <div style={{ fontSize:11, color:"#9A8E84", marginBottom:8 }}>
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
                      onOpen={() => {
                        // Navigate to view showing this set's items
                        setActiveFilters(f => ({ ...f, category: [], subcategory: [], sets: "Sets Only" }));
                        // We'll just open the edit modal for now
                        setEditingSet(group.setId);
                      }}
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
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "#6B5E54", marginBottom: 10, textTransform: "uppercase" }}>
                      Recently Added
                    </div>
                    <div style={s.grid}>
                      {recentItems.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}/>
                      ))}
                    </div>
                  </div>
                )}
                {showUncat && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "#6B5E54", marginBottom: 10, textTransform: "uppercase" }}>
                      Needs Categorizing
                    </div>
                    <div style={s.grid}>
                      {uncategorized.map(item => (
                        <ItemCard key={item.id} item={item} allItems={items}
                          onDelete={deleteItem}
                          onEdit={() => { setEditItem(item); setView("edit"); }}
                          isFavorited={isFav("piece", item.id)}
                          onToggleFav={() => toggleFav("piece", item.id)}/>
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
                  onToggleFav={() => toggleFav("piece", item.id)}/>
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

          {/* Style panel — collapsed = just the button, expanded = full controls */}
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
                    style={{background:"none", border:"none", color:"#9A8E84", fontSize:18, cursor:"pointer", padding:"0 4px", lineHeight:1}}>✕</button>
                </div>

                {/* WHERE ARE YOU GOING? — occasion pills */}
                <div style={{fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", marginBottom:6}}>WHERE ARE YOU GOING?</div>
                <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
                  {OCCASIONS.map(o => (
                    <button key={o}
                      style={occasion === o
                        ? {...s.chip, ...s.chipActive, fontSize:11, padding:"6px 12px"}
                        : {...s.chip, fontSize:11, padding:"6px 12px"}}
                      onClick={() => {
                        setOccasion(o);
                        // Auto-set smart defaults per occasion
                        if (o === "Interview" || o === "Executive") {
                          setStyleExcludes(new Set(["no-jeans","trousers-only"]));
                        } else if (o === "Work") {
                          setStyleExcludes(new Set(["no-jeans"]));
                        } else {
                          setStyleExcludes(new Set());
                        }
                      }}>
                      {o}
                    </button>
                  ))}
                </div>

                {/* WHAT'S THE WEATHER? */}
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6}}>
                  <div style={{fontSize:9, letterSpacing:"0.18em", color:"#9A8E84"}}>WHAT'S THE WEATHER?</div>
                  <button
                    onClick={async () => {
                      setWeatherLoading(true);
                      try {
                        const label = await getLocalWeatherLabel();
                        setWeather(label);
                      } catch (err) {
                        console.warn("[F2] auto-weather failed:", err);
                      } finally {
                        setWeatherLoading(false);
                      }
                    }}
                    disabled={weatherLoading}
                    style={{background:"none", border:"none", color:"#4A3E36", fontSize:10, letterSpacing:"0.1em", textDecoration:"underline", cursor:"pointer", padding:0}}>
                    {weatherLoading ? "locating…" : "✦ use my location"}
                  </button>
                </div>
                <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
                  {[
                    ["","Any"],["Hot (85°F+)","Hot"],["Warm (70-84°F)","Warm"],
                    ["Mild (55-69°F)","Mild"],["Cool (40-54°F)","Cool"],
                    ["Cold (below 40°F)","Cold"],["Rainy","Rainy"],
                  ].map(([val,label]) => (
                    <button key={val}
                      style={weather === val
                        ? {...s.chip, ...s.chipActive, fontSize:11, padding:"5px 11px"}
                        : {...s.chip, fontSize:11, padding:"5px 11px"}}
                      onClick={() => setWeather(val)}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* MOOD — F2 */}
                <div style={{fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", marginBottom:6}}>MOOD (OPTIONAL)</div>
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
                <div style={{fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", marginBottom:6}}>DON'T INCLUDE</div>
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
                        ? {...s.chip, background:"#C0392B", borderColor:"#C0392B", color:"#fff", fontSize:11, padding:"5px 11px", fontWeight:500}
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
                <input placeholder="Anything specific? (e.g. 'use my red blazer', 'all black', 'navy and brown')"
                  value={request} onChange={e=>setRequest(e.target.value)}
                  style={{...s.input, width:"100%", fontSize:12, marginBottom:8}}/>

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
      {view === "style" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Your Looks</h2>
          </div>
          {styling && (
            <div style={s.empty}>
              <span style={s.spinner}/>
              <p style={s.emptyText}>Styling your wardrobe…</p>
            </div>
          )}
          {/* Notes when fewer than 3 looks generated */}
          {outfitNotes && outfits && outfits.length < 3 && (
            <div style={{background:"#FDF8F0", border:"1px solid #E8D9BE", borderRadius:8, padding:"12px 16px", margin:"0 16px 16px", fontSize:12, color:"#6B4E1A", lineHeight:1.5}}>
              <span style={{fontWeight:600}}>Note:</span> {outfitNotes}
            </div>
          )}
          {outfits && outfits.map((look, i) => (
            <LookCard key={i} look={look} items={items} apiKey={apiKey}
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
              }}/>
          ))}
          {!outfits && !styling && (
            <div style={s.empty}>
              <p style={s.emptyText}>Go back and hit "Style Me" to generate looks.</p>
            </div>
          )}
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
          <PlannerWrapper items={items} onGoToStyleMe={() => setView("style")}/>
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
            await sb.saveOutfitLog(log);
            // F6 — if the save included date_worn, bump counts too
            if (log.date_worn) {
              bumpWearCounts(log.garment_ids || []);
            }
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

// ── SETTINGS VIEW ─────────────────────────────────────────────────────────────
const STYLE_PREFS_KEY = "atelier-style-prefs-v1";
function loadStylePrefs() {
  try { return JSON.parse(localStorage.getItem(STYLE_PREFS_KEY)) || STYLE_PREFS; }
  catch { return STYLE_PREFS; }
}
function saveStylePrefsLocal(prefs) { localStorage.setItem(STYLE_PREFS_KEY, JSON.stringify(prefs)); }

const ABOUT_ME_KEY = "atelier-about-me-v1";
function loadAboutMe() {
  try { return JSON.parse(localStorage.getItem(ABOUT_ME_KEY)) || {}; }
  catch { return {}; }
}
function saveAboutMe(data) { localStorage.setItem(ABOUT_ME_KEY, JSON.stringify(data)); }

function SettingsView({ apiKey, rmbgKey, onSave, onBack, items = [], onUpdateItem, onAddItems, onForceSync }) {
  const [key,          setKey]          = useState(apiKey);
  const [rmbg,         setRmbg]         = useState(rmbgKey);
  const [showK,        setShowK]        = useState(false);
  const [showR,        setShowR]        = useState(false);
  const [prefs,        setPrefs]        = useState(() => loadStylePrefs());
  const [newPair,      setNewPair]      = useState("");
  const [aboutMe,      setAboutMe]      = useState(() => loadAboutMe());
  const [aboutMeOpen,  setAboutMeOpen]  = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [fSyncRunning, setFSyncRunning] = useState(false);
  const [fSyncProg,    setFSyncProg]    = useState(null);
  const [fSyncDone,    setFSyncDone]    = useState(null);
  const [batchProgress,setBatchProgress]= useState({ done: 0, total: 0, errors: 0 });
  const [batchDone,    setBatchDone]    = useState(false);
  const batchStop = useRef(false);

  // ── Recover Lost Items state
  const [recoverOpen,    setRecoverOpen]    = useState(false);
  const [orphans,        setOrphans]        = useState([]);
  const [scanRunning,    setScanRunning]    = useState(false);
  const [scanDone,       setScanDone]       = useState(false);
  const [orphanMeta,     setOrphanMeta]     = useState({}); // { [imageId]: { name, category, subcategory, color_family } }
  const [aiCatRunning,   setAiCatRunning]   = useState(false);

  const handleScanStorage = async () => {
    setScanRunning(true); setScanDone(false); setOrphans([]);
    try {
      const [allImages, dbItems] = await Promise.all([sb.listStorageImages(), sb.fetchAll()]);
      const dbIds = new Set(dbItems.map(it => it.id));
      const found = allImages.filter(name => !dbIds.has(name));
      setOrphans(found);
      const initialMeta = {};
      found.forEach(id => { initialMeta[id] = { name: "Item", category: "Tops", subcategory: "", color_family: "" }; });
      setOrphanMeta(initialMeta);
    } catch(e) {
      console.error("Scan failed:", e);
    }
    setScanRunning(false); setScanDone(true);
  };

  const handleAiCategorize = async () => {
    if (!apiKey || orphans.length === 0) return;
    setAiCatRunning(true);
    for (const imageId of orphans) {
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
      try {
        let base64 = null;
        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          base64 = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          });
        } catch { /* skip if image can't be fetched */ }
        if (!base64) continue;
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-opus-4-5",
            max_tokens: 256,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
                { type: "text", text: `Look at this clothing item photo. Return JSON with: name (descriptive name), category (one of: Tops/Knits/Bottoms/Dresses/Sets/Jumpsuits/Loungewear/Athleisure/Outerwear/Occasionwear/Shoes/Accessories), subcategory (specific type), color_family (main color). Return only valid JSON.` },
              ],
            }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const text = aiData.content?.[0]?.text || "";
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              const parsed = JSON.parse(match[0]);
              setOrphanMeta(prev => ({ ...prev, [imageId]: {
                name: parsed.name || "Item",
                category: parsed.category || "Tops",
                subcategory: parsed.subcategory || "",
                color_family: parsed.color_family || "",
              }}));
            } catch { /* bad JSON, skip */ }
          }
        }
      } catch(e) {
        console.error("AI categorize failed for", imageId, e);
      }
    }
    setAiCatRunning(false);
  };

  const handleAddOrphan = async (imageId) => {
    const meta = orphanMeta[imageId] || {};
    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
    const newItem = {
      id: imageId,
      name: meta.name || "Item",
      category: meta.category || "Tops",
      subcategory: meta.subcategory || "",
      color_family: meta.color_family || "",
      image: imageUrl,
      created_at: new Date().toISOString(),
    };
    try {
      if (onAddItems) {
        await onAddItems([newItem]);
      } else {
        await sb.upsert(newItem);
      }
      setOrphans(prev => prev.filter(id => id !== imageId));
    } catch(e) {
      console.error("Failed to add orphan item:", e);
    }
  };

  const updatePrefs = (updated) => { setPrefs(updated); saveStylePrefsLocal(updated); };
  const updateAboutMe = (updated) => { setAboutMe(updated); saveAboutMe(updated); };

  const handleBatchBgRemoval = async () => {
    if (!rmbg) return;
    const toProcess = items.filter(it => it.image);
    if (!toProcess.length) return;
    batchStop.current = false;
    setBatchRunning(true); setBatchDone(false);
    setBatchProgress({ done: 0, total: toProcess.length, errors: 0 });
    let errors = 0;
    for (let i = 0; i < toProcess.length; i++) {
      if (batchStop.current) break;
      const item = toProcess[i];
      try {
        const base64 = await imageToBase64(item.image);
        const cleaned = await removeBackground(base64, rmbg);
        const compressed = await compressImage(cleaned, 600, 0.9, true);
        const url = await sb.uploadImage(item.id, compressed);
        if (onUpdateItem) await onUpdateItem(item.id, { image: url });
      } catch { errors++; }
      setBatchProgress({ done: i + 1, total: toProcess.length, errors });
    }
    setBatchRunning(false); setBatchDone(true);
  };
  const removePair  = (i) => updatePrefs({ ...prefs, colorPairs: prefs.colorPairs.filter((_, idx) => idx !== i) });
  const addPair     = () => {
    if (!newPair.trim()) return;
    updatePrefs({ ...prefs, colorPairs: [...prefs.colorPairs, newPair.trim()] });
    setNewPair("");
  };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={s.pageTitle}>Settings</h2>
      </div>

      {/* Anthropic key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}><Icon path={icons.key} size={16}/> Anthropic API Key</div>
        <p style={s.settingsSub}>
          Required to generate outfit looks. Stored locally on your device only.
        </p>
        <div style={{position:"relative"}}>
          <input type={showK?"text":"password"} placeholder="sk-ant-..."
            value={key} onChange={e=>setKey(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowK(v=>!v)}>
            {showK?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{color:"#1C1814"}}>console.anthropic.com</a>
        </p>
      </div>

      {/* Remove.bg key */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Remove.bg API Key</div>
        <p style={s.settingsSub}>
          Automatically removes backgrounds from clothing photos on upload. Free tier includes 50 images/month.
        </p>
        <div style={{position:"relative"}}>
          <input type={showR?"text":"password"} placeholder="your-removebg-key"
            value={rmbg} onChange={e=>setRmbg(e.target.value)}
            style={{...s.input,width:"100%",fontFamily:"monospace",fontSize:13,paddingRight:60}}/>
          <button style={s.showHideBtn} onClick={()=>setShowR(v=>!v)}>
            {showR?"hide":"show"}
          </button>
        </div>
        <p style={{...s.settingsSub,marginTop:6}}>
          Get your free key at <a href="https://www.remove.bg/api" target="_blank" rel="noreferrer" style={{color:"#1C1814"}}>remove.bg/api</a>
        </p>
      </div>

      {/* Style Preferences */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Style Preferences</div>
        <p style={s.settingsSub}>These are injected into every outfit generation.</p>

        <div style={s.fieldLabel}>Favorite color-blocking pairs</div>
        {prefs.colorPairs.map((pair, i) => (
          <div key={i} style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
            <span style={{flex:1, fontSize:12, color:"#4A3E36"}}>{pair}</span>
            <button onClick={() => removePair(i)} style={{background:"none",border:"none",color:"#C8BFB4",cursor:"pointer",fontSize:13}}>✕</button>
          </div>
        ))}
        <div style={{display:"flex", gap:8, marginTop:6, marginBottom:14}}>
          <input style={{...s.input, flex:1, fontSize:12}} placeholder="e.g. Navy + Cool Red"
            value={newPair} onChange={e => setNewPair(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addPair()}/>
          <button style={s.btnPrimary} onClick={addPair}>Add</button>
        </div>

        <div style={s.fieldLabel}>Style modes</div>
        {[["monochromaticMode","Monochromatic looks"],["tonalPairing","Tonal pairing (e.g. navy + powder blue)"]].map(([key,label]) => (
          <label key={key} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#4A3E36",cursor:"pointer",marginBottom:8}}>
            <input type="checkbox" checked={prefs[key]}
              onChange={e => updatePrefs({ ...prefs, [key]: e.target.checked })}/>
            {label}
          </label>
        ))}
      </div>

      {/* About Me */}
      <div style={s.settingsCard}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}} onClick={() => setAboutMeOpen(v => !v)}>
          <div style={s.settingsTitle}>✦ About Me</div>
          <span style={{fontSize:12, color:"#9A8E84"}}>{aboutMeOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </div>
        <p style={s.settingsSub}>Body descriptors + life context injected into outfit generation. Optional — add what's relevant.</p>
        {aboutMeOpen && (
          <div style={{marginTop:12}}>
            <div style={s.fieldLabel}>Height</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. 5'7&quot;"
              value={aboutMe.height || ""} onChange={e => updateAboutMe({...aboutMe, height: e.target.value})}/>

            <div style={s.fieldLabel}>Torso length</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Long torso, short legs"
              value={aboutMe.torsoLength || ""} onChange={e => updateAboutMe({...aboutMe, torsoLength: e.target.value})}/>

            <div style={s.fieldLabel}>Fit notes</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Prefer relaxed shoulders, avoid cropped"
              value={aboutMe.fitNotes || ""} onChange={e => updateAboutMe({...aboutMe, fitNotes: e.target.value})}/>

            <div style={s.fieldLabel}>Proportions</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Narrow shoulders, fuller hips"
              value={aboutMe.proportions || ""} onChange={e => updateAboutMe({...aboutMe, proportions: e.target.value})}/>

            <div style={s.fieldLabel}>Age range</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Late 30s"
              value={aboutMe.ageRange || ""} onChange={e => updateAboutMe({...aboutMe, ageRange: e.target.value})}/>

            <div style={s.fieldLabel}>Professional context</div>
            <input style={{...s.input, width:"100%", marginBottom:10}} placeholder="e.g. Creative director, client-facing, WFH 3 days/week"
              value={aboutMe.professionalContext || ""} onChange={e => updateAboutMe({...aboutMe, professionalContext: e.target.value})}/>
          </div>
        )}
      </div>

      {/* Batch Background Removal */}
      <div style={s.settingsCard}>
        <div style={s.settingsTitle}>✦ Retroactive Background Removal</div>
        <p style={s.settingsSub}>
          Re-processes all {items.filter(it=>it.image).length} wardrobe photos through Remove.bg to get transparent PNG backgrounds for cleaner collages. Uses 1 credit per item.
        </p>
        {!batchRunning && !batchDone && (
          <button style={{...s.btnPrimary, width:"100%"}} onClick={handleBatchBgRemoval}
            disabled={!rmbg || items.filter(it=>it.image).length === 0}>
            {!rmbg ? "Add Remove.bg key above first" : `Process All ${items.filter(it=>it.image).length} Photos`}
          </button>
        )}
        {batchRunning && (
          <div>
            <div style={{...s.auditProgressTrack, marginBottom:8}}>
              <div style={{...s.auditProgressBar, width:`${(batchProgress.done/batchProgress.total)*100}%`}}/>
            </div>
            <div style={{fontSize:11, color:"#6B5E54", marginBottom:8}}>
              {batchProgress.done} / {batchProgress.total} done
              {batchProgress.errors > 0 && ` · ${batchProgress.errors} skipped`}
            </div>
            <button style={{...s.btnPrimary, background:"#C0392B", width:"100%"}}
              onClick={() => { batchStop.current = true; }}>
              Stop
            </button>
          </div>
        )}
        {batchDone && (
          <div style={{fontSize:12, color:"#3D7A4E", fontWeight:500}}>
            ✓ Done — {batchProgress.done - batchProgress.errors} updated
            {batchProgress.errors > 0 && `, ${batchProgress.errors} skipped`}
            <button style={{...s.btnPrimary, width:"100%", marginTop:8}}
              onClick={() => { setBatchDone(false); setBatchProgress({done:0,total:0,errors:0}); }}>
              Run Again
            </button>
          </div>
        )}
      </div>

      <button style={{...s.btnPrimary,width:"100%"}}
        onClick={() => onSave(key, rmbg)} disabled={!key.trim()}>
        Save Settings
      </button>

      {/* Recover Lost Items */}
      <div style={{...s.settingsCard, marginTop:16}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer"}} onClick={() => setRecoverOpen(v => !v)}>
          <div style={s.settingsTitle}>✦ Recover Lost Items</div>
          <span style={{fontSize:12, color:"#9A8E84"}}>{recoverOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </div>
        <p style={s.settingsSub}>Scan Supabase Storage for photos that aren't linked to any wardrobe item.</p>
        {recoverOpen && (
          <div style={{marginTop:14}}>
            <div style={{display:"flex", gap:8, marginBottom:12, flexWrap:"wrap"}}>
              <button style={{...s.btnPrimary, flex:1}} onClick={handleScanStorage} disabled={scanRunning}>
                {scanRunning ? (
                  <><span style={s.spinnerSm}/>  Scanning...</>
                ) : "Scan Storage"}
              </button>
              {orphans.length > 0 && (
                <button style={{...s.btnPrimary, flex:1, background: aiCatRunning ? "#6B5E54" : "#1C1814"}}
                  onClick={handleAiCategorize} disabled={aiCatRunning || !apiKey}>
                  {aiCatRunning ? (
                    <><span style={s.spinnerSm}/>  Categorizing...</>
                  ) : apiKey ? "AI Categorize All" : "Add API key above"}
                </button>
              )}
            </div>
            {scanDone && orphans.length === 0 && (
              <div style={{fontSize:12, color:"#3D7A4E", fontWeight:500, marginBottom:8}}>
                No orphaned photos found — all storage images are linked to wardrobe items.
              </div>
            )}
            {orphans.length > 0 && (
              <div>
                <div style={{fontSize:12, color:"#6B5E54", marginBottom:10}}>
                  Found {orphans.length} unlinked photo{orphans.length !== 1 ? "s" : ""}. Fill in details and add to wardrobe.
                </div>
                <div style={{display:"flex", flexDirection:"column", gap:14}}>
                  {orphans.map(imageId => {
                    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/wardrobe-images/${imageId}`;
                    const meta = orphanMeta[imageId] || { name: "Item", category: "Tops" };
                    return (
                      <div key={imageId} style={{display:"flex", gap:12, alignItems:"flex-start", background:"#F5F1EC", borderRadius:8, padding:12}}>
                        <img src={imageUrl} alt="orphan"
                          style={{width:72, height:90, objectFit:"contain", borderRadius:5, background:"#fff", flexShrink:0, border:"1px solid #E8E0D8"}}/>
                        <div style={{flex:1, display:"flex", flexDirection:"column", gap:6}}>
                          <div style={s.fieldLabel}>Name</div>
                          <input style={{...s.input, width:"100%", boxSizing:"border-box", fontSize:12}}
                            value={meta.name}
                            onChange={e => setOrphanMeta(prev => ({...prev, [imageId]: {...meta, name: e.target.value}}))}/>
                          <div style={s.fieldLabel}>Category</div>
                          <select style={{...s.input, width:"100%", boxSizing:"border-box", fontSize:12}}
                            value={meta.category}
                            onChange={e => setOrphanMeta(prev => ({...prev, [imageId]: {...meta, category: e.target.value}}))}>
                            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          {meta.color_family && (
                            <div style={{fontSize:11, color:"#9A8E84"}}>Color: {meta.color_family}</div>
                          )}
                          <button style={{...s.btnPrimary, marginTop:4, fontSize:11, padding:"7px 14px"}}
                            onClick={() => handleAddOrphan(imageId)}>
                            Add to Wardrobe
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Force Sync ── */}
      {onForceSync && (
        <div style={{...s.settingsCard, marginTop:16, borderColor: fSyncDone?.failed > 0 ? "#C0392B" : fSyncDone ? "#3D7A4E" : "#E8DDD5"}}>
          <div style={s.settingsTitle}>Sync Wardrobe to Cloud</div>
          <p style={s.settingsSub}>
            Saves all {items.length} items from this browser directly to Supabase — use this after a bulk upload or if items aren't appearing on other devices. Do this before refreshing.
          </p>
          {fSyncProg && (
            <div style={{marginBottom:10}}>
              <div style={{height:6, background:"#F0E8E0", borderRadius:3, overflow:"hidden", marginBottom:6}}>
                <div style={{height:"100%", width:`${Math.round((fSyncProg.done/fSyncProg.total)*100)}%`,
                  background: fSyncProg.failed > 0 ? "#C0392B" : "#8B6F5E", borderRadius:3, transition:"width 0.3s"}}/>
              </div>
              <div style={{fontSize:11, color:"#6B6460"}}>
                {fSyncRunning
                  ? `Syncing ${fSyncProg.done} / ${fSyncProg.total}…`
                  : `Done — ${fSyncDone?.done} synced${fSyncDone?.failed ? `, ${fSyncDone.failed} failed` : " ✓"}`}
              </div>
            </div>
          )}
          <button style={{...s.settingsBtn, background: fSyncDone && !fSyncDone.failed ? "#3D7A4E" : "#8B6F5E"}}
            onClick={async () => {
              setFSyncRunning(true); setFSyncDone(null);
              setFSyncProg({ done: 0, total: items.length, failed: 0 });
              const result = await onForceSync((done, total, failed) =>
                setFSyncProg({ done, total, failed })
              );
              setFSyncRunning(false); setFSyncDone(result);
            }}
            disabled={fSyncRunning}>
            {fSyncRunning
              ? <><span style={s.spinnerSm}/> Syncing…</>
              : fSyncDone
                ? (fSyncDone.failed ? "⚠ Some failed — tap to retry" : "✓ All Synced to Supabase")
                : `Sync All ${items.length} Items to Supabase`}
          </button>
        </div>
      )}

      <div style={{...s.settingsCard, marginTop:16}}>
        <div style={s.settingsTitle}>About Atelier</div>
        <p style={s.settingsSub}>
          Your wardrobe is stored in Supabase. Photos are stored in Supabase Storage and synced across devices. Item names and details are sent to Claude for styling suggestions.
        </p>
      </div>
    </div>
  );
}

// ── OUTFIT HISTORY ───────────────────────────────────────────────────────────
function OutfitHistory({ items, onWearAgain, onDelete, onUnlog, isFav, toggleFav, nested }) {
  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filterOcc,  setFilterOcc]  = useState("All");
  const [wearingId,  setWearingId]  = useState(null);
  const [deleteId,   setDeleteId]   = useState(null);
  const [unloggingId, setUnloggingId] = useState(null);

  useEffect(() => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = filterOcc === "All" ? logs : logs.filter(l => l.occasion === filterOcc);
  const grouped = {};
  filtered.forEach(log => {
    const d = log.date_worn || log.created_at?.slice(0, 10) || "Unknown";
    const month = d.slice(0, 7);
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(log);
  });

  const formatMonth = (ym) => {
    try { const [y, m] = ym.split("-"); return new Date(y, m - 1).toLocaleDateString("en-US", { month:"long", year:"numeric" }); }
    catch { return ym; }
  };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };

  const handleWearAgain = async (log) => {
    setWearingId(log.id);
    try { await onWearAgain(log); const fresh = await sb.fetchOutfitLogs(); setLogs(fresh); }
    catch (e) { console.error(e); }
    finally { setWearingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };
  const handleUnlog = async (id) => {
    setUnloggingId(id);
    try { await onUnlog(id); setLogs(prev => prev.filter(l => l.id !== id)); }
    catch (e) { console.error(e); }
    finally { setUnloggingId(null); }
  };

  const occasions = ["All", ...new Set(logs.map(l => l.occasion).filter(Boolean))];
  const Wrap = nested ? "div" : "div";
  const wrapStyle = nested ? {} : s.page;

  return (
    <Wrap style={wrapStyle}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Outfit History</h2>}
      {logs.length > 0 && occasions.length > 1 && (
        <div style={s.filterRow}>
          {occasions.map(o => (
            <button key={o} onClick={() => setFilterOcc(o)}
              style={{...s.chip, ...(filterOcc === o ? s.chipActive : {})}}>{o}</button>
          ))}
        </div>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading outfit history…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No outfits logged yet. Save a look to start your history.</p></div>
      )}
      {!loading && Object.keys(grouped).map(month => (
        <div key={month} style={{ marginBottom:28 }}>
          <div style={s.histMonthLabel}>{formatMonth(month)}</div>
          {grouped[month].map(log => {
            const meta = parseMeta(log.collage_url);
            const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
            return (
              <div key={log.id} style={s.histCard}>
                <div style={s.histCardHeader}>
                  <div>
                    {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                    <div style={s.histDate}>
                      {formatDate(log.date_worn)}
                      {log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}
                      {meta.mood && <span style={s.histMood}> · {meta.mood}</span>}
                    </div>
                  </div>
                </div>
                <div style={s.histThumbs}>
                  {logItems.map(it => (
                    <div key={it.id} style={s.histThumb}>
                      {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
                        : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                      <div style={s.histThumbName}>{it.name}</div>
                    </div>
                  ))}
                </div>
                {log.notes && <div style={s.histNotes}>{log.notes}</div>}
                <div style={s.histActions}>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={15} height={15} viewBox="0 0 24 24"
                        fill={isFav("outfit", log.id) ? "#C0392B" : "none"}
                        stroke={isFav("outfit", log.id) ? "#C0392B" : "#C8BFB4"}
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                    <button style={s.histWearBtn} onClick={() => handleWearAgain(log)} disabled={wearingId === log.id}>
                      {wearingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Wear this again"}
                    </button>
                    <button style={s.histDeleteBtn} onClick={() => handleUnlog(log.id)} disabled={unloggingId === log.id}
                      title="Move back to Looks (clears the wear date)">
                      {unloggingId === log.id ? "…" : "Unlog"}
                    </button>
                  </div>
                  {deleteId === log.id ? (
                    <div style={{ display:"flex", gap:6 }}>
                      <button style={{...s.histDeleteBtn, color:"#C0392B"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                      <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Wrap>
  );
}

// ── OUTFIT BUILDER (manual look assembly) ────────────────────────────────────
function OutfitBuilder({ items, onSave, onClose }) {
  const [builderFilters, setBuilderFilters] = useState({ category: [], subcategory: [], color: [], brand: [], sleeveLength: "", sets: "", lastWorn: "" });
  const [builderSearch, setBuilderSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [lookName, setLookName] = useState("");
  const [occasion, setOccasion] = useState("Work");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggleItem = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filtered = (() => {
    let base = items;
    const cats = builderFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length) base = base.filter(it => cats.includes(it.category));
    if (builderFilters.subcategory?.length) base = base.filter(it => builderFilters.subcategory.includes(it.subcategory));
    if (builderFilters.sleeveLength) {
      const sl = builderFilters.sleeveLength;
      const TOPS_SLEEVE_MAP = {
        "Tanks": "Sleeveless", "T-Shirts": "Short Sleeve", "Polos": "Short Sleeve", "Short Sleeve": "Short Sleeve",
        "Blouses": "Long Sleeve", "Shirts": "Long Sleeve", "Tops": "Long Sleeve", "Light Knit Tops": "Long Sleeve",
      };
      base = base.filter(it => {
        if (it.category === "Tops") return TOPS_SLEEVE_MAP[it.subcategory] === sl;
        if (it.category === "Dresses") return (it.sleeve_length || "").toLowerCase() === sl.toLowerCase();
        return true;
      });
    }
    if (builderFilters.brand?.length) base = base.filter(it => builderFilters.brand.includes(it.brand));
    if (builderFilters.color?.length) {
      base = base.filter(it => {
        const itemColor = (it.color || "").toLowerCase();
        const itemFamily = (it.color_family || "").toLowerCase();
        return builderFilters.color.some(c => {
          const cl = c.toLowerCase();
          return itemColor.includes(cl) || itemFamily.includes(cl) || itemColor === cl;
        });
      });
    }
    if (builderSearch.trim()) {
      const q = builderSearch.toLowerCase().trim();
      base = base.filter(it => {
        const fields = [it.name, it.brand, it.color, it.color_family, it.subcategory, it.category, it.notes].filter(Boolean);
        return fields.some(f => f.toLowerCase().includes(q));
      });
    }
    return base;
  })();

  const selectedItems = selected.map(id => items.find(i => i.id === id)).filter(Boolean);
  const categoriesInOutfit = [...new Set(selectedItems.map(i => i.category))];

  const handleSave = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      await onSave({
        garment_ids: selected,
        date_worn: null,
        occasion,
        notes: null,
        collage_url: JSON.stringify({ look_name: lookName.trim() || "My Look", mood: null, styling: null }),
      });
      setSaved(true);
      setTimeout(onClose, 1000);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div style={s.page}>
        <div style={{ ...s.empty, padding: "120px 20px" }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
          <div style={{ fontSize: 14, color: "#3D7A4E", letterSpacing: "0.06em" }}>Saved to your looks</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h2 style={{ ...s.pageTitle, fontFamily: "'DM Serif Display',Georgia,serif", margin: 0 }}>Build a Look</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#9A8E84", fontSize: 24, cursor: "pointer", padding: 0, lineHeight: 1 }}>&times;</button>
      </div>

      {/* Selection tray */}
      {selected.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E8E0D8", borderRadius: 10, padding: "12px 16px", marginBottom: 16, boxShadow: "0 2px 12px rgba(28,24,20,0.04)" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: "#9A8E84", marginBottom: 8, fontFamily: "sans-serif" }}>
            YOUR LOOK · {selected.length} {selected.length === 1 ? "PIECE" : "PIECES"}
          </div>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {selectedItems.map(it => (
              <div key={it.id} style={{ flexShrink: 0, width: 56, textAlign: "center", position: "relative", cursor: "pointer" }}
                onClick={() => toggleItem(it.id)}>
                {it.image
                  ? <img src={it.image} alt={it.name} style={{ width: 56, height: 68, objectFit: "contain", borderRadius: 6, background: "#F5F1EC" }} />
                  : <div style={{ width: 56, height: 68, borderRadius: 6, background: "#F5F1EC", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#C8BFB4" }}>{it.category?.[0]}</div>
                }
                <div style={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: "50%", background: "#1C1814", color: "#F5F1EC", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>✕</div>
                <div style={{ fontSize: 8, color: "#9A8E84", marginTop: 3, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              </div>
            ))}
          </div>
          {/* Category coverage hints */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {CATEGORY_ORDER.filter(c => ["Tops", "Knits", "Bottoms", "Dresses", "Outerwear", "Shoes", "Bags"].includes(c)).map(cat => (
              <span key={cat} style={{
                fontSize: 9, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 10,
                background: categoriesInOutfit.includes(cat) ? "#E8F5EC" : "#F5F1EC",
                color: categoriesInOutfit.includes(cat) ? "#3D7A4E" : "#C8BFB4",
                border: `1px solid ${categoriesInOutfit.includes(cat) ? "#B8D9C0" : "#E8E0D8"}`,
              }}>{cat}</span>
            ))}
          </div>
        </div>
      )}

      {/* Save form — inline when items selected */}
      {selected.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #E8E0D8", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, letterSpacing: "0.18em", color: "#9A8E84", display: "block", marginBottom: 5, fontFamily: "sans-serif" }}>NAME</label>
              <input value={lookName} onChange={e => setLookName(e.target.value)}
                placeholder="e.g. Monday Power Look"
                style={{ ...s.modalInput, fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, letterSpacing: "0.18em", color: "#9A8E84", display: "block", marginBottom: 5, fontFamily: "sans-serif" }}>OCCASION</label>
              <select value={occasion} onChange={e => setOccasion(e.target.value)}
                style={{ ...s.modalInput, fontSize: 12 }}>
                {OCCASIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving}
            style={{ ...s.btnPrimary, width: "100%", padding: "11px 20px" }}>
            {saving ? <><span style={s.spinnerSm} /> Saving…</> : "Save Look"}
          </button>
        </div>
      )}

      {/* Browse items */}
      <FilterBar items={items} activeFilters={builderFilters} onChange={setBuilderFilters} />
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input type="text" placeholder="Search by brand, color, item type..."
          value={builderSearch} onChange={e => setBuilderSearch(e.target.value)}
          style={{
            width: "100%", padding: "10px 14px 10px 36px", boxSizing: "border-box",
            border: "1px solid #E8E0D8", borderRadius: 8, fontSize: 13,
            fontFamily: "'DM Sans',Inter,system-ui,sans-serif",
            background: "#FDFBF9", color: "#2C2420", outline: "none",
          }} />
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
          stroke="#9A8E84" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        {builderSearch && (
          <button onClick={() => setBuilderSearch("")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#9A8E84", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>
            ✕
          </button>
        )}
      </div>
      {builderSearch.trim() && (
        <div style={{ fontSize: 11, color: "#9A8E84", marginBottom: 8 }}>
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{builderSearch.trim()}"
        </div>
      )}

      {/* Item grid */}
      {filtered.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyMark}>✦</div>
          <p style={s.emptyText}>No items match your filters.</p>
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map(item => {
            const isSelected = selected.includes(item.id);
            return (
              <div key={item.id}
                onClick={() => toggleItem(item.id)}
                style={{
                  ...s.card, cursor: "pointer", position: "relative",
                  border: isSelected ? "2px solid #1C1814" : "1px solid #E8E0D8",
                  boxShadow: isSelected ? "0 2px 12px rgba(28,24,20,0.12)" : "none",
                }}>
                {isSelected && (
                  <div style={{
                    position: "absolute", top: 8, right: 8, width: 22, height: 22,
                    borderRadius: "50%", background: "#1C1814", color: "#F5F1EC",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 600, zIndex: 2, fontFamily: "sans-serif",
                  }}>{selected.indexOf(item.id) + 1}</div>
                )}
                <div style={s.cardImg}>
                  {item.image
                    ? <img src={item.image} alt={item.name} style={s.cardPhoto} />
                    : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>
                  }
                </div>
                <div style={s.cardBody}>
                  <div style={s.cardCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
                  <div style={s.cardName}>{item.name}</div>
                  {item.brand && <div style={{ fontSize: 11, color: "#9A8E84", fontStyle: "italic" }}>{item.brand}</div>}
                  {item.color && <div style={s.cardColor}>{item.color}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom spacer for fixed save bar */}
      <div style={{ height: 20 }} />
    </div>
  );
}

// ── LOOKS VIEW (saved outfits without a wear date) ──────────────────────────
function LooksView({ items, onDelete, onLogAsWorn, isFav, toggleFav, onSaveLook, apiKey }) {
  const [logs,      setLogs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [loggingId, setLoggingId] = useState(null);
  const [deleteId,  setDeleteId]  = useState(null);
  const [dateById,  setDateById]  = useState({});
  const [showBuilder, setShowBuilder] = useState(false);

  const loadLogs = () => {
    sb.fetchOutfitLogs()
      .then(data => { setLogs(data.filter(l => !l.date_worn)); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(loadLogs, []);

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const today = new Date().toISOString().slice(0, 10);

  const handleLog = async (id) => {
    const date = dateById[id] || today;
    setLoggingId(id);
    try { await onLogAsWorn(id, date); setLogs(prev => prev.filter(l => l.id !== id)); }
    catch (e) { console.error(e); }
    finally { setLoggingId(null); }
  };
  const handleDelete = async (id) => {
    try { await onDelete(id); setLogs(prev => prev.filter(l => l.id !== id)); setDeleteId(null); }
    catch (e) { console.error(e); }
  };

  if (showBuilder) {
    return (
      <SilhouetteBuilder
        items={items}
        apiKey={apiKey}
        onSave={async (log) => {
          await onSaveLook(log);
          setShowBuilder(false);
          setLoading(true);
          loadLogs();
        }}
        onClose={() => setShowBuilder(false)}
      />
    );
  }

  return (
    <div>
      {/* Build a Look button */}
      {!loading && (
        <button onClick={() => setShowBuilder(true)}
          style={{ ...s.btnSecondary, width: "100%", marginBottom: 16, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.plus}/></svg>
          Build a Look
        </button>
      )}
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading your looks…</p></div>}
      {!loading && logs.length === 0 && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>No looks saved yet. Build one manually or generate an outfit in Style Me.</p></div>
      )}
      {!loading && logs.map(log => {
        const meta = parseMeta(log.collage_url);
        const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
        const pickedDate = dateById[log.id] || today;
        return (
          <div key={log.id} style={s.histCard}>
            <div style={s.histCardHeader}>
              <div>
                {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                <div style={s.histDate}>
                  {log.occasion && <span>{log.occasion}</span>}
                  {meta.mood && <span style={s.histMood}>{log.occasion ? " · " : ""}{meta.mood}</span>}
                </div>
              </div>
            </div>
            <div style={s.histThumbs}>
              {logItems.map(it => (
                <div key={it.id} style={s.histThumb}>
                  {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/>
                    : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                  <div style={s.histThumbName}>{it.name}</div>
                </div>
              ))}
            </div>
            {log.notes && <div style={s.histNotes}>{log.notes}</div>}
            <div style={s.histActions}>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                  <svg width={15} height={15} viewBox="0 0 24 24"
                    fill={isFav("outfit", log.id) ? "#C0392B" : "none"}
                    stroke={isFav("outfit", log.id) ? "#C0392B" : "#C8BFB4"}
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                </button>
                <input type="date" value={pickedDate}
                  onChange={e => setDateById(d => ({ ...d, [log.id]: e.target.value }))}
                  style={{ fontSize:12, padding:"4px 6px", border:"1px solid #E8E0D8", borderRadius:6, background:"#FDFBF9", fontFamily:"inherit", color:"#2C2420" }}/>
                <button style={s.histWearBtn} onClick={() => handleLog(log.id)} disabled={loggingId === log.id}>
                  {loggingId === log.id ? <><span style={s.spinnerElevate}/> Logging…</> : "Log as worn"}
                </button>
              </div>
              {deleteId === log.id ? (
                <div style={{ display:"flex", gap:6 }}>
                  <button style={{...s.histDeleteBtn, color:"#C0392B"}} onClick={() => handleDelete(log.id)}>Confirm</button>
                  <button style={s.histDeleteBtn} onClick={() => setDeleteId(null)}>Cancel</button>
                </div>
              ) : (
                <button style={s.histDeleteBtn} onClick={() => setDeleteId(log.id)}>Remove</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SAVED VIEW (wrapper with sub-tabs: Looks | History | Favorites) ─────────
function SavedView({ items, favorites, toggleFav, onEditItem, onWearAgain, onDeleteLog, onUnlog, onLogAsWorn, isFav, onSaveLook, apiKey, onStyleItem }) {
  const [tab, setTab] = useState("looks");
  return (
    <div style={s.page}>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Saved</h2>
      <div style={s.filterRow}>
        {[["looks","Looks"],["boards","Boards"],["wear","Wear"],["history","History"],["favorites","Favorites"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>{label}</button>
        ))}
      </div>
      {tab === "looks" && (
        <LooksView items={items} apiKey={apiKey} onDelete={onDeleteLog} onLogAsWorn={onLogAsWorn} isFav={isFav} toggleFav={toggleFav} onSaveLook={onSaveLook}/>
      )}
      {tab === "boards" && (
        <MoodboardView items={items}/>
      )}
      {tab === "wear" && (
        <WearView items={items} onStyleItem={onStyleItem} onEditItem={onEditItem}/>
      )}
      {tab === "history" && (
        <OutfitHistory nested items={items} onWearAgain={onWearAgain} onDelete={onDeleteLog} onUnlog={onUnlog} isFav={isFav} toggleFav={toggleFav}/>
      )}
      {tab === "favorites" && (
        <FavoritesView nested items={items} favorites={favorites} toggleFav={toggleFav} onEditItem={onEditItem}/>
      )}
    </div>
  );
}

// ── FAVORITES VIEW ──────────────────────────────────────────────────────────
function FavoritesView({ items, favorites, toggleFav, onEditItem, nested }) {
  const [tab, setTab] = useState("outfits");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sb.fetchOutfitLogs().then(data => { setLogs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const favOutfitIds = new Set(favorites.filter(f => f.type === "outfit").map(f => f.reference_id));
  const favPieceIds  = new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id));
  const favOutfits = logs.filter(l => favOutfitIds.has(l.id));
  const favPieces  = items.filter(i => favPieceIds.has(i.id));

  const parseMeta = (url) => { try { return JSON.parse(url); } catch { return {}; } };
  const formatDate = (d) => {
    try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
    catch { return d; }
  };
  const tabs = [["outfits","Outfits",favOutfits.length],["pieces","Pieces",favPieces.length],["shopping","Shopping",0]];

  return (
    <div style={nested ? {} : s.page}>
      {!nested && <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Favorites</h2>}
      <div style={s.filterRow}>
        {tabs.map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{...s.chip, ...(tab === key ? s.chipActive : {})}}>
            {label}{count > 0 && <span style={{ marginLeft:5, opacity:0.6 }}>{count}</span>}
          </button>
        ))}
      </div>
      {loading && <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Loading favorites…</p></div>}
      {!loading && tab === "outfits" && (
        favOutfits.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite outfits yet. Tap the heart on any outfit in History.</p></div>
          : favOutfits.map(log => {
              const meta = parseMeta(log.collage_url);
              const logItems = (log.garment_ids || []).map(id => items.find(i => i.id === id)).filter(Boolean);
              return (
                <div key={log.id} style={s.histCard}>
                  <div style={s.histCardHeader}>
                    <div>
                      {meta.look_name && <div style={s.histLookName}>{meta.look_name}</div>}
                      <div style={s.histDate}>{formatDate(log.date_worn)}{log.occasion && <span style={s.histOcc}> · {log.occasion}</span>}</div>
                    </div>
                    <button style={s.heartBtn} onClick={() => toggleFav("outfit", log.id)}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                  <div style={s.histThumbs}>
                    {logItems.map(it => (
                      <div key={it.id} style={s.histThumb}>
                        {it.image ? <img src={it.image} alt={it.name} style={s.histThumbImg}/> : <div style={s.histThumbPh}>{it.category?.[0]}</div>}
                        <div style={s.histThumbName}>{it.name}</div>
                      </div>
                    ))}
                  </div>
                  {log.notes && <div style={s.histNotes}>{log.notes}</div>}
                </div>
              );
            })
      )}
      {!loading && tab === "pieces" && (
        favPieces.length === 0
          ? <div style={s.empty}><p style={s.emptyText}>No favorite pieces yet. Tap the heart on any item.</p></div>
          : <div style={s.grid}>
              {favPieces.map(item => (
                <div key={item.id} style={s.card}>
                  <div style={s.cardImg} onClick={() => onEditItem(item)}>
                    {item.image ? <img src={item.image} alt={item.name} style={s.cardPhoto}/> : <div style={s.cardPlaceholder}>{item.category?.[0]}</div>}
                  </div>
                  <div style={s.cardBody}>
                    <div style={s.cardCat}>{item.category}</div>
                    <div style={s.cardName}>{item.name}</div>
                    {item.color && <div style={s.cardColor}>{item.color}</div>}
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.heartBtn} onClick={() => toggleFav("piece", item.id)}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="#C0392B" stroke="#C0392B"
                        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icons.heart}/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
      )}
      {!loading && tab === "shopping" && (
        <div style={s.empty}><div style={s.emptyMark}>✦</div><p style={s.emptyText}>Shopping favorites coming soon.</p></div>
      )}
    </div>
  );
}

// ── STYLE INSIGHTS ANALYSIS ──────────────────────────────────────────────────
function analyzeWardrobe(items, outfitLogs) {
  const results = {};
  const catCounts = {};
  items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
  const coreCats = ["Tops","Knits","Bottoms","Dresses","Shoes"];
  const maxCore = Math.max(...coreCats.map(c => catCounts[c] || 0), 1);
  results.categoryGaps = coreCats
    .filter(c => (catCounts[c] || 0) < 3 && (catCounts[c] || 0) < maxCore * 0.4)
    .map(c => ({ category: c, count: catCounts[c] || 0, maxCategory: coreCats.reduce((a, b) => (catCounts[a] || 0) > (catCounts[b] || 0) ? a : b), maxCount: maxCore }));
  results.catCounts = catCounts;

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  results.underutilized = items.filter(it => {
    if (it.is_active_rotation === false) return false;
    if (!it.last_worn) return true;
    return (now - new Date(it.last_worn).getTime()) > thirtyDays;
  }).slice(0, 8);

  const pairMap = {};
  outfitLogs.forEach(log => {
    const ids = log.garment_ids || [];
    const logItems = ids.map(id => items.find(it => it.id === id)).filter(Boolean);
    const colors = [...new Set(logItems.map(it => it.color_family || it.color).filter(Boolean))];
    for (let i = 0; i < colors.length; i++) {
      for (let j = i + 1; j < colors.length; j++) {
        const key = [colors[i], colors[j]].sort().join(" + ");
        pairMap[key] = (pairMap[key] || 0) + 1;
      }
    }
  });
  results.colorPairs = Object.entries(pairMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([pair, count]) => ({ pair, count }));
  results.signaturePairs = results.colorPairs.filter(p => p.count >= 3);
  const wearCounts = {};
  outfitLogs.forEach(log => { (log.garment_ids || []).forEach(id => { wearCounts[id] = (wearCounts[id] || 0) + 1; }); });
  results.wardrobeAnchors = Object.entries(wearCounts).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ item: items.find(it => it.id === id), count })).filter(a => a.item);
  results.totalOutfits = outfitLogs.length;
  return results;
}



// ── STYLE INSIGHTS VIEW ───────────────────────────────────────────────────
function StyleInsightsView({ items, apiKey, onBack }) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [outfitLogs, setOutfitLogs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileErr, setProfileErr] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem("atelier-insights-dismissed") || "[]"); } catch { return []; }
  });
  const dismiss = (key) => { const next = [...dismissed, key]; setDismissed(next); localStorage.setItem("atelier-insights-dismissed", JSON.stringify(next)); };
  const isDismissed = (key) => dismissed.includes(key);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const logs = await sb.fetchOutfitLogs().catch(() => []);
      if (cancelled) return;
      setOutfitLogs(logs);
      setAnalysis(analyzeWardrobe(items, logs));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [items]);

  const handleGenerateProfile = async () => {
    if (!apiKey) { setProfileErr("Add your Anthropic API key in Settings."); return; }
    setProfileLoading(true); setProfileErr("");
    try { setProfile(await generateStyleProfile(items, outfitLogs, analysis, apiKey)); }
    catch (e) { setProfileErr(e.message); }
    finally { setProfileLoading(false); }
  };

  if (loading) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><span style={s.spinner}/><p style={s.emptyText}>Analyzing your wardrobe…</p></div></div>
  );
  if (!items.length) return (
    <div style={s.page}><div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
    <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>
    <div style={s.empty}><div style={{fontSize:42,color:"#DDD5CC",marginBottom:8}}>✦</div>
    <p style={{...s.emptyText,maxWidth:280}}>Add items to unlock your style intelligence</p></div></div>
  );

  const hasLogs = outfitLogs.length > 0;
  return (
    <div style={s.page}>
      <div style={s.pageHeader}><button style={s.backBtn} onClick={onBack}>← Back</button>
      <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Style Intelligence</h2></div>

      {!isDismissed("profile") && <div style={si.profileCard}>
        <div style={si.cardDismiss} onClick={() => dismiss("profile")}>✕</div>
        <div style={si.sectionLabel}>MONTHLY PROFILE</div>
        {profile ? <div style={si.profileText}>{profile}</div>
          : <p style={si.profilePlaceholder}>{apiKey ? "Generate an AI-written style profile." : "Add your API key in Settings."}</p>}
        {profileErr && <p style={s.err}>{profileErr}</p>}
        <button style={si.profileBtn} onClick={handleGenerateProfile} disabled={profileLoading || !apiKey}>
          {profileLoading ? <><span style={s.spinnerSm}/> Writing…</> : profile ? "✦ Regenerate" : "✦ Generate Profile"}
        </button>
      </div>}

      {hasLogs && analysis.signaturePairs.length > 0 && !isDismissed("signatures") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("signatures")}>✕</div>
        <div style={si.sectionHeader}>Signature Patterns</div>
        {analysis.signaturePairs.map((p, i) => (
          <div key={i} style={si.insightRow}>
            <div style={si.swatchPair}><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[0])}}/><span style={{...si.swatchDot, background:colorHex(p.pair.split(" + ")[1])}}/></div>
            <div style={si.insightText}>You've worn <strong>{p.pair}</strong> together {p.count} times — signature.</div>
          </div>
        ))}
        {analysis.wardrobeAnchors.length > 0 && <>
          <div style={si.divider}/><div style={{...si.sectionLabel,marginBottom:8}}>WARDROBE ANCHORS</div>
          {analysis.wardrobeAnchors.map((a, i) => (
            <div key={i} style={si.insightRow}>
              <div style={si.anchorThumb}>{a.item.image ? <img src={a.item.image} alt="" style={si.anchorImg}/> : <span style={{color:"#C8BFB4"}}>{a.item.category?.[0]}</span>}</div>
              <div style={si.insightText}><strong>{a.item.name}</strong> — worn {a.count} times.</div>
            </div>
          ))}
        </>}
      </div>}

      {!isDismissed("gaps") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("gaps")}>✕</div>
        <div style={si.sectionHeader}>Category Breakdown</div>
        <div style={si.barContainer}>
          {CATEGORY_ORDER.map(cat => {
            const count = analysis.catCounts[cat] || 0;
            const max = Math.max(...Object.values(analysis.catCounts), 1);
            return (<div key={cat} style={si.barRow}><div style={si.barLabel}>{cat}</div>
              <div style={si.barTrack}><div style={{...si.barFill, width:`${Math.max((count/max)*100,2)}%`}}/></div>
              <div style={si.barCount}>{count}</div></div>);
          })}
        </div>
        {analysis.categoryGaps.length > 0 && <><div style={si.divider}/>
          {analysis.categoryGaps.map((g, i) => <div key={i} style={si.gapAlert}>You have {analysis.catCounts[g.maxCategory]||0} {g.maxCategory.toLowerCase()} but only {g.count} {g.category.toLowerCase()} — consider filling this gap.</div>)}
        </>}
      </div>}

      {analysis.underutilized.length > 0 && !isDismissed("underutilized") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("underutilized")}>✕</div>
        <div style={si.sectionHeader}>Underutilized Pieces</div>
        <p style={si.subtleNote}>Active items you haven't worn in 30+ days</p>
        <div style={si.underutilGrid}>
          {analysis.underutilized.map(item => {
            const days = item.last_worn ? Math.floor((Date.now() - new Date(item.last_worn).getTime()) / 86400000) : null;
            return (<div key={item.id} style={si.underutilCard}><div style={si.underutilImg}>
              {item.image ? <img src={item.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/> : <span style={{color:"#C8BFB4",fontSize:22}}>{item.category?.[0]}</span>}
            </div><div style={si.underutilMeta}><div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84"}}>{item.category}</div>
              <div style={{fontSize:12,marginTop:2}}>{item.name}</div>
              <div style={{fontSize:10,color:"#C4A882",marginTop:3}}>{days ? `${days} days ago` : "Never worn"}</div>
            </div></div>);
          })}
        </div>
      </div>}

      {hasLogs && analysis.colorPairs.length > 0 && !isDismissed("colorpairs") && <div style={si.card}>
        <div style={si.cardDismiss} onClick={() => dismiss("colorpairs")}>✕</div>
        <div style={si.sectionHeader}>Color Pair Frequency</div>
        <div style={si.pairGrid}>
          {analysis.colorPairs.map((p, i) => { const [a, b] = p.pair.split(" + "); return (
            <div key={i} style={si.pairChip}><span style={{...si.swatchDot, background:colorHex(a), width:18, height:18}}/>
              <span style={{fontSize:10,color:"#9A8E84"}}>+</span><span style={{...si.swatchDot, background:colorHex(b), width:18, height:18}}/>
              <span style={{fontSize:11,marginLeft:4}}>{p.count}×</span></div>
          ); })}
        </div>
      </div>}

      {!hasLogs && <div style={si.card}><div style={{...si.sectionLabel,marginBottom:8}}>OUTFIT DATA</div>
        <p style={si.subtleNote}>Log outfits from the Looks tab to unlock signature patterns, color pair analysis, and AI style profiles.</p>
      </div>}
    </div>
  );
}


// ── SHOPPING VIEW ───────────────────────────────────────────────────────────
function ShoppingView({ items, apiKey, onBack }) {
  const [mode, setMode] = useState("gap");
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState("");

  const toggleItem = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleAnalyze = async () => {
    if (!apiKey) { setErr("Add your Anthropic API key in Settings."); return; }
    if (mode === "complete" && selectedIds.length === 0) { setErr("Select at least one piece."); return; }
    setLoading(true); setErr(""); setResults(null);
    try {
      const data = await generateShoppingRecs(items, apiKey, mode, selectedIds);
      setResults(data);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };

  const priorityColor = { high: "#C0392B", medium: "#8B6914", low: "#3D7A4E" };

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
        <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Shopping</h2>
      </div>

      <div style={s.modeTabs}>
        {[["gap","Gap Analysis"],["complete","Complete a Look"]].map(([m, label]) => (
          <button key={m} onClick={() => { setMode(m); setResults(null); setErr(""); }}
            style={{...s.modeTab, ...(mode === m ? s.modeTabActive : {})}}>{label}</button>
        ))}
      </div>

      {mode === "gap" && (
        <div style={s.advisorNote}>Analyzes your wardrobe against the full taxonomy to find missing and thin categories, then suggests specific pieces to buy.</div>
      )}

      {mode === "complete" && (
        <>
          <div style={s.advisorNote}>Select pieces from your wardrobe, and AI will suggest what to buy to complete or elevate the outfit.</div>
          <div style={{...s.grid, marginBottom:20}}>
            {items.filter(it => it.image).slice(0, 30).map(item => (
              <div key={item.id} style={{...s.card, border: selectedIds.includes(item.id) ? "2px solid #1C1814" : "1px solid #E8E0D8", cursor:"pointer"}}
                onClick={() => toggleItem(item.id)}>
                <div style={{...s.cardImg, height:120}}>
                  <img src={item.image} alt={item.name} style={s.cardPhoto}/>
                  {selectedIds.includes(item.id) && (
                    <div style={{position:"absolute",top:6,right:6,background:"#1C1814",color:"#F5F1EC",borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>✓</div>
                  )}
                </div>
                <div style={{padding:"6px 8px"}}><div style={{fontSize:10,color:"#9A8E84"}}>{item.category}</div><div style={{fontSize:11}}>{item.name}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p style={s.err}>{err}</p>}
      <button style={{...s.btnPrimary, width:"100%", marginBottom:20}} onClick={handleAnalyze} disabled={loading}>
        {loading ? <><span style={s.spinnerSm}/> Analyzing…</> : <><Icon path={icons.sparkle} size={15}/> {mode === "gap" ? "Run Gap Analysis" : `Find Pieces (${selectedIds.length} selected)`}</>}
      </button>

      {results && mode === "gap" && results.gaps && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.gaps.length} GAPS FOUND
          </div>
          {results.gaps.map((gap, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: gap.priority === "high" ? "#FFF0F0" : gap.priority === "medium" ? "#FFF8EC" : "#F0FFF4",
                  color: priorityColor[gap.priority] || "#6B5E54"}}>{gap.priority?.toUpperCase()}</div>
                <div style={{fontSize:10,color:"#C4A882"}}>{gap.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{gap.category}{gap.subcategory ? ` · ${gap.subcategory}` : ""}</div>
              <div style={{fontSize:14,marginBottom:4}}>{gap.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{gap.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4,fontStyle:"italic"}}>{gap.reason}</div>
              {gap.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {gap.colorNote}</div>}
            </div>
          ))}
        </div>
      )}

      {results && mode === "complete" && results.completions && (
        <div>
          <div style={{fontSize:11,letterSpacing:"0.2em",color:"#9A8E84",marginBottom:16,fontFamily:"sans-serif"}}>
            {results.completions.length} SUGGESTIONS
          </div>
          {results.completions.map((comp, i) => (
            <div key={i} style={si.card}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:9,letterSpacing:"0.12em",padding:"2px 8px",borderRadius:3,fontFamily:"sans-serif",
                  background: comp.type === "essential" ? "#E8F5EC" : "#EDE8FF",
                  color: comp.type === "essential" ? "#3D7A4E" : "#5B4E8E"}}>{comp.type === "essential" ? "ESSENTIAL" : "ELEVATING"}</span>
                <div style={{fontSize:10,color:"#C4A882"}}>{comp.price}</div>
              </div>
              <div style={{fontSize:10,letterSpacing:"0.1em",color:"#9A8E84",marginBottom:4}}>{comp.category}</div>
              <div style={{fontSize:14,marginBottom:4}}>{comp.suggestion}</div>
              <div style={{fontSize:12,color:"#6B5E54",marginBottom:6,lineHeight:1.5}}>{comp.description}</div>
              <div style={{fontSize:11,color:"#4A3E36",lineHeight:1.5,marginBottom:4}}>{comp.why}</div>
              {comp.colorNote && <div style={{fontSize:10,color:"#3D7A4E"}}>✓ {comp.colorNote}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PLANNER WRAPPER (F3) ─────────────────────────────────────────────────────
// Fetches saved outfit_logs on mount and passes them to CalendarView so the
// "pick a saved look" tab inside the day modal has something to show.
function PlannerWrapper({ items, onGoToStyleMe }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    sb.fetchOutfitLogs().then(setLogs).catch(() => {});
  }, []);
  return <CalendarView items={items} outfitLogs={logs} onGoToStyleMe={onGoToStyleMe}/>;
}
