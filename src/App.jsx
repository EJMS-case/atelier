import { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef, lazy, Suspense } from "react";
import { restoreScroll } from "./utils/restoreScroll.js";
// The stylist pipeline is dynamic-imported at its call sites (see
// generateAndAppendLooks) so the AI chunk stays off the cold-start path —
// only the small feedback helpers are imported statically here.
import { saveLookFeedback, fetchItemFeedbackScores, lookHash } from "./features/stylist/feedback.js";
import { savePlan, deletePlan } from "./features/planner/plannerApi.js";
import { bumpWearCounts, unbumpWearCounts, deriveWearStats, applyWearStats } from "./features/wear/wearApi.js";
import { runRecutDrip } from "./features/images/recutDrip.js";
import HomeView from "./features/home/HomeView.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { s, ss } from "./ui/styles.js";
import { icons, Icon } from "./ui/icons.jsx";
import { SET_TAGS, STYLE_ME_OCCASIONS, subcatMatches, MISC_CATEGORY } from "./constants/taxonomy.js";
import { defaultSortComparator, matchesColorFilter, mergeItems, slotForItem } from "./utils/item-helpers.js";
import { computeFilterChips } from "./utils/style-filters.js";
import { autoColorPairs } from "./utils/wardrobe-coverage.js";
import {
  RECENT_LOOKS_KEY,
  loadLocalItems, saveLocalItems, loadApiKey, saveApiKey, loadRmbgKey, saveRmbgKey,
  loadSetsMeta, saveSetsMeta, loadStylePrefs, loadAboutMe,
  loadActiveClosetId, saveActiveClosetId, loadClosets, saveClosets,
  migrateLocalStorage,
} from "./utils/storage.js";
import { DEFAULT_CLOSET_ID, SEED_CLOSETS } from "./features/closet/closets.js";
import { compareSetsByName, compareSetsByType, setMembers } from "./features/closet/setType.js";
import { resolveVisibleWardrobe, packedItemIds, miscItemsForCloset, withoutMisc, isMiscItem, poolIncluding } from "./features/closet/useVisibleWardrobe.js";
import { duplicatedSourceIds, canOfferDuplicate, duplicateTargetCloset, buildDuplicate } from "./features/closet/duplicate.js";
import { sb } from "./lib/supabase.js";
import { migrateImages, migrateAndSync } from "./lib/migrate.js";
import { fetchClosetForecast } from "./lib/weather.js";
import { nyToday, todayInTz } from "./lib/time.js";
// The AI layer (stylist.js → prompts / sampler / validator / zod) is imported
// dynamically at the call sites below so its ~170kB of schema + prompt code
// stays out of the initial bundle — it only loads on the first Style Me tap
// (or fingerprint refresh), never on cold start.
// Rotation memory sync: generation-time reads/writes stay inside generateOutfit;
// App only bridges the localStorage state to user_settings for cross-device use.
import { exportRotationState, mergeRemoteRotationState } from "./utils/rotation-tracker.js";
// Inline imports — these render on the default Home/Closet view and would
// trigger a Suspense flash on first paint if lazy.
import FilterBar from "./components/FilterBar.jsx";
import SetCard from "./components/SetCard.jsx";
import ItemCard from "./components/ItemCard.jsx";
import RouteFallback from "./components/RouteFallback.jsx";
import Thumb, { forgetThumb } from "./components/Thumb.jsx";
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
const VisionPilotView   = lazy(() => import("./components/VisionPilotView.jsx"));
const StyleProfileView  = lazy(() => import("./features/profile/StyleProfileView.jsx"));
const BrandDiscoveryView = lazy(() => import("./features/discovery/BrandDiscoveryView.jsx"));

import { listInspirations, vibesFor } from "./features/inspiration/inspirationApi.js";
import { unionTags, outfitsOf, buildPlanPayload, newOutfitId, appendOutfit } from "./features/planner/outfits.js";
import { fetchPlansBetween } from "./features/planner/plannerApi.js";

// Rename any pre-namespace localStorage keys from older app builds. Runs once
// per browser; no-op afterward. Must fire before any load*() helpers below.
migrateLocalStorage();



// ── Worn-pin reconcilers ─────────────────────────────────────────────────────
// Marking a look worn (or un-marking it) must NOT clobber a trip/manual plan that
// already lives on that date. Both helpers reconcile against the row's existing
// outfits[] (mirroring the onSchedule path) instead of a bare savePlan/deletePlan
// — the bare versions left a stale outfits[] (so outfitsOf masked the real look)
// and deletePlan wiped the whole day, losing trips.
const sameItemSet = (a = [], b = []) => a.length === b.length && a.every(x => b.includes(x));

async function pinWornToDate({ date, itemIds, occasion }) {
  if (!date || !(itemIds || []).length) return;
  try {
    const rows = await fetchPlansBetween(date, date);
    const existing = (Array.isArray(rows) && rows[0]) || null;
    const current = outfitsOf(existing);
    // Append the worn look as its own outfit unless an identical one is already there.
    const outfits = current.some(o => sameItemSet(o.items, itemIds))
      ? current
      : [...current, { id: newOutfitId(), label: "", occasion: occasion || null, items: itemIds }];
    const merged = buildPlanPayload({
      date, outfits,
      source: existing?.source || "worn",
      notes: existing?.notes ?? null,
      weather: existing?.weather ?? null,
      activity: existing?.activity ?? null,
      day_label: existing?.day_label ?? null,
      // Preserve the row's stored multi-tags and add this wear's occasion —
      // omitting these re-derived occasions from outfits and collapsed
      // builder-authored plurals to singletons (same trap the onSchedule
      // comment documents).
      occasions: unionTags(existing?.occasions, outfits.map(o => o.occasion), occasion),
      weathers:  unionTags(existing?.weathers, existing?.weather),
    });
    if (existing?.layout_data) merged.layout_data = existing.layout_data;
    if (existing?.outfit_log_id) merged.outfit_log_id = existing.outfit_log_id;
    await savePlan(merged);
  } catch {
    // Last-resort fallback keeps the old behavior so a fetch blip still records something.
    await savePlan({ date, items: itemIds, source: "worn", occasion: occasion || "Work", notes: null }).catch(() => {});
  }
}

async function unpinWornFromDate({ date, itemIds }) {
  if (!date) return;
  try {
    const rows = await fetchPlansBetween(date, date);
    const existing = (Array.isArray(rows) && rows[0]) || null;
    if (!existing) return;
    const current = outfitsOf(existing);
    const remaining = current.filter(o => !sameItemSet(o.items, itemIds));
    if (remaining.length === current.length) return; // nothing matched — leave it
    if (remaining.length === 0) {
      // Only delete the row if this worn look was the ONLY thing on the day.
      await deletePlan(date);
      return;
    }
    const merged = buildPlanPayload({
      date, outfits: remaining,
      source: existing.source || "worn",
      notes: existing.notes ?? null,
      weather: existing.weather ?? null,
      activity: existing.activity ?? null,
      day_label: existing.day_label ?? null,
      occasions: unionTags(existing.occasions, remaining.map(o => o.occasion)),
      weathers:  unionTags(existing.weathers, existing.weather),
    });
    if (existing.layout_data) merged.layout_data = existing.layout_data;
    if (existing.outfit_log_id) merged.outfit_log_id = existing.outfit_log_id;
    await savePlan(merged);
  } catch { /* leave the row untouched on failure */ }
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [items,      setItems]      = useState(() => loadLocalItems());
  // ── Multi-closet (Phase A) ──
  // `closets` is the cached list of closet rows (seed pair until the fetch
  // lands); `activeClosetId` is the device-persisted mode switch.
  const [closets, setClosets] = useState(() => loadClosets());
  const [activeClosetId, setActiveClosetId] = useState(() => loadActiveClosetId());
  const [closetMenuOpen, setClosetMenuOpen] = useState(false);
  // ── Trip mode (Phase B) ──
  // The single status='active' trip row (null when none) + its trip_items.
  // While a trip is active the visible pool is destination closet ∪ packed
  // items — see the closetItems memo below.
  const [activeTrip, setActiveTrip] = useState(null);
  const [activeTripItems, setActiveTripItems] = useState([]);
  // Bulk "move to closet" select mode on the closet grid.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [moveBusy, setMoveBusy] = useState(false);
  const [view,       setViewRaw]    = useState("home");
  const closetScrollRef = useRef(0);
  const viewRef = useRef("home");
  const cancelClosetRestoreRef = useRef(null);
  const setView = useCallback((v) => {
    // Save scroll position when leaving closet. Read here, in the click
    // handler, while the grid is still mounted and scrollY still means
    // something — not in an effect cleanup, which runs after the browser has
    // already clamped the offset against the shorter page.
    if (viewRef.current === "closet" && v !== "closet") {
      closetScrollRef.current = window.scrollY;
    }
    viewRef.current = v;
    setViewRaw(v);
    // Restore it on the way back. One requestAnimationFrame is NOT enough: the
    // grid remounts short and grows as every photo decodes and is trimmed, so a
    // single scrollTo clamps against a nearly-empty page and lands at the top —
    // owner report, "when I delete or edit a garment and hit save, it snaps
    // back up to the top again". restoreScroll converges instead; see the notes
    // in utils/restoreScroll.js for the two traps it handles.
    cancelClosetRestoreRef.current?.();
    cancelClosetRestoreRef.current = null;
    if (v === "closet") {
      cancelClosetRestoreRef.current = restoreScroll(closetScrollRef.current);
    }
  }, []);
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
  const [request,    setRequest]    = useState("");
  const [styleExcludes, setStyleExcludes] = useState(new Set()); // user-toggled exclusions
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [manualBuilderOpen, setManualBuilderOpen] = useState(false);
  // Set when Edit on a Style Me result opens the builder pre-filled with that
  // look's pieces (2026-08-13 — replaced LookCard's in-place editor). Shape:
  // synthetic log for SilhouetteBuilder's initialSelections, plus the original
  // id list so onSave can diff the result into A1 look_edits lessons.
  const [builderSeed, setBuilderSeed] = useState(null);
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
  const [dislikedLooks, setDislikedLooks] = useState([]);
  // Raw look_feedback rating=1 rows (item_ids/occasion/created_at) — feeds
  // summarizeOccasionMemory in the stylist alongside the raw outfit logs.
  // Distinct from lovedLooks above (hearted outfit_logs, a different table).
  const [lovedFeedback, setLovedFeedback] = useState([]);
  // Her in-place editor corrections (look_edits rows, newest first) — fed to
  // the stylist as the SWAP LESSONS block and folded into the fingerprint.
  const [lookEdits, setLookEdits] = useState([]);
  const [inspirations, setInspirations] = useState([]);
  // { text, source_count, generated_at } | null — loaded from user_settings
  // and refreshed via the Settings → Update Style Fingerprint button.
  const [styleFingerprint, setStyleFingerprint] = useState(null);
  // Lazy-load inspirations + fingerprint on first render. They live in their
  // own table/key and never block the closet boot — failures here shouldn't
  // break Style Me.
  // Cached Brand Atlas result (cross-device, user_settings) — Home renders it
  // with zero AI calls; scouting runs only on the explicit tap in the view.
  const [brandDiscovery, setBrandDiscovery] = useState(null);
  useEffect(() => {
    listInspirations().then(setInspirations).catch(() => setInspirations([]));
    sb.getStyleFingerprint().then(setStyleFingerprint).catch(() => setStyleFingerprint(null));
    sb.getBrandDiscovery().then(setBrandDiscovery).catch(() => setBrandDiscovery(null));
    // Pull the other devices' anti-repeat memory so this one doesn't re-suggest
    // pieces the stylist just offered elsewhere, then push the merged union
    // back so the remote copy is the superset (cheap single-row write).
    sb.getRotationState().then(remote => {
      mergeRemoteRotationState(remote);
      sb.saveRotationState(exportRotationState());
    }).catch(() => {});
  }, []);
  // ── Sets metadata ──
  const [setsMeta,       setSetsMeta]       = useState(() => loadSetsMeta());
  const [setsSearch,     setSetsSearch]     = useState("");
  const [setsTagFilter,  setSetsTagFilter]  = useState("");
  const [setsSort,       setSetsSort]       = useState("type"); // type | recent | alpha | count
  const [editingSet,     setEditingSet]     = useState(null); // null or set_id for modal
  const syncTimer = useRef(null);
  const recutRan = useRef(false);
  // True calendar-derived wear stats (plans + logs), computed on mount. Used to
  // overlay accurate last_worn onto items before the stylist samples, so the
  // "[RESTING]" rediscovery tag reflects real wear — the stored last_worn column
  // went stale once wear moved to the calendar.
  const wearStatsRef = useRef({});
  // Planner rows + derived wear stats, fetched ONCE here and shared down the
  // tree. HomeView and LookBackCard used to each re-fetch the same
  // planned_outfits / outfit_logs tables on every Home visit (three
  // overlapping fetches); App now owns the single fetch and passes rows +
  // stats down as props. HomeView still asks for a refresh on every mount —
  // so a just-logged outfit or freshly saved plan shows up when returning
  // Home — but concurrent callers share one in-flight request.
  const [wearData, setWearData] = useState({ plans: null, logs: null, stats: null });
  const wearFetchRef = useRef(null);
  // True while a Style Me generation is in flight — see generateAndAppendLooks.
  const generationBusyRef = useRef(false);
  const refreshWearData = useCallback(() => {
    if (wearFetchRef.current) return wearFetchRef.current;
    const p = Promise.all([
      sb.fetchAllPlans().catch(() => []),
      sb.fetchOutfitLogs().catch(() => []),
    ]).then(([plans, logs]) => {
      const stats = deriveWearStats(plans || [], logs || []);
      wearStatsRef.current = stats;
      // Raw logs ride along in state so the stylist's occasion-memory block
      // (summarizeOccasionMemory) reads already-fetched rows — never a
      // per-tap network call. Refreshes with every Home-mount refresh.
      setWearData({ plans: plans || [], logs: logs || [], stats });
      return { plans: plans || [], logs: logs || [] };
    }).finally(() => { wearFetchRef.current = null; });
    wearFetchRef.current = p;
    return p;
  }, []);

  // ── Multi-closet plumbing (Phase A) ─────────────────────────────────────
  // Refresh the closets list from Supabase once on mount; the cached copy
  // (seed pair by default) keeps everything rendering offline/pre-migration.
  useEffect(() => {
    sb.fetchClosets().then(rows => {
      if (Array.isArray(rows) && rows.length > 0) {
        setClosets(rows);
        saveClosets(rows);
      }
    }).catch(() => { /* offline / table not migrated yet — cached list stands */ });
  }, []);

  // Trip mode (Phase B): pull the active trip + its trip_items on mount.
  // Passed down to the planner — wave 2's activation / suitcase-close flows
  // call it after flipping trip status so the pool updates app-wide.
  const refreshActiveTrip = useCallback(async () => {
    const trip = await sb.fetchActiveTrip();   // soft-fails to null
    setActiveTrip(trip);
    const rows = trip ? await sb.fetchTripItems(trip.id).catch(() => []) : [];
    setActiveTripItems(rows || []);
  }, []);
  useEffect(() => { refreshActiveTrip().catch(() => {}); }, [refreshActiveTrip]);

  const activeCloset =
    closets.find(c => c.id === activeClosetId) ||
    closets.find(c => c.id === DEFAULT_CLOSET_ID) ||
    closets[0] || SEED_CLOSETS[0];

  const switchCloset = useCallback((id) => {
    setActiveClosetId(id);
    saveActiveClosetId(id);
    setClosetMenuOpen(false);
    // Leaving a closet ends any in-progress bulk selection, and clearing the
    // weather chip lets the effect below re-fill it from the NEW location.
    setSelectMode(false);
    setSelectedIds([]);
    setWeather(new Set());
    // The holding-room chip is closet-local: carrying a stale "Misc" selection
    // into a closet that has no Misc items would leave a Misc pill sitting in
    // a room the category doesn't exist in.
    setActiveFilters(f => (f.category?.includes(MISC_CATEGORY)
      ? { ...f, category: [], subcategory: [], sleeveLength: "" }
      : f));
  }, []);

  // THE one place wardrobe scoping happens: every scoped consumer (the grid,
  // FilterBar, sets, Style Me, planner, Home, insights, shopping, …) receives
  // this array instead of `items`, so the whole app follows the pool rule
  // automatically. The rule itself lives in resolveVisibleWardrobe (Phase B):
  // active closet normally; destination closet ∪ packed trip items while a
  // trip is active (activeCloset is deliberately ignored then). Missing
  // closet_id = NYC. Full `items` stays reserved for App-internal sync
  // machinery (persistItems / mergeItems / forceSyncAll), SettingsView's
  // closet-agnostic orphan scan, and the planner's cross-closet trip pool.
  // Scope by the RESOLVED closet (not the raw persisted id): a stale
  // localStorage id would otherwise render every surface empty while the
  // chip and weather claim NYC.
  const closetItems = useMemo(
    () => resolveVisibleWardrobe({ items, activeClosetId: activeCloset.id, activeTrip, tripItems: activeTripItems }),
    [items, activeCloset.id, activeTrip, activeTripItems],
  );

  // ── MISC — the holding room ────────────────────────────────────────────────
  // resolveVisibleWardrobe strips Misc items from `closetItems` unconditionally
  // (see its header), so the entire app is blind to them. These two memos are
  // the only doors back in, and neither one leads to a stylist:
  //
  //   miscItems     → the closet GRID, and only while the Misc chip is on.
  //   stylingItems  → the full wardrobe MINUS Misc, for the handful of props
  //                   that legitimately need to see across closets (the trip
  //                   planner's destination-closet pool, EditItemView's
  //                   set-mate lookup). Passing raw `items` there would let
  //                   the trip packer pull an Arizona PJ set into an outfit.
  //
  // Raw `items` stays reserved for App-internal sync machinery and Settings'
  // closet-agnostic photo/orphan maintenance, neither of which styles anything.
  const miscItems = useMemo(
    () => miscItemsForCloset(items, activeCloset.id),
    [items, activeCloset.id],
  );
  const stylingItems = useMemo(() => withoutMisc(items), [items]);

  // ── Builder pool ───────────────────────────────────────────────────────────
  // SilhouetteBuilder distributes initialLook.garment_ids into slots by
  // LOOKING EACH ID UP IN ITS POOL, and its Save writes back only the ids that
  // survived. So a scoped pool doesn't merely hide an out-of-closet piece
  // while you edit — it deletes it the moment you save. That is exactly what
  // happens on a trip look: every trip day mixes home and destination pieces
  // by design, so opening one with the wrong closet chip selected silently
  // strips half the outfit.
  //
  // The look being edited therefore brings its own pieces into the pool.
  // Everything else stays closet-scoped: this widens what the canvas can HOLD,
  // never what the swap sheet offers to add.
  const builderItems = useMemo(() => {
    const editedIds = editingPlan ? (editingPlan.plan?.items || []) : (builderSeed?.garment_ids || []);
    const widen = [
      ...editedIds.map(it => (typeof it === "object" && it !== null ? it.id : it)),
      ...(editingPlan?.poolIds || []),
    ];
    return poolIncluding(closetItems, stylingItems, widen);
  }, [closetItems, stylingItems, editingPlan, builderSeed]);

  // Suitcase pieces during an ACTIVE trip (wave 2 — packed-item marker). The
  // closet grid badges these 🧳 so packed pieces read apart from destination-
  // closet ones at a glance. null when no trip → no markers anywhere.
  const packedIds = useMemo(
    () => (activeTrip ? packedItemIds(activeTripItems) : null),
    [activeTrip, activeTripItems],
  );

  // Coord sets split across closets (wave 2 — B6). Computed over the FULL
  // wardrobe (a split is invisible from inside one closet by definition);
  // missing closet_id counts as the default/NYC closet, same as everywhere.
  const splitSetIds = useMemo(() => {
    const closetsBySet = new Map();
    for (const it of items) {
      if (!it.set_id) continue;
      const c = it.closet_id || DEFAULT_CLOSET_ID;
      if (!closetsBySet.has(it.set_id)) closetsBySet.set(it.set_id, new Set());
      closetsBySet.get(it.set_id).add(c);
    }
    return new Set([...closetsBySet].filter(([, cs]) => cs.size > 1).map(([id]) => id));
  }, [items]);

  // B5 trip-complete hygiene: after left-behind pieces are reassigned on the
  // server (sb.setClosetBulk in TripDetailView), mirror the closet change into
  // App's local items so the grids agree without a full reload.
  const applyItemsClosetChange = useCallback((ids, closetId) => {
    const idSet = new Set(ids);
    setItems(prev => {
      const next = prev.map(it => idSet.has(it.id) ? { ...it, closet_id: closetId } : it);
      saveLocalItems(next);
      return next;
    });
  }, []);

  // ── Auto-populate today's weather from the active closet's forecast.
  // Weather stays editable — the user can override any chip at any time.
  // Only fires when the Set is empty (fresh load, after user clears to "Any",
  // or right after a closet switch — switchCloset empties it on purpose).
  useEffect(() => {
    fetchClosetForecast(activeCloset).then(forecast => {
      if (!forecast) return;
      // The forecast map is keyed by the closet's LOCAL dates — index it with
      // the closet's "today", not NY's (NY rolls past midnight ~2-3h early
      // for Arizona evenings).
      const today = todayInTz(activeCloset.timezone);
      const bucket = forecast[today]?.bucket;
      const BUCKET_TO_CHIP = {
        "Hot":  "Hot (85°F+)",
        "Warm": "Warm (70-84°F)",
        "Mild": "Mild (55-69°F)",
        "Cool": "Cool (40-54°F)",
        "Cold": "Cold (below 40°F)",
      };
      const chip = BUCKET_TO_CHIP[bucket];
      if (chip) setWeather(prev => prev.size === 0 ? new Set([chip]) : prev);
    }).catch(() => { /* best-effort; weather stays "Any" on failure */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCloset.id]);

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
    const maybeRefreshFingerprint = async (logs, plans) => {
      if (!apiKey) return;
      const count = (logs || []).length;
      if (count < 5) return;
      try {
        const fp = await sb.getStyleFingerprint().catch(() => null);
        const have = fp?.source_count || 0;
        if (fp && count - have < 10) return;   // still fresh enough
        const { generateStyleFingerprint } = await import("./features/stylist/styleFingerprint.js");
        const edits = await sb.fetchLookEdits().catch(() => []);
        const fresh = await generateStyleFingerprint({ items, logs, plans, edits, apiKey });
        if (fresh?.text) { setStyleFingerprint(fresh); sb.saveStyleFingerprint(fresh).catch(() => {}); }
      } catch { /* non-fatal — regenerate next session */ }
    };

    // Favorites + outfit history together → recently-worn (anti-repeat) and
    // loved looks (elevation exemplars for the stylist), plus the fingerprint
    // refresh above. Logs + plans come through refreshWearData, the shared
    // fetch that also derives wear stats (stylist RESTING tag + Home metrics).
    Promise.all([sb.fetchFavorites(), refreshWearData()]).then(([favs, { plans, logs }]) => {
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

      // Disliked looks = thumbs-down look_feedback rows (newest first, capped).
      sb.fetchDislikedLooks().then(rows => setDislikedLooks(rows || [])).catch(() => {});

      // Editor corrections → SWAP LESSONS (newest first, capped in the client).
      sb.fetchLookEdits().then(rows => setLookEdits(rows || [])).catch(() => {});

      // Loved look_feedback rows → OCCASION MEMORY (with the raw logs above).
      // Fetched once here alongside the wearData refresh so generation never
      // pays a per-tap network call.
      sb.fetchLovedLooks().then(rows => setLovedFeedback(rows || [])).catch(() => {});

      maybeRefreshFingerprint(logs || [], plans || []);
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

    // API keys are per-device (localStorage) and deliberately never fetched
    // from Supabase — that table is readable with the anon key, which ships in
    // the client bundle. See lib/supabase.js and migration 0026.

    reloadFromSupabase();
  }, [reloadFromSupabase, refreshWearData]);

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

  const addItems = useCallback(async (newItems) => {
    // Mark every new item pending_sync until Supabase confirms it. The merge
    // logic uses this flag to preserve local-only items on reload — without
    // it, an item uploaded optimistically could be dropped as "deleted
    // elsewhere" if the user reloads before upsert finishes.
    // New items land in the ACTIVE closet unless they already carry one
    // (e.g. server rows re-added by the Settings recovery flow).
    const pendingNew = newItems.map(it => ({ ...it, closet_id: it.closet_id || activeCloset.id, pending_sync: true }));
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
  }, [items, activeCloset.id]);

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
    // Image replaced → invalidate the derived server thumbnail so every device
    // rebuilds it from the new image (a stale thumb otherwise outlives the
    // swap forever; Thumb.jsx falls back to the full image on the 404).
    const prevItem = items.find(it => it.id === id);
    if (resolvedFields.image && prevItem?.image && resolvedFields.image !== prevItem.image) {
      sb.removeThumb(id).catch(() => {});
      // Belt-and-braces: also drop this device's "thumb exists" memory. If the
      // DELETE above fails, the derived thumb URL still 200s with stale bytes
      // (no onError), so the local forget is the only reliable invalidation.
      forgetThumb(id);
    }
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

  // Background cutout re-cut: once per session, a few seconds after the closet
  // has settled, quietly re-crop a handful of items whose transparent padding
  // was never actually trimmed. Pure image cropping (no AI, no cost); converges
  // over sessions via the is_recut flag so it never redoes work. Guarded to run
  // a single time per mount so item-state updates don't retrigger it.
  useEffect(() => {
    if (recutRan.current || !items?.length) return;
    if (!items.some(it => it.image && it.is_recut !== true)) return;
    recutRan.current = true;
    const t = setTimeout(() => {
      runRecutDrip({ items, updateItem, limit: 12 }).catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, [items, updateItem]);

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

  // ── Duplicate into the other closet (athleisure/lounge twins) ──
  // Sources that already have a twin, so the grid hides their ⧉ button.
  const duplicatedIds = useMemo(() => duplicatedSourceIds(items), [items]);

  const duplicateItem = useCallback(async (item) => {
    const target = duplicateTargetCloset(item, closets.length ? closets : SEED_CLOSETS);
    if (!target) return;
    const newId = crypto.randomUUID();
    let image = item.image || "";
    if (image && !image.startsWith("data:")) {
      // Give the twin its own storage object; on failure fall back to sharing
      // the source's URL — a photo that vanishes only if the source item is
      // ever deleted beats no photo at all. (A base64 image skips this: the
      // addItems upload path stores it under the new id anyway.)
      try { image = await sb.copyImage(item.id, newId); } catch { /* keep source URL */ }
    }
    // addItems handles optimistic state, upsert, pending_sync, and sync flash.
    await addItems([buildDuplicate(item, target.id, newId, image)]);
  }, [closets, addItems]);

  const deleteItem = useCallback(async (id) => {
    const updated = items.filter(it => it.id !== id);
    persistItems(updated);
    flashSync("syncing");
    try {
      await sb.remove(id);
      // Cascade cleanup: remove the deleted item from garment_ids / items /
      // item_ids arrays across outfit_logs, planned_outfits, and look_feedback.
      // Fire-and-forget — partial cleanup is fine; never block the delete UX.
      sb.cascadeItemDelete(id).catch(() => {});
      sb.removeImage(id).catch(() => {}); // best-effort Storage cleanup
      flashSync("synced");
    } catch { flashSync("error"); }
  }, [items, persistItems]);

  // ── Bulk "move to closet" (Phase A §6) ──
  const toggleSelected = useCallback((id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const moveSelectedToCloset = useCallback(async (closetId) => {
    const ids = selectedIds;
    if (ids.length === 0 || moveBusy) return;
    const idSet = new Set(ids);
    // Remember each moved row's original closet so a failed PATCH can revert
    // JUST closet_id — restoring a whole-array snapshot could clobber
    // unrelated item updates that land while the request is in flight.
    const prevClosetById = new Map(
      items.filter(it => idSet.has(it.id)).map(it => [it.id, it.closet_id || null]),
    );
    const moved = items.map(it => idSet.has(it.id) ? { ...it, closet_id: closetId } : it);
    setMoveBusy(true);
    // Optimistic: the rows leave the active closet's grid immediately.
    persistItems(moved);
    flashSync("syncing");
    try {
      await sb.setClosetBulk(ids, closetId);
      setSelectMode(false);
      setSelectedIds([]);
      flashSync("synced");
    } catch (e) {
      console.error("Bulk closet move failed:", e);
      setItems(prev => {
        const reverted = prev.map(it =>
          prevClosetById.has(it.id) ? { ...it, closet_id: prevClosetById.get(it.id) } : it);
        saveLocalItems(reverted);
        return reverted;
      });
      flashSync("error");
      alert("⚠️ Couldn't move those items to the other closet — check your connection and try again.");
    } finally {
      setMoveBusy(false);
    }
  }, [selectedIds, moveBusy, items, persistItems]);

  // Pre-fill the Style Me request with a phrasing the sampler / validator
  // can recognize, then jump to the panel. Used by ItemCard's spark button.
  const styleWithItem = useCallback((it) => {
    const desc = `${it.color ? it.color + " " : ""}${it.subcategory || it.category}`.trim();
    setRequest(`include my ${desc} "${it.name}"`);
    setView("style");
    setStylePanelOpen(true);
  }, [setView]);

  // "Build a similar look" from a saved log. Seeds Style Me with the original
  // look's silhouette description + its occasion / weather, then opens
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
    // Pre-fill occasion / weather from the original look so the user doesn't
    // have to re-set them. Multi-tag aware (legacy logs use the singular
    // field, newer ones use the plural array). Saved logs may still carry a
    // legacy meta.mood in collage_url — the mood feature was removed by owner
    // request, so it's displayed in history but no longer pre-filled here.
    const occ = (Array.isArray(log?.occasions) ? log.occasions[0] : null) || log?.occasion;
    if (occ) setOccasion(occ);
    const wx = (Array.isArray(log?.weathers) ? log.weathers[0] : null) || log?.weather;
    if (wx) setWeather(new Set([wx]));
    setView("style");
    setStylePanelOpen(true);
  }, [items, setView]);

  const isFav = useCallback((type, refId) =>
    favorites.some(f => f.type === type && f.reference_id === refId),
  [favorites]);

  // Set-backed piece-favorite test for the closet grids — isFav is O(favorites)
  // and the grids call it once per card per render (~470 cards on the landing
  // view). Same answer, O(1) per card.
  const favPieceIds = useMemo(
    () => new Set(favorites.filter(f => f.type === "piece").map(f => f.reference_id)),
    [favorites],
  );

  // Landing-view sections, memoized: these ran inside the render JSX on every
  // App state tick (sync flash, weather chips, Style Me streaming), filtering
  // + date-sorting the whole closet each time. Date.parse is hoisted so the
  // sort doesn't allocate two Date objects per comparison.
  const { recentItems, uncategorized } = useMemo(() => {
    const now = Date.now();
    const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
    const stamped = closetItems
      .map(it => ({ it, t: it.created_at ? Date.parse(it.created_at) : NaN }))
      .filter(x => Number.isFinite(x.t) && now - x.t < TWO_WEEKS)
      .sort((a, b) => b.t - a.t);
    return {
      recentItems: stamped.map(x => x.it),
      // True uncategorized = missing top-level category. Subcategory is not
      // always available (Belts/Jumpsuits have no subcategory list in
      // taxonomy.js, so checking !it.subcategory left them stranded).
      uncategorized: closetItems.filter(it => !it.category),
    };
  }, [closetItems]);

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

  // Stable handlers for the memo'd ItemCard grid (see ItemCard.jsx). Declared
  // AFTER toggleFav so their dep arrays don't reference it in the temporal dead
  // zone — that ordering bug (#100) crashed every render with a blank screen.
  const handleEditItemCard = useCallback((item) => {
    setEditItem(item); setEditReturnView(viewRef.current); setView("edit");
  }, [setView]);
  const handleToggleFavPiece = useCallback((item) => toggleFav("piece", item.id), [toggleFav]);

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
      // Stable identity for the rendered card. The list key used to be the
      // joined item ids, but the in-place editor (swap/remove/add) changes
      // those — an id-based key would remount the card mid-edit and close
      // the editor after every swap. Edits preserve _uid via spread.
      _uid: look._uid || Math.random().toString(36).slice(2),
      items: (look.items || []).map(item =>
        typeof item === "object" ? item.id : String(item).replace(/^ID:/i, "").trim()
      ),
      layout_data: look.layout_data || aiLayout || undefined,
      mood: look.vibe || look.mood || "",
      occasion: look.occasion || fallbackOccasion,
      // Stamp the weather the look was generated under so saving it to History
      // captures weather too (the manual builder already did; Style Me didn't).
      // outfit_logs has weather + weathers columns, so this round-trips.
      weather: look.weather || ([...weather].join(" + ") || null),
      weathers: look.weathers || [...weather],
      styling: look.rationale || look.styling || "",
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
    // Synchronous re-entrancy guard (a ref, because `styling` state lags a
    // render): two overlapping generations sample the SAME rotation snapshot
    // and re-suggest the same pieces — the production 2026-08-08 repetition
    // window shows exactly that burst signature. One generation at a time.
    if (generationBusyRef.current) return;
    generationBusyRef.current = true;
    let streamedAny = false;
    let streamedCount = 0; // looks streamed in THIS batch — the final splice below trims exactly these
    try {
      const onLook = (look) => {
        const normalized = normalizeLooks([look], occasion);
        streamedCount += normalized.length;
        // Both modes append here: "fresh" starts from a nulled outfits state
        // (handleStyle clears it), so appending builds the new set in order.
        setOutfits(prev => [...(prev || []), ...normalized]);
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
      // Overlay calendar-derived wear so the stylist sees accurate last_worn
      // (drives the [RESTING] rediscovery tag). Falls back to the item as-is
      // when there's no wear record.
      const itemsForStyling = applyWearStats(closetItems, wearStatsRef.current);
      // Auto color pairs — in-fashion pairs her closet already supports,
      // merged alongside her hand-picked list (deterministic, zero AI calls).
      // She asked to stop having to type her own colors; this is that.
      const basePrefs = loadStylePrefs();
      const stylePrefsWithAuto = {
        ...basePrefs,
        autoPairs: autoColorPairs(itemsForStyling, { exclude: basePrefs?.colorPairs || [], max: 3 }).map(p => p.label),
      };
      const { generateOutfit } = await import("./lib/ai/stylist.js");
      const result = await generateOutfit(
        itemsForStyling, occasion, weatherLabel, request, apiKey, allLooks,
        stylePrefsWithAuto, loadAboutMe(), styleExcludes,
        { feedbackScores, recentlyWornItems, onLook, inspirationVibes, styleFingerprint: fingerprintText, lovedLooks, dislikedLooks, lookEdits,
          // Occasion memory inputs (roadmap A4) — raw rows already in state,
          // summarized to text lines inside generateOutfit (occasionMemory.js).
          outfitLogs: wearData.logs || [], lovedFeedback,
          // Hearted pieces — a tiny within-band sampler tiebreaker (see closet-sampler.js).
          favoriteItemIds: favorites.filter(f => f.type === "piece").map(f => f.reference_id),
          count }
      );
      if (result?.no_viable_looks) {
        throw new Error(result.stylist_note || "The stylist couldn't build a suitable look from your current wardrobe for this combination.");
      }
      const looks = result?.looks;
      if (!looks || !Array.isArray(looks) || looks.length === 0) {
        throw new Error("AI returned no looks — try again.");
      }
      const normalizedLooks = normalizeLooks(looks, occasion);
      // Replace the streamed slice for THIS generation with the validated
      // final set. For "fresh", normalizedLooks is the whole thing; for
      // "append", we need to keep prior looks and replace only the tail.
      setOutfits(prev => {
        // For "append", only the streamed tail of THIS batch is replaced —
        // trim by the count actually streamed, since salvage can make the
        // final set larger or smaller than what streamed, and trimming by
        // final size would eat prior looks. Reconciliation below must only
        // see that tail, or an edited PRIOR look would be re-adopted into
        // the new batch and rendered twice.
        const priorCount = mode === "append" ? Math.max(0, (prev?.length || 0) - streamedCount) : 0;
        const head = (prev || []).slice(0, priorCount);
        const tail = (prev || []).slice(priorCount);
        // The final set gets fresh _uids from normalizeLooks, but the streamed
        // version of the same look is already on screen (possibly hearted).
        // Re-adopt the prior _uid when the item set is unchanged so the card
        // doesn't remount. (The in-place mid-stream edit path was removed
        // 2026-08-13 — Edit now opens the builder, which saves to Looks and
        // never mutates the on-screen results.)
        const tailByIds = new Map(tail.map(lk => [(lk.items || []).join(","), lk]));
        const consumed = new Set();
        const reconciled = normalizedLooks.map(lk => {
          const match = tailByIds.get((lk.items || []).join(","));
          if (match && !consumed.has(match._uid)) {
            consumed.add(match._uid);
            return { ...lk, _uid: match._uid };
          }
          return lk;
        });
        return [...head, ...reconciled];
      });
      setAllLooks(prev => [...prev, ...normalizedLooks].slice(-30));
    } catch(e) {
      console.error("Generation error:", e);
      if (streamedAny) {
        // Some looks already surfaced and are valid — a stricter final pass just
        // couldn't land the *rest*. Keep what's shown; never replace real looks
        // with an error wall.
        setStyleErr("");
      } else if (e.name === "ValidationError") {
        // Never show the validator's rulebook to the user — that's debug text.
        setStyleErr("Couldn't quite land a full set this time — tap Style Me to try again.");
      } else {
        // API/network errors already carry a friendly message from the AI layer.
        setStyleErr(e.message || "Styling failed — try again in a moment.");
      }
    } finally {
      generationBusyRef.current = false;
      // Fire-and-forget: mirror this device's updated anti-repeat memory to
      // user_settings so her other devices rotate around these looks too.
      // Merge the remote copy first — a blind push was last-writer-wins, so
      // two devices styling in the same window clobbered each other's memory.
      (async () => {
        try {
          const remote = await sb.getRotationState();
          mergeRemoteRotationState(remote);
        } catch { /* offline — push local as-is */ }
        sb.saveRotationState(exportRotationState());
      })();
    }
  };

  const handleStyle = async () => {
    if (!apiKey) { setStyleErr("Add your Anthropic API key in Settings first."); return; }
    if (closetItems.length < 3) { setStyleErr(`Add at least 3 items to this closet first (you have ${closetItems.length}).`); return; }
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
  // The holding room is showing only while its chip is selected AND this
  // closet actually holds Misc items — otherwise the chip isn't even rendered.
  const isMiscView = !!activeFilters.category?.includes(MISC_CATEGORY) && miscItems.length > 0;

  // Bulk-select mode only makes sense over the item grids on the closet view;
  // entering the Sets view (or navigating away) hides those grids AND the
  // Select toggle, so without this the sticky move bar would linger over a
  // view that can't see the selection.
  useEffect(() => {
    if (selectMode && (isSetView || view !== "closet")) {
      setSelectMode(false);
      setSelectedIds([]);
    }
  }, [selectMode, isSetView, view]);
  const setGroupsRaw = isSetView ? (() => {
    const groups = {};
    closetItems.filter(it => it.set_id).forEach(it => {
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
    // Color filter — the FilterBar chips stay visible in the Sets view, so they
    // have to do something here: a set matches when ANY member item matches,
    // through the same predicate the item grid uses.
    if (activeFilters.color?.length) {
      result = result.filter(g => g.items.some(it => matchesColorFilter(it, activeFilters.color)));
    }
    // Sort
    if (setsSort === "type") {
      result.sort(compareSetsByType);
    } else if (setsSort === "alpha") {
      result.sort(compareSetsByName);
    } else if (setsSort === "count") {
      result.sort((a, b) => b.items.length - a.items.length);
    } else {
      result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return result;
  })() : null;

  // Defer the search term so typing stays responsive — the 400-item filter+sort
  // runs against the deferred value while the input updates immediately. Memoize
  // so it only recomputes when the inputs actually change (not on every render,
  // e.g. the sync-status flash timer).
  const deferredSearch = useDeferredValue(closetSearch);
  const filtered = useMemo(() => {
    // Holding room: the ONE place Misc items re-enter the app. They carry no
    // color/brand/set/wear metadata, so the rest of the filter stack has
    // nothing to say about them — the view is simply the closet's Misc items,
    // A→Z by name (miscItemsForCloset already sorts).
    if (isMiscView) return miscItems;
    let base = closetItems;
    const cats = activeFilters.category?.filter(c => c !== "Sets") || [];
    if (cats.length)  base = base.filter(it => cats.includes(it.category));
    // subcatMatches is L2-aware (2026-08-13): selecting "Hosiery"/"Skirts"
    // shows every row filed under their L3 children too — literal equality
    // matched nothing for parents whose rows all carry L3 labels.
    if (activeFilters.subcategory?.length) base = base.filter(it => activeFilters.subcategory.some(v => subcatMatches(it, v)));
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
    // Color chips (families + the denim wash chips) — see matchesColorFilter,
    // shared with the Sets view so the two never drift apart.
    if (activeFilters.color?.length) {
      base = base.filter(it => matchesColorFilter(it, activeFilters.color));
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
    // Global search filter — matches name, brand, color, subcategory, notes,
    // tags, material, pattern, category. Multi-word queries are AND'd: every
    // whitespace-separated term must match somewhere ("black silk blouse"
    // finds items matching all three terms, not any one of them).
    if (deferredSearch.trim()) {
      const terms = deferredSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
      base = base.filter(it => {
        const haystack = [
          it.name, it.brand, it.color, it.color_family, it.subcategory,
          it.category, it.notes, it.pattern, it.material,
          Array.isArray(it.tags) ? it.tags.join(" ") : it.tags,
        ].filter(Boolean).join(" ").toLowerCase();
        return terms.every(t => haystack.includes(t));
      });
    }
    return isSetView ? [] : [...base].sort(defaultSortComparator);
  }, [closetItems, activeFilters, deferredSearch, isSetView, isMiscView, miscItems]);

  // Sync status indicator
  const syncLabel = syncStatus === "syncing" ? "⟳ syncing"
    : syncStatus === "synced"  ? "✓ saved"
    : syncStatus === "error"   ? "⚠ offline"
    : null;
  const syncColor = syncStatus === "error" ? "var(--color-danger)"
    : syncStatus === "synced" ? "var(--color-success)" : "var(--color-accent)";

  // Filter chips reflect the actual wardrobe: types she owns none of are
  // hidden (a "No Sneakers" chip with zero sneakers is noise), and within
  // each group the most-worn types lead. Falls back to the full static list
  // until items load. activeKeys keeps a toggled chip visible regardless.
  const filterChips = useMemo(
    () => computeFilterChips(closetItems, wearData.stats || {}, styleExcludes),
    [closetItems, wearData.stats, styleExcludes],
  );

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
              decision and stay sticky across occasion changes.
              STYLE_ME_OCCASIONS is the trimmed six-chip set — Active / Travel
              Day / Vacation still exist app-wide (planner, history) but are
              intentionally absent from this picker per the owner. */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6}}>WHERE ARE YOU GOING?</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {STYLE_ME_OCCASIONS.map(o => (
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

          {/* FILTERS — tri-state garment-type chips. Each cycles
              off → NO (never use it, red) → ONLY (build around it, green) → off.
              "Only" within a group is a union (Only Jeans + Only Skirts = the
              lower half must be jeans OR a skirt); per-type tri-state makes a
              No/Only contradiction on the same type impossible. Matching logic
              lives in utils/style-filters.js, shared with sampler + validator.
              Chips are wardrobe-aware (computeFilterChips): unowned types are
              hidden, most-worn types lead within their group. */}
          <div style={{fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:3}}>FILTERS</div>
          <div style={{fontSize:9, color:"var(--color-text-muted)", marginBottom:6, fontStyle:"italic"}}>
            tap once = never &nbsp;·&nbsp; tap twice = only &nbsp;·&nbsp; tap again = off
          </div>
          <div style={{display:"flex", flexWrap:"wrap", gap:6, marginBottom:12}}>
            {filterChips.map(({key, label, mode}) => {
              const noKey = `no-${key}`, onlyKey = `only-${key}`;
              const state = styleExcludes.has(noKey) ? "no" : styleExcludes.has(onlyKey) ? "only" : "off";
              const chipStyle = state === "no"
                ? {...s.chip, background:"var(--color-danger)", borderColor:"var(--color-danger)", color:"#fff", fontSize:11, padding:"5px 11px", fontWeight:500}
                : state === "only"
                  ? {...s.chip, background:"var(--color-success)", borderColor:"var(--color-success)", color:"#fff", fontSize:11, padding:"5px 11px", fontWeight:500}
                  : {...s.chip, fontSize:11, padding:"5px 11px"};
              return (
                <button key={key} style={chipStyle}
                  onClick={() => setStyleExcludes(prev => {
                    const next = new Set(prev);
                    if (next.has(noKey)) { next.delete(noKey); next.add(onlyKey); }
                    else if (next.has(onlyKey)) { next.delete(onlyKey); }
                    else { next.add(noKey); }
                    return next;
                  })}>
                  {/* Layer chips (blazers/knits/stockings) are include-mode:
                      the third state is a positive "work one in" ask, not an
                      exclusive Only — label it honestly. */}
                  {state === "no" ? `✕ No ${label}` : state === "only" ? (mode === "include" ? `✚ Include ${label}` : `✓ Only ${label}`) : label}
                </button>
              );
            })}
          </div>

          {/* ANYTHING SPECIFIC? */}
          <input placeholder="Anything specific? (e.g. 'include my red blazer', 'all black', 'navy and brown')"
            value={request} onChange={e=>setRequest(e.target.value)}
            style={{...s.input, width:"100%", fontSize:12, marginBottom:8}}/>
          {request && (
            <div style={{fontSize:10, color:"var(--color-text-muted)", marginTop:-4, marginBottom:8, fontStyle:"italic"}}>
              ✦ Applied as the theme for every look you generate. Named pieces are force-included.
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

  // One closet-grid card renderer for all three grid sections. In select
  // mode the card becomes a tap-to-toggle target with a ✓ badge (same
  // pattern as ShoppingView's "Complete a Look" picker) and the per-item
  // action buttons are suppressed; otherwise it's the normal ItemCard.
  const renderClosetGridItem = (item) => {
    if (!selectMode) {
      // ⧉ Duplicate-into-the-other-closet, athleisure/lounge only (she buys
      // those in twos — one NYC, one Arizona). Hidden once a twin exists.
      const dupTarget = canOfferDuplicate(item, duplicatedIds)
        ? duplicateTargetCloset(item, closets.length ? closets : SEED_CLOSETS)
        : null;
      // A holding-room card is inert: no "style around this piece" (it would
      // put a pyjama name into a stylist prompt for a piece the pool doesn't
      // even contain) and no favouriting (loved pieces bias generation). Edit
      // and delete stay — renaming it, or moving it out of Arizona, is the
      // whole point of tracking it.
      const misc = isMiscItem(item);
      return (
        <ItemCard key={item.id} item={item} allItems={stylingItems}
          onDelete={deleteItem}
          onEdit={handleEditItemCard}
          onDuplicate={dupTarget ? duplicateItem : undefined}
          duplicateHint={dupTarget?.name}
          isFavorited={favPieceIds.has(item.id)}
          isPacked={!!packedIds?.has(item.id)}
          onToggleFav={misc ? undefined : handleToggleFavPiece}
          onStyleItem={misc ? undefined : styleWithItem}/>
      );
    }
    const isSelected = selectedIds.includes(item.id);
    return (
      <div key={item.id}
        style={{...s.card, border: isSelected ? "2px solid var(--color-ink)" : "1px solid var(--color-border)", cursor:"pointer"}}
        onClick={() => toggleSelected(item.id)}>
        <div style={s.cardImg}>
          {item.image
            ? <Thumb item={item} alt={item.name} style={s.cardPhoto}/>
            : <div style={s.cardPlaceholder}>{item.category?.[0] || "?"}</div>}
          {isSelected && <div style={s.selectBadge}>✓</div>}
        </div>
        <div style={s.cardBody}>
          <div style={s.cardCat}>{item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}</div>
          <div style={s.cardName}>{item.name}</div>
        </div>
      </div>
    );
  };

  return (
    <div style={s.app}>
      {/* GLOBAL KEYFRAMES */}
      <style>{`
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
            {closetItems.length > 0 && (
              <span style={s.badge}>{closetItems.length}</span>
            )}
            {syncLabel && (
              <span
                style={{...s.savedPill, background: syncColor, cursor: syncStatus === "error" ? "pointer" : "default"}}
                title={syncStatus === "error" ? "Tap to retry loading your wardrobe" : undefined}
                onClick={(e) => { if (syncStatus === "error") { e.stopPropagation(); reloadFromSupabase(); } }}
              >{syncStatus === "error" ? "⚠ offline — tap to retry" : syncLabel}</span>
            )}
          </button>
          {/* Active-closet chip — a mode switch, not a filter. Tapping opens
              a small popover listing every closet (✓ on the active one).
              During an active trip the chip reads as trip mode: the pool is
              destination closet + packed items, and switching closets only
              takes effect once the trip ends (the popover says so). */}
          <div style={{ position:"relative", flexShrink:1, minWidth:0, zIndex:2 }}>
            <button
              style={s.closetChip}
              onClick={() => setClosetMenuOpen(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={closetMenuOpen}
              title={activeTrip
                ? `Trip mode: ${activeTrip.destination || activeTrip.destination_city || "trip"}`
                : `Closet: ${activeCloset.name} — tap to switch`}
            >
              <span style={s.closetChipName}>
                {activeTrip ? `✈ ${activeTrip.destination || activeTrip.destination_city || "Trip"}` : activeCloset.name}
              </span>
              <span style={{ fontSize:7, flexShrink:0 }}>▼</span>
            </button>
            {closetMenuOpen && (
              <>
                {/* Invisible backdrop: any outside tap closes the popover. */}
                <div style={{ position:"fixed", inset:0, zIndex:-1 }} onClick={() => setClosetMenuOpen(false)}/>
                <div style={s.closetMenu} role="listbox" aria-label="Switch closet">
                  {activeTrip && (
                    <div style={{ ...s.closetMenuItem, cursor:"default", borderBottom:"1px solid var(--color-border)", borderRadius:0, marginBottom:4 }}>
                      <span style={{ fontWeight:600 }}>
                        ✈ Trip mode — pool = {closets.find(c => c.id === activeTrip.destination_closet_id)?.name || "suitcase only"} + packed items
                      </span>
                      <span style={s.closetMenuCity}>Closet switches take effect after the trip.</span>
                    </div>
                  )}
                  {closets.map(c => (
                    <button
                      key={c.id}
                      role="option"
                      aria-selected={c.id === activeCloset.id}
                      style={c.id === activeCloset.id ? {...s.closetMenuItem, ...s.closetMenuItemActive} : s.closetMenuItem}
                      onClick={() => switchCloset(c.id)}
                    >
                      <span>{c.id === activeCloset.id ? "✓ " : ""}{c.name}</span>
                      {c.city && <span style={s.closetMenuCity}>{c.city}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
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
            <button onClick={() => setView("settings")}
              style={{...s.navBtn, ...(view==="settings" ? s.navActive : {})}}>
              <Icon path={icons.settings} size={15}/>
            </button>
          </nav>
        </div>
      </header>

      <Suspense fallback={<RouteFallback/>}>
      <ErrorBoundary scope="view" key={view} onReset={() => setView("closet")}>
      {/* ── CLOSET ── */}
      {view === "home" && (
        <div style={s.page}>
          <div style={{ ...s.pageHeader, justifyContent: "center" }}>
            <h2 style={{...s.pageTitle, fontFamily:"'DM Serif Display',Georgia,serif"}}>Atelier</h2>
          </div>
          <HomeView
            items={closetItems}
            activeCloset={activeCloset}
            favorites={favorites}
            apiKey={apiKey}
            plans={wearData.plans}
            wearStats={wearData.stats}
            onRefreshWearData={refreshWearData}
            onOpenPlanner={() => setView("planner")}
            onOpenStyle={() => { setView("style"); setStylePanelOpen(true); }}
            onStyleRequest={(req) => { setRequest(req); setView("style"); setStylePanelOpen(true); }}
            brandDiscovery={brandDiscovery}
            onOpenDiscovery={() => setView("discovery")}
            onOpenShop={() => setView("shop")}
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
          <FilterBar items={closetItems} activeFilters={activeFilters} onChange={setActiveFilters}
            showMisc={miscItems.length > 0}/>

          {/* Global search bar */}
          <div style={{ position:"relative", marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Search name, brand, color, notes…"
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

          {/* Bulk "move to closet" — Select toggles a multi-select mode on
              the grids below; the sticky bottom bar does the actual move. */}
          {!isSetView && closetItems.length > 0 && closets.length > 1 && (
            <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
              <button
                style={selectMode ? {...s.chip, ...s.chipActive} : s.chip}
                onClick={() => { setSelectMode(v => !v); setSelectedIds([]); }}>
                {selectMode ? "✕ Cancel select" : "Select"}
              </button>
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
                  <option value="type">By Type</option>
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
                  {setsSearch || setsTagFilter || activeFilters.color?.length
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
                      isSplit={splitSetIds.has(group.setId)}
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
                groupItems={setMembers(stylingItems, editingSet, activeCloset.id)}
                allItems={closetItems}
                onSave={(data) => { updateSetMeta(editingSet, data); setEditingSet(null); }}
                onDelete={() => { deleteSetMeta(editingSet); setEditingSet(null); }}
                onClose={() => setEditingSet(null)}
                onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); setEditingSet(null); }}
                onAddItem={(item) => updateItem(item.id, { set_id: editingSet, is_separable: true })}
              />
            )}
          </>)}

          {/* Landing view: Recently Added + uncategorized when no filters active
              AND no search is running (else it stacks above search results). */}
          {!isSetView && !closetSearch.trim() && !activeFilters.category?.length && !activeFilters.subcategory?.length && !activeFilters.color?.length && !activeFilters.brand?.length && !activeFilters.sets && !activeFilters.lastWorn && (() => {
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
                      {recentItems.map(renderClosetGridItem)}
                    </div>
                  </div>
                )}
                {showUncat && (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", color: "var(--color-text-2)", marginBottom: 10, textTransform: "uppercase" }}>
                      Needs Categorizing
                    </div>
                    <div style={s.grid}>
                      {uncategorized.map(renderClosetGridItem)}
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
              {filtered.map(renderClosetGridItem)}
            </div>
          ))}

          {/* Empty closet state — a closet holding nothing but Misc items is
              not "empty" while she's standing in the holding room. */}
          {closetItems.length === 0 && !isMiscView && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
              <p style={s.emptyText}>This closet is empty — add your first piece.</p>
              <button style={s.btnPrimary} onClick={() => setView("add")}>
                <Icon path={icons.plus} size={15}/> Add Items
              </button>
            </div>
          )}

          {/* Select mode swaps the bottom chrome (Style Me panel + FAB) for
              the sticky move bar so the two never overlap. */}
          {!selectMode && stylePanelNode}

          {selectMode && (
            <div style={s.bulkBar}>
              <span style={{ fontSize:12, color:"var(--color-text-2)", flexShrink:0 }}>
                {selectedIds.length} selected
              </span>
              {closets.filter(c => c.id !== activeCloset.id).map(c => (
                <button key={c.id}
                  style={{...s.btnPrimary, padding:"8px 14px", opacity: selectedIds.length === 0 || moveBusy ? 0.5 : 1}}
                  disabled={selectedIds.length === 0 || moveBusy}
                  onClick={() => moveSelectedToCloset(c.id)}>
                  {moveBusy ? <><span style={s.spinnerSmLight}/> Moving…</> : `Move to ${c.name}`}
                </button>
              ))}
              <button
                style={{...s.btnSecondary, padding:"8px 14px", marginLeft:"auto"}}
                onClick={() => { setSelectMode(false); setSelectedIds([]); }}>
                Cancel
              </button>
            </div>
          )}

          {/* FAB */}
          {!selectMode && (
            <button style={s.fab} onClick={() => setView("add")}>
              <Icon path={icons.plus} size={22}/>
            </button>
          )}
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
          allItems={stylingItems}
          closets={closets}
          setsMeta={setsMeta}
          onSaveSetMeta={updateSetMeta}
          logs={wearData.logs}
          plans={wearData.plans}
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
          items={builderItems}
          setsMeta={setsMeta}
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
          } : builderSeed}
          initialSaveMode={editingPlan ? "schedule" : "looks"}
          initialScheduleDate={editingPlan?.iso || null}
          onSave={async (log) => {
            // Mirror SavedView's onSave: when SilhouetteBuilder set
            // editing_log_id (user opened an existing log via the Edit
            // affordance), PATCH that row rather than INSERTing — and either
            // way strip editing_log_id, which isn't a real column.
            const { editing_log_id, ...patch } = log;
            // Edit-from-results (builderSeed): diff her final pick against
            // the generated look and record the changes as A1 look_edits
            // lessons — same signal the old in-place editor produced, now
            // derived instead of hand-instrumented. Pair a removal with an
            // addition in the same slot as a swap; leftovers log as
            // remove/add. Fire-and-forget.
            if (builderSeed?.garment_ids?.length) {
              try {
                const seedIds = builderSeed.garment_ids;
                const savedIds = log.garment_ids || [];
                const seedSet = new Set(seedIds);
                const savedSet = new Set(savedIds);
                const byId = new Map(items.map(it => [it.id, it]));
                const removed = seedIds.filter(id => !savedSet.has(id)).map(id => byId.get(id)).filter(Boolean);
                const added = savedIds.filter(id => !seedSet.has(id)).map(id => byId.get(id)).filter(Boolean);
                const addedBySlot = new Map();
                for (const it of added) {
                  const k = slotForItem(it);
                  if (!addedBySlot.has(k)) addedBySlot.set(k, []);
                  addedBySlot.get(k).push(it);
                }
                const edits = [];
                for (const out of removed) {
                  const pool = addedBySlot.get(slotForItem(out));
                  const inn = pool?.length ? pool.shift() : null;
                  edits.push(inn
                    ? { action: "swap", outItemId: out.id, inItemId: inn.id }
                    : { action: "remove", outItemId: out.id, inItemId: null });
                }
                for (const pool of addedBySlot.values()) {
                  for (const it of pool) edits.push({ action: "add", outItemId: null, inItemId: it.id });
                }
                const occ = log.occasion || null;
                const wx = log.weather || null;
                for (const e of edits) {
                  const edit = { ...e, occasion: occ, weather: wx };
                  sb.saveLookEdit(edit);
                  setLookEdits(prev => [{
                    action: edit.action,
                    occasion: edit.occasion,
                    weather: edit.weather,
                    out_item_id: edit.outItemId,
                    in_item_id: edit.inItemId,
                    created_at: new Date().toISOString(),
                  }, ...prev].slice(0, 120));
                }
              } catch { /* the save itself must never wait on the lesson */ }
            }
            const result = editing_log_id
              ? await sb.updateOutfitLog(editing_log_id, patch)
              : await sb.saveOutfitLog(patch);
            if (log.date_worn) {
              await sb.setLastWornBulk(log.garment_ids || [], log.date_worn);
              bumpWearCounts(log.garment_ids || []);
              pinWornToDate({ date: log.date_worn, itemIds: log.garment_ids || [], occasion: log.occasion }).catch(() => {});
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
              // An idx past the end APPENDS — that's the calendar's
              // "build another look for this day" path, which carries the
              // picked daypart in newOutfitLabel (appendOutfit back-labels the
              // existing lone look "Day" when an Evening one joins it).
              const idx = editingPlan?.tripOutfitIdx ?? 0;
              let outfits;
              if (current.length === 0) {
                outfits = [{ id: newOutfitId(), label: "", occasion: plan.occasion || null, items: plan.items || [] }];
              } else if (current[idx]) {
                outfits = current.map((o, i) => i === idx
                  ? { ...o, items: plan.items || [], occasion: o.occasion || plan.occasion || null }
                  : o);
              } else {
                outfits = appendOutfit(current, { id: newOutfitId(), label: editingPlan?.newOutfitLabel || "", occasion: plan.occasion || null, items: plan.items || [] });
              }
              const isTrip = editingPlan?.tripOutfitIdx != null || existing?.source === "trip";
              const merged = buildPlanPayload({
                date: plan.date,
                outfits,
                source: existing?.source || (isTrip ? "trip" : plan.source) || "planner",
                notes: existing?.notes ?? plan.notes ?? null,
                weather: existing?.weather ?? plan.weather ?? null,
                activity: existing?.activity ?? null,
                day_label: existing?.day_label ?? null,
                // Forward the builder's multi-tag selections — without these,
                // buildPlanPayload rederives singletons and the extra
                // occasion/weather chips picked in the builder were dropped.
                occasions: plan.occasions,
                weathers: plan.weathers,
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
            setBuilderSeed(null);
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
            {/* Manual-builder entry for the loading + results states. The
                empty state renders its own (single) button below, so this
                only appears when that one can't — keeping exactly one
                manual-build affordance on the page in every state
                (regression 2026-08-08: with results on screen there was
                no way back into the manual builder without force-quitting). */}
            {(outfits || styling) && (
              <button
                style={{...s.backBtn, marginLeft:"auto", fontSize:12, letterSpacing:"0.04em"}}
                onClick={() => setManualBuilderOpen(true)}>
                ⊞ Build manually
              </button>
            )}
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
            <LookCard key={look._uid || `${i}:${(look.items || []).map(it => (typeof it === "object" ? it.id : it)).join(",")}`} look={look} items={closetItems}
              onEditItem={handleEditItemCard}
              onEditInBuilder={(lk) => {
                const ids = (lk.items || []).map(it => typeof it === "object" ? it.id : it);
                setBuilderSeed({
                  garment_ids: ids,
                  occasions: [lk.occasion || occasion].filter(Boolean),
                  weathers: lk.weather ? [lk.weather] : [...weather],
                  notes: null,
                  layout_data: Array.isArray(lk.layout_data) ? lk.layout_data : null,
                });
                setManualBuilderOpen(true);
              }}
              onRate={async (lk, rating) => {
                try {
                  const itemIds = (lk.items || []).map(it => typeof it === "object" ? it.id : it);
                  // Mood feature removed — lookHash treats a missing mood as ""
                  // so new hashes stay stable, and legacy hashes (which baked a
                  // mood in) simply never collide with new ones.
                  await saveLookFeedback({
                    lookHash: lookHash({ occasion: lk.occasion || occasion, itemIds }),
                    rating,
                    itemIds,
                    occasion: lk.occasion || occasion,
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
                  await sb.setLastWornBulk(ids, dateWorn);
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
          {/* Empty state: the Style Me panel is already open (or one tap away
              via the fixed collapsed button), so the only affordance needed
              here is the single manual-build entry (owner request 2026-08-08:
              one manual build on this page, no redundant copy or buttons). */}
          {!outfits && !styling && (
            <div style={s.empty}>
              <div style={s.emptyMark}>✦</div>
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
        <ColorAdvisorView items={closetItems} apiKey={apiKey} onBack={() => setView("settings")}/>
      )}

      {/* ── PLANNER (F3) ── */}
      {view === "planner" && (
        <div style={s.page}>
          <div style={s.pageHeader}>
            <button style={s.backBtn} onClick={() => setView("closet")}>← Back</button>
            <h2 style={s.pageTitle}>Planner</h2>
          </div>
          <PlannerWrapper
            items={closetItems}
            allItems={stylingItems}
            closets={closets}
            activeCloset={activeCloset}
            onRefreshActiveTrip={refreshActiveTrip}
            onItemsClosetChanged={applyItemsClosetChange}
            apiKey={apiKey}
            onGoToStyleMe={() => setView("style")}
            onEditItem={(item) => { setEditItem(item); setEditReturnView(viewRef.current); setView("edit"); }}
            onEditPlan={(iso, plan) => {
              setEditingPlan({ iso, plan });
              setBuilderReturnView(viewRef.current);
              setManualBuilderOpen(true);
              setView("style");
            }}
            onBuildDay={(iso, existingIds, tripOutfitIdx = null, newOutfitLabel = null, poolIds = null) => {
              // tripOutfitIdx is set when Build is opened from a specific
              // outfit on a trip-detail day. We carry it through editingPlan
              // so the save path can update outfits[idx] in the JSONB array
              // instead of overwriting the legacy `items` column (which the
              // trip view doesn't read from when outfits[] is present).
              // newOutfitLabel rides along when the calendar appends a fresh
              // look ("Day"/"Evening") so the save path can stamp it.
              // poolIds rides along from the trip detail view: a trip's pool is
              // destination ∪ home ∪ whatever the trip already holds, which is
              // wider than any one closet. Without it the swap sheet would
              // offer only the active closet while editing a look that is
              // cross-closet by construction.
              setEditingPlan({ iso, plan: { date: iso, items: existingIds }, tripOutfitIdx, newOutfitLabel, poolIds });
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
          items={closetItems}
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
            if (dateWorn) unpinWornFromDate({ date: dateWorn, itemIds: ids }).catch(() => {});
            const updated = items.map(it =>
              ids.includes(it.id) ? {...it, wear_count: Math.max(0, (it.wear_count || 0) - 1)} : it
            );
            persistItems(updated);
          }}
          onLogAsWorn={async (log, date) => {
            await sb.updateOutfitLog(log.id, { date_worn: date });
            const ids = log?.garment_ids || [];
            await sb.setLastWornBulk(ids, date);
            bumpWearCounts(ids); // F6
            // Pin this look to the planner on the date worn so the calendar
            // reflects what she actually wore (user request: "items I mark
            // as worn, put them on the calendar on the date that I wore them").
            pinWornToDate({ date, itemIds: ids, occasion: log?.occasion }).catch(() => {});
            const updated = items.map(it =>
              ids.includes(it.id)
                ? {...it, last_worn: date, wear_count: (it.wear_count || 0) + 1}
                : it
            );
            persistItems(updated);
            flashSync("synced");
          }}
          onWearAgain={async (log) => {
            const today = nyToday();
            const newLog = {
              garment_ids: log.garment_ids,
              date_worn: today,
              occasion: log.occasion,
              notes: null,
              collage_url: log.collage_url,
            };
            await sb.saveOutfitLog(newLog);
            const ids = log.garment_ids || [];
            await sb.setLastWornBulk(ids, today);
            bumpWearCounts(ids); // F6
            // Mirror the wear onto the planner calendar.
            pinWornToDate({ date: today, itemIds: ids, occasion: log.occasion }).catch(() => {});
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
              await sb.setLastWornBulk(log.garment_ids || [], log.date_worn);
              bumpWearCounts(log.garment_ids || []);
              // Pin to the planner on the date worn.
              pinWornToDate({ date: log.date_worn, itemIds: log.garment_ids || [], occasion: log.occasion }).catch(() => {});
            }
            return Array.isArray(result) ? result[0] : result;
          }}
          onFavoriteLook={async (savedLog) => {
            const result = await sb.addFavorite("outfit", savedLog.id);
            setFavorites(prev => [...(Array.isArray(result) ? result : [result]), ...prev]);
          }}
          onSchedule={async (plan) => {
            // Always reconcile against the existing row so scheduling a saved
            // look onto an already-planned day appends an outfit rather than
            // clobbering the existing one.
            try {
              const rows = await fetchPlansBetween(plan.date, plan.date);
              const existing = (Array.isArray(rows) && rows[0]) || null;
              const current = outfitsOf(existing);
              const newOutfit = { id: newOutfitId(), label: "", occasion: plan.occasion || null, items: plan.items || [] };
              const outfits = current.length === 0 ? [newOutfit] : [...current, newOutfit];
              const merged = buildPlanPayload({
                date: plan.date, outfits,
                source: existing?.source || plan.source || "saved",
                notes: existing?.notes ?? plan.notes ?? null,
                weather: existing?.weather ?? plan.weather ?? null,
                activity: existing?.activity ?? null,
                day_label: existing?.day_label ?? null,
                // Forward multi-tags from the scheduled look (see builder
                // onSchedule above) so they aren't collapsed to singletons.
                occasions: plan.occasions,
                weathers: plan.weathers,
              });
              // Persist the builder's canvas arrangement when this look becomes
              // the day's primary outfit (#0 is the only slot whose layout
              // round-trips at the row) — this handler used to keep only the
              // EXISTING row's layout, so scheduling a manual build onto an
              // empty day silently dropped the arrangement and the planner
              // review fell back to the auto collage (owner report 2026-08-05).
              if (current.length === 0 && plan.layout_data) merged.layout_data = plan.layout_data;
              else if (existing?.layout_data) merged.layout_data = existing.layout_data;
              await savePlan(merged);
            } catch {
              await savePlan(plan); // last-resort fallback
            }
          }}
          onBuildSimilar={buildSimilarLook}
        />
      )}

      {/* ── INSIGHTS ── */}
      {view === "insights" && (
        <StyleInsightsView items={closetItems} apiKey={apiKey} onBack={() => setView("settings")}/>
      )}

      {/* ── SHOPPING ── */}
      {view === "shop" && (
        <ShoppingView items={closetItems} apiKey={apiKey} onBack={() => setView("settings")}/>
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
            // Auto-save (silent) doesn't navigate; only the explicit
            // Save Settings button bounces back to closet.
            if (!opts.silent) setView("closet");
          }}
          onAddItems={addItems}
          onForceSync={forceSyncAll}
          onNavigate={setView}
          onBack={() => setView("closet")}/>
      )}

      {/* ── STYLE PROFILE (roadmap B — her stylist's file; entry card on Home,
             pointer in Settings; placement "Inside Home" chosen by owner) ── */}
      {view === "profile" && (
        <StyleProfileView
          items={closetItems}
          apiKey={apiKey}
          styleFingerprint={styleFingerprint}
          setStyleFingerprint={setStyleFingerprint}
          lovedLooks={lovedLooks}
          logCount={wearData.logs ? wearData.logs.length : null}
          onBack={() => setView("settings")}
          onEditItem={(item) => { setEditItem(item); setEditReturnView("profile"); setView("edit"); }}
        />
      )}

      {/* ── Brand Atlas — lesser-known brand discovery (cached; scouting only
             on explicit tap inside the view) ── */}
      {view === "discovery" && (
        <BrandDiscoveryView
          items={closetItems}
          apiKey={apiKey}
          discovery={brandDiscovery}
          setDiscovery={setBrandDiscovery}
          onBack={() => setView("home")}
        />
      )}

      {view === "visionpilot" && (
        <VisionPilotView
          items={closetItems}
          apiKey={apiKey}
          onBack={() => setView("settings")}
          onEnriched={(id, vd) => setItems(prev => prev.map(it => it.id === id ? { ...it, vision_data: vd } : it))}
        />
      )}
      </ErrorBoundary>
      </Suspense>
    </div>
  );
}
