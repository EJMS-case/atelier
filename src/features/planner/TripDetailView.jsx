// ── F3 — TRIP DETAIL VIEW ────────────────────────────────────────────────────
// Full trip overview: per-day looks with AI generation + manual build option,
// plus a packing tab that groups all unique items by category with worn-day
// counts and coverage warnings.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPlansBetween, savePlan, deletePlan, updateTrip, deleteTrip,
  fetchActiveTrip, fetchTripItems, upsertTripItems, deleteTripItems, setTripItemStatus, updateTripItemOutfits,
} from "./plannerApi.js";
import { sb } from "../../lib/supabase.js";
import { reconcileTripItems } from "./packingSync.js";
import { analyzeTripDestination, generateTripDayLook } from "../../lib/ai/tripAdvisor.js";
import { geocodeDestination } from "../../lib/geocode.js";
import { fetchTripForecast, bucketFromHigh, isNotableCondition } from "../../lib/weather.js";
import { SEASONAL_HIGHS } from "../../lib/time.js";
import EditorialCollage from "../../components/EditorialCollage.jsx";
import TrimmedImage from "../../components/TrimmedImage.jsx";
import { outfitsOf, newOutfitId, buildPlanPayload, flattenPlanItemIds, outfitCoverageGaps } from "./outfits.js";
import { resolveItemIds } from "../../utils/item-helpers.js";
import { TRIP_ACTIVITIES, buildDailyOutfits } from "./tripPacker.js";
import MustIncludePicker from "./MustIncludePicker.jsx";
import { DEFAULT_CLOSET_ID } from "../closet/closets.js";
import { OCCASIONS, normalizeOccasion } from "../../constants/taxonomy.js";
import { PALETTE_STRONG } from "../../constants/palette.js";

// Accent stays a literal hex (matches --color-accent-strong): this view builds
// alpha variants by string concatenation (`${PALETTE.accent}0A`), which a
// var() reference can't do.
const PALETTE = PALETTE_STRONG;

const CAT_ORDER = ["Outerwear", "Dresses", "Jumpsuits", "Sets", "Tops", "Knits", "Bottoms", "Shoes", "Bags", "Accessories", "Belts", "Occasionwear"];

// ── helpers ───────────────────────────────────────────────────────────────────

function tripDays(startIso, endIso) {
  const days = [];
  let cur = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return days;
}

function friendlyDay(iso, index) {
  const d = new Date(iso + "T00:00:00Z");
  const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `Day ${index + 1} · ${label}`;
}

function parseBrief(notes) {
  if (!notes) return null;
  try { return JSON.parse(notes); } catch { return null; }
}

// Compare two id lists order-independently.
function sameIds(a, b) {
  const x = [...(a || [])].sort();
  const y = [...(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Heal rows corrupted by the old bare-savePlan divergence: a plan's legacy
// top-level `items` is the most-recently-written truth for the primary outfit
// (the calendar reads it), but `outfits[0]` could be stale if a build saved
// only `items`. When they disagree, trust `items` for outfit #0 and keep the
// other outfits untouched. Returns { plan, changed }.
function healPlan(r) {
  if (!Array.isArray(r?.items) || r.items.length === 0) return { plan: r, changed: false };
  if (!Array.isArray(r?.outfits) || r.outfits.length === 0) return { plan: r, changed: false };
  const first = r.outfits[0];
  if (sameIds(first?.items, r.items)) return { plan: r, changed: false };
  const outfits = [{ ...first, items: r.items }, ...r.outfits.slice(1)];
  return { plan: { ...r, outfits }, changed: true };
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {Object}   props.trip       - { id, start_date, end_date, destination, notes,
 *                                       destination_closet_id, destination_city, status }
 * @param {Object[]} props.items      - the app's scoped pool (active closet, or the
 *                                      trip pool while a trip is active)
 * @param {Object[]} [props.allItems] - the FULL wardrobe — source of destination-
 *                                      closet pieces when the trip has one (Phase B)
 * @param {Object[]} [props.closets]  - closet rows, to name the destination closet
 * @param {string}   props.apiKey
 * @param {Function} props.onBack
 * @param {Function} props.onBuildDay - (iso, existingItemIds) → opens SilhouetteBuilder
 * @param {Function} [props.onRefreshActiveTrip] - re-syncs App's trip-mode pool after
 *                                      status/packing changes (wave 2)
 * @param {Function} [props.onItemsClosetChanged] - (ids, closetId) → patch App's local
 *                                      items state after a bulk closet reassign (B5)
 */
export default function TripDetailView({ trip: initialTrip, items, allItems, closets, apiKey, onBack, onBuildDay, onRefreshActiveTrip, onItemsClosetChanged }) {
  // Local copy so "+ Add day" can mutate end_date without re-fetching the
  // trip list. Re-syncs to the parent's prop if the user picks a different
  // trip (handled by the useEffect on initialTrip.id below).
  const [trip, setTrip] = useState(initialTrip);
  useEffect(() => { setTrip(initialTrip); }, [initialTrip.id]);

  const [tab, setTab] = useState("looks");
  const [plans, setPlans] = useState({});       // { iso: plan }
  // True only after a SUCCESSFUL plans fetch — the trip_items reconcile below
  // must never run against an empty map that just means "offline".
  const [plansLoaded, setPlansLoaded] = useState(false);
  // ── Packing checklist state (wave 2 — B4) ──
  const [tripItems, setTripItems] = useState([]);          // trip_items rows
  const [tripItemsLoaded, setTripItemsLoaded] = useState(false);
  const [packedNote, setPackedNote] = useState("");        // "no longer needed" notice
  const [statusBusy, setStatusBusy] = useState(false);     // start / complete in flight
  const [closeBusy, setCloseBusy] = useState(false);       // suitcase-close in flight
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [stayingIds, setStayingIds] = useState(new Set()); // B5 "staying behind" picks
  // "Bringing for sure" pins (trips.must_include_ids, migration 0033). Held
  // locally and written through updateTrip so a regeneration from this view
  // honours the same picks the trip was set up with. An older trip — or a
  // project without the migration — reads as an empty set and behaves exactly
  // as before pins existed.
  const [mustIncludeIds, setMustIncludeIds] = useState(
    () => new Set(initialTrip.must_include_ids || []),
  );
  const [showPinPicker, setShowPinPicker] = useState(false);
  useEffect(() => {
    setMustIncludeIds(new Set(initialTrip.must_include_ids || []));
  }, [initialTrip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [brief, setBrief] = useState(() => parseBrief(trip.notes));
  const [briefLoading, setBriefLoading] = useState(false);
  const [generatingDay, setGeneratingDay] = useState(null); // iso
  const [dayOccasion, setDayOccasion] = useState({});  // { iso: occasion }
  // Per-day Activity (Theme Park / Beach / Resort / …). Overrides trip.activity
  // for generation on that day. Persisted on the plan row's `activity` column.
  const [dayActivity, setDayActivity] = useState({});  // { iso: activity }
  // Free-text day-level label ("Disneyland with kids", "Pool day"). Editable
  // before any outfit exists; persisted on the plan row's `day_label` column.
  const [dayLabel, setDayLabel] = useState({});        // { iso: label }
  const [error, setError] = useState("");
  // Per-day Open-Meteo forecast at the destination, keyed by iso.
  // null until geocode + forecast resolve; falls back to the trip-level
  // brief temperature for days outside the 16-day forecast horizon.
  const [forecast, setForecast] = useState(null);
  // Moving an outfit between days. dragSource identifies the outfit being
  // dragged (desktop HTML5 DnD); dragOverIso drives the drop-highlight on the
  // hovered day card. movePicker is the touch path — it opens a compact
  // "move to" day list on the outfit, since HTML5 DnD never fires on touch.
  const [dragSource, setDragSource] = useState(null);   // { iso, outfitIdx }
  const [dragOverIso, setDragOverIso] = useState(null); // iso
  const [movePicker, setMovePicker] = useState(null);   // { iso, outfitIdx }

  const days = useMemo(() => tripDays(trip.start_date, trip.end_date), [trip]);

  // Fetch plans for every day in the trip
  const refreshPlans = async () => {
    try {
      const rows = await fetchPlansBetween(trip.start_date, trip.end_date);
      const map = {};
      for (const raw of rows || []) {
        // Repair any row left divergent by the old save bug, then persist the
        // repair once so the trip and calendar agree from here on.
        const { plan: r, changed } = healPlan(raw);
        if (changed) {
          savePlan(buildPlanPayload({
            date: r.date,
            outfits: outfitsOf(r),
            source: r.source || "trip",
            notes: r.notes || null,
            weather: r.weather || null,
            activity: r.activity || null,
            day_label: r.day_label || null,
          })).catch(() => {});
        }
        map[r.date] = r;
        // Restore per-day overrides from saved plan
        if (r.occasion && !dayOccasion[r.date]) {
          setDayOccasion(prev => ({ ...prev, [r.date]: r.occasion }));
        }
        if (r.activity && !dayActivity[r.date]) {
          setDayActivity(prev => ({ ...prev, [r.date]: r.activity }));
        }
        if (r.day_label && !dayLabel[r.date]) {
          setDayLabel(prev => ({ ...prev, [r.date]: r.day_label }));
        }
      }
      setPlans(map);
      setPlansLoaded(true);
    } catch { /* silent — planner still usable offline */ }
  };

  useEffect(() => { setPlansLoaded(false); refreshPlans(); /* eslint-disable-line */ }, [trip.id]);

  // Fetch the trip's checklist rows. fetchTripItems THROWS on failure so an
  // unreadable list is never mistaken for an empty one — tripItemsLoaded
  // stays false and the reconcile below won't run against a lie.
  const refreshTripItems = async () => {
    try {
      const rows = await fetchTripItems(trip.id);
      setTripItems(Array.isArray(rows) ? rows : []);
      setTripItemsLoaded(true);
    } catch { /* leave whatever we had */ }
  };
  useEffect(() => {
    setTripItems([]); setTripItemsLoaded(false); setPackedNote("");
    refreshTripItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // Fetch destination brief once, save to trips.notes so it's free next time
  useEffect(() => {
    if (brief || !trip.destination || !apiKey) return;
    setBriefLoading(true);
    analyzeTripDestination(trip.destination, trip.start_date, apiKey)
      .then(result => {
        if (!result) return;
        setBrief(result);
        updateTrip(trip.id, { notes: JSON.stringify(result) }).catch(() => {});
      })
      .finally(() => setBriefLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // Geocode the destination once and pull a 16-day forecast for it. Trips
  // beyond the forecast horizon fall back to the AI brief's typical-high
  // temperature; trips without a destination skip this entirely.
  useEffect(() => {
    if (!trip.destination) { setForecast(null); return; }
    let cancelled = false;
    (async () => {
      const geo = await geocodeDestination(trip.destination);
      if (!geo || cancelled) return;
      const fc = await fetchTripForecast(geo.lat, geo.lon, geo.timezone);
      if (!cancelled) setForecast(fc);
    })();
    return () => { cancelled = true; };
  }, [trip.destination]);

  // Per-day weather bucket. Priority:
  //   1. Real Open-Meteo forecast at the destination (within 16 days)
  //   2. AI-brief typical high for the destination (any horizon)
  //   3. Seasonal NYC estimate (last-resort fallback for trips without a
  //      destination set or before the brief arrives)
  const weatherForDay = (iso) => {
    const forecastHigh = forecast?.[iso]?.high;
    if (forecastHigh != null) return bucketFromHigh(forecastHigh);
    const highF = brief?.tempHighF ?? SEASONAL_HIGHS[new Date(iso + "T00:00:00Z").getMonth()];
    return bucketFromHigh(highF);
  };
  // Used for the per-day temperature label (more accurate than brief.tempHighF
  // when the destination forecast is available).
  const tempHighForDay = (iso) =>
    forecast?.[iso]?.high ?? brief?.tempHighF ?? null;

  // ── Generation pool (Phase B) ──────────────────────────────────────────
  // With a destination closet: merge its items (from the full wardrobe) into
  // the scoped `items` prop and prefer them when scoring/generating — packing
  // cost zero. Same rule as TripModal's preview pool. Without one, this is
  // just `items` and no preference (pre-Phase-B behavior).
  const closetOf = (it) => it?.closet_id || DEFAULT_CLOSET_ID;
  const destClosetId = trip.destination_closet_id || null;
  const { genItems, preferItemIds } = useMemo(() => {
    if (!destClosetId) return { genItems: items, preferItemIds: null };
    const seen = new Set(items.map(it => it.id));
    const extra = (allItems || []).filter(it => closetOf(it) === destClosetId && !seen.has(it.id));
    const pool = [...items, ...extra];
    return {
      genItems: pool,
      preferItemIds: new Set(pool.filter(it => closetOf(it) === destClosetId).map(it => it.id)),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, allItems, destClosetId]);

  // FULL-wardrobe lookup — the packing checklist + reconcile must see every
  // item regardless of the current pool scoping (during an ACTIVE trip the
  // scoped `items` prop excludes still-suggested home pieces, which are
  // exactly the rows the checklist is about).
  const wardrobeAll = (allItems && allItems.length) ? allItems : items;

  // Resolve item-id list to item objects for DISPLAY. Resolves against the FULL
  // wardrobe, not the generation pool: a saved outfit is a record and can hold
  // a piece from any closet, and during an ACTIVE trip the scoped pool drops
  // still-unpacked home pieces — either way the piece would silently vanish
  // from the card rather than render. Only genuinely deleted items drop out.
  // (The generation pools below stay scoped; this is read-only.)
  const resolveItems = (ids) => resolveItemIds(wardrobeAll, ids);
  const itemsById = useMemo(
    () => new Map(wardrobeAll.map(it => [it.id, it])),
    [wardrobeAll],
  );

  // ── Trip_items reconcile (wave 2 — B4) ────────────────────────────────────
  // ONE reconcile site for the whole view (per the handoff warning about the
  // 7 drifting copies elsewhere): a debounced effect watches `plans` and
  // diffs the outfits against trip_items via the pure packingSync helper —
  // newly pulled pieces appear as 'suggested', rows nothing references any
  // more are deleted (packed ones surface a "no longer needed" note). Every
  // mutation path (AI regen, build, move, untick regeneration, close
  // suitcase) funnels through here just by updating `plans`.
  const plansRef = useRef(plans);
  plansRef.current = plans;
  const tripItemsRef = useRef(tripItems);
  tripItemsRef.current = tripItems;
  // Status read through a ref: a debounced/chained reconcile must see the
  // status at EXECUTION time, not the render it was scheduled in — otherwise
  // a pending run could mutate trip_items on a just-completed trip.
  const tripStatusRef = useRef(trip.status);
  tripStatusRef.current = trip.status;
  // Read through a ref: applyReconcile runs off a serialized promise chain and
  // must see the pins as of the moment it runs, not when it was queued.
  const mustIncludeRef = useRef(mustIncludeIds);
  mustIncludeRef.current = mustIncludeIds;
  // Serialize runs so overlapping plan updates can't interleave diffs.
  const reconcileChainRef = useRef(Promise.resolve());

  async function applyReconcile() {
    if (tripStatusRef.current === "complete") return;
    // Cold-start guard: an unloaded wardrobe would read as "every item was
    // deleted" and wipe the checklist. No items → no reconcile.
    if (itemsById.size === 0) return;
    // Snapshot BEFORE the optimistic apply below: the insert/update split in
    // the write phase must reflect what the SERVER knows, and the ref may
    // re-render to include the optimistic rows before the writes run.
    const priorRows = tripItemsRef.current || [];
    const { rowsToUpsert, idsToDelete, removedPackedIds } = reconcileTripItems({
      tripId: trip.id,
      plans: plansRef.current,
      tripItems: priorRows,
      destClosetId,
      itemsById,
      mustIncludeIds: mustIncludeRef.current,
    });
    if (rowsToUpsert.length === 0 && idsToDelete.length === 0) return;
    // Optimistic local apply; a failed remote write re-syncs from the server.
    setTripItems(prev => {
      const del = new Set(idsToDelete);
      const upsertBy = new Map(rowsToUpsert.map(r => [r.item_id, r]));
      const seen = new Set();
      const next = prev
        .filter(r => !del.has(r.item_id))
        .map(r => { seen.add(r.item_id); return upsertBy.has(r.item_id) ? { ...r, ...upsertBy.get(r.item_id) } : r; });
      for (const r of rowsToUpsert) if (!seen.has(r.item_id)) next.push(r);
      return next;
    });
    if (removedPackedIds.length > 0) {
      const names = removedPackedIds.map(id => itemsById.get(id)?.name || id).join(", ");
      setPackedNote(`${names} — no longer needed by any outfit. Unpack ${removedPackedIds.length === 1 ? "it" : "them"}.`);
    }
    try {
      // Existing rows get an outfit_ids-only PATCH so a status tick racing in
      // from the checklist is never clobbered back to 'suggested'; only rows
      // the server hasn't seen are POSTed whole.
      const known = new Set(priorRows.map(r => r.item_id));
      const inserts = rowsToUpsert.filter(r => !known.has(r.item_id));
      const updates = rowsToUpsert.filter(r => known.has(r.item_id));
      if (inserts.length) await upsertTripItems(inserts);
      for (const r of updates) await updateTripItemOutfits(trip.id, r.item_id, r.outfit_ids);
      if (idsToDelete.length) await deleteTripItems(trip.id, idsToDelete);
      if (tripStatusRef.current === "active") onRefreshActiveTrip?.();
    } catch {
      refreshTripItems();
    }
  }
  const runReconcile = () => {
    reconcileChainRef.current = reconcileChainRef.current
      .then(() => applyReconcile())
      .catch(() => {});
    return reconcileChainRef.current;
  };
  useEffect(() => {
    if (!plansLoaded || !tripItemsLoaded || trip.status === "complete") return;
    const t = setTimeout(runReconcile, 600);
    // trip.status in the deps: completing the trip cancels a pending run
    // (and the status ref stops any already-queued chain entry).
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, plansLoaded, tripItemsLoaded, trip.status]);

  // Packing temperature for one day — tempHighForDay's forecast→brief chain
  // with the seasonal last resort (one priority rule, defined once above).
  const highForDay = (iso) =>
    tempHighForDay(iso) ?? SEASONAL_HIGHS[new Date(iso + "T00:00:00Z").getMonth()];

  // Which outfit ids currently reference an item (across the whole trip).
  const outfitIdsFor = (itemId) => {
    const out = new Set();
    for (const iso of days) {
      for (const o of outfitsOf(plans[iso])) {
        if ((o.items || []).includes(itemId)) out.add(o.id);
      }
    }
    return [...out].sort();
  };

  // ── Untick regeneration (wave 2 — the "broken outfit" rule) ───────────────
  // Pool for rebuilding outfits that lost a piece: destination-closet items
  // ∪ everything still in the suitcase (packed + suggested) MINUS the pieces
  // being excluded. Deliberately NOT the whole home closet — mid-packing the
  // suitcase is committed; regeneration works with what's actually coming.
  function regenPool(excludedIds) {
    const inSuitcase = new Set(
      tripItemsRef.current
        .filter(r => r.status === "packed" || r.status === "suggested")
        .map(r => r.item_id),
    );
    return wardrobeAll.filter(it =>
      !excludedIds.has(it.id) &&
      ((destClosetId && closetOf(it) === destClosetId) || inSuitcase.has(it.id)),
    );
  }

  // Single-outfit rebuild through the tripPacker (same shape as the
  // TripModal's buildOneOutfit): one-day build seeded with the rest of the
  // trip's wear counts so the capsule holds together.
  function buildReplacementItems(pool, iso, outfit, runningPlans) {
    const priorUse = {};
    for (const d of days) {
      for (const o of outfitsOf(runningPlans[d])) {
        if (o.id === outfit.id) continue;
        for (const id of (o.items || [])) priorUse[id] = (priorUse[id] || 0) + 1;
      }
    }
    const dayIdx = days.indexOf(iso);
    const prevDayIds = dayIdx > 0
      ? outfitsOf(runningPlans[days[dayIdx - 1]]).flatMap(o => o.items || [])
      : [];
    const single = buildDailyOutfits(pool, [highForDay(iso)], {
      occasions: [normalizeOccasion(outfit.occasion) || "Casual"],
      activities: [dayActivity[iso] || trip.activity || "Sightseeing"],
      priorUse,
      prevDayIds,
      tripDayCount: days.length,
      preferItemIds,
      // priorUse holds the rest of the trip, so a pin already living on
      // another day stays there — only a homeless pin is seated here. A pin
      // the caller is deliberately excluding isn't in `pool`, so it can't come
      // back either (that's how the leave-behind regenerate stays honest).
      mustIncludeIds,
    });
    return (single.dailyOutfits?.[0] || []).map(it => it.id);
  }

  // Rebuild every outfit that references any of `excluded`, persisting each
  // affected day through the existing persistPlan path. The reconcile effect
  // (plus the explicit runReconcile below) then drops the excluded rows.
  async function regenerateWithout(excluded) {
    // Taking a piece OUT of the suitcase overrides a pin on it — the two say
    // opposite things, and the tick she just made is the newer instruction.
    // Unpin first so neither the reconcile's carve-out re-rows it nor the
    // packer's placement pass seats it right back onto a day.
    const stillPinned = [...mustIncludeIds].filter(id => !excluded.has(id));
    if (stillPinned.length !== mustIncludeIds.size) {
      const next = new Set(stillPinned);
      setMustIncludeIds(next);
      mustIncludeRef.current = next;
      try { await updateTrip(trip.id, { must_include_ids: stillPinned }); } catch { /* non-fatal */ }
      setTrip(t => ({ ...t, must_include_ids: stillPinned }));
    }
    const pool = regenPool(excluded);
    const running = { ...plansRef.current };
    for (const iso of days) {
      const existing = outfitsOf(running[iso]);
      if (existing.length === 0) continue;
      let dayChanged = false;
      const next = existing.map(o => {
        if (!(o.items || []).some(id => excluded.has(id))) return o;
        dayChanged = true;
        // An all-swim "Pool" look can't be rebuilt by the regular composer —
        // just drop the excluded piece(s) from it.
        const resolved = resolveItemIds(wardrobeAll, o.items);
        const isPool = resolved.length > 0 && resolved.every(it => it.category === "Swim");
        const kept = (o.items || []).filter(id => !excluded.has(id));
        if (isPool) return { ...o, items: kept };
        const rebuilt = buildReplacementItems(pool, iso, o, running).filter(id => !excluded.has(id));
        // Empty rebuild (pool too thin) → keep the outfit minus the piece
        // rather than blanking the day.
        return { ...o, items: rebuilt.length ? rebuilt : kept };
      });
      if (!dayChanged) continue;
      try {
        const merged = await persistPlan(iso, next);
        running[iso] = merged;
      } catch (e) {
        setError(e.message || `Couldn't restyle ${iso}.`);
      }
    }
    // Early-sync the ref so the immediate reconcile sees the just-persisted
    // outfits even if React hasn't re-rendered yet (the debounced effect
    // re-runs with the settled state afterwards either way).
    plansRef.current = running;
    await runReconcile();
  }

  // ── Checkbox tick / untick (wave 2 — B4) ──────────────────────────────────
  async function handleTickItem(itemId) {
    const prev = tripItems;
    const row = tripItems.find(r => r.item_id === itemId);
    try {
      if (row) {
        setTripItems(ts => ts.map(r => r.item_id === itemId ? { ...r, status: "packed" } : r));
        await setTripItemStatus(trip.id, [itemId], "packed");
      } else {
        // Row not reconciled yet (fresh outfit) — create it directly.
        const newRow = { trip_id: trip.id, item_id: itemId, status: "packed", outfit_ids: outfitIdsFor(itemId) };
        setTripItems(ts => [...ts, newRow]);
        await upsertTripItems([newRow]);
      }
      if (trip.status === "active") onRefreshActiveTrip?.();
    } catch {
      setTripItems(prev);
      alert("⚠️ Couldn't update the packing list — check your connection and try again.");
    }
  }

  async function handleUntickItem(itemId) {
    const item = itemsById.get(itemId);
    const affected = outfitIdsFor(itemId).length;
    const name = item?.name || "this piece";
    const msg = affected > 0
      ? `Take "${name}" out of the suitcase? ${affected} outfit${affected === 1 ? "" : "s"} using it will be restyled without it, and it comes off the list.`
      : `Take "${name}" out of the suitcase?`;
    if (!window.confirm(msg)) return;
    const prev = tripItems;
    // Status flip first (optimistic): if the regeneration below fails, the
    // outfits are unchanged and a 'suggested' row is still consistent.
    setTripItems(ts => ts.map(r => r.item_id === itemId ? { ...r, status: "suggested" } : r));
    try {
      await setTripItemStatus(trip.id, [itemId], "suggested");
    } catch {
      setTripItems(prev);
      alert("⚠️ Couldn't update the packing list — check your connection and try again.");
      return;
    }
    if (trip.status === "active") onRefreshActiveTrip?.();
    await regenerateWithout(new Set([itemId]));
  }

  // ── Close suitcase (wave 2 — B4) ──────────────────────────────────────────
  const suggestedRows = tripItems.filter(r => r.status === "suggested");
  const packedRows = tripItems.filter(r => r.status === "packed");
  const tripItemById = new Map(tripItems.map(r => [r.item_id, r]));

  async function handleEverythingPacked() {
    if (closeBusy || suggestedRows.length === 0) return;
    const ids = suggestedRows.map(r => r.item_id);
    const prev = tripItems;
    setCloseBusy(true);
    setTripItems(ts => ts.map(r => r.status === "suggested" ? { ...r, status: "packed" } : r));
    try {
      await setTripItemStatus(trip.id, ids, "packed");
      if (trip.status === "active") onRefreshActiveTrip?.();
    } catch {
      setTripItems(prev);
      alert("⚠️ Couldn't update the packing list — check your connection and try again.");
    } finally {
      setCloseBusy(false);
    }
  }

  async function handleCloseWithUnpacked() {
    if (closeBusy || suggestedRows.length === 0) return;
    const n = suggestedRows.length;
    if (!window.confirm(
      `Close the suitcase without ${n} piece${n === 1 ? "" : "s"}? Outfits using them will be restyled from what's packed${destClosetId ? " and what's already at the destination" : ""}, and they come off the list.`,
    )) return;
    setCloseBusy(true);
    try {
      await regenerateWithout(new Set(suggestedRows.map(r => r.item_id)));
    } finally {
      setCloseBusy(false);
    }
  }

  // ── Trip activation + completion (wave 2 — status transitions) ────────────
  async function handleStartTrip() {
    if (statusBusy) return;
    setStatusBusy(true);
    setError("");
    try {
      // Only one active trip at a time — block with a clear message rather
      // than silently demoting the other one. Strict: a failed read must NOT
      // pass as "no other active trip" (fail closed into the catch below).
      const other = await fetchActiveTrip({ strict: true });
      if (other && other.id !== trip.id) {
        alert(`Finish or complete "${other.destination || other.destination_city || "your other trip"}" first — only one trip can be active at a time.`);
        return;
      }
      await updateTrip(trip.id, { status: "active" });
      setTrip(prev => ({ ...prev, status: "active" }));
      await onRefreshActiveTrip?.();
    } catch (e) {
      setError(e.message || "Couldn't start the trip.");
    } finally {
      setStatusBusy(false);
    }
  }

  function handleCompleteClick() {
    if (statusBusy) return;
    // The staying-behind prompt (B5) only makes sense when the trip HAS a
    // destination closet and something was actually packed.
    if (destClosetId && packedRows.length > 0) {
      setStayingIds(new Set());
      setCompleteModalOpen(true);
      return;
    }
    if (window.confirm("Mark this trip complete? Your closet pool goes back to the active closet.")) {
      finishTrip([]);
    }
  }

  async function finishTrip(stayingIdList) {
    if (statusBusy) return;
    setStatusBusy(true);
    setError("");
    try {
      if (destClosetId && stayingIdList.length > 0) {
        // Data hygiene (B5): pieces staying at the destination get flagged
        // AND move closets — everything else keeps its home closet_id
        // (packing never changed it).
        await setTripItemStatus(trip.id, stayingIdList, "left_behind");
        await sb.setClosetBulk(stayingIdList, destClosetId);
        setTripItems(ts => ts.map(r => stayingIdList.includes(r.item_id) ? { ...r, status: "left_behind" } : r));
        onItemsClosetChanged?.(stayingIdList, destClosetId);
      }
      await updateTrip(trip.id, { status: "complete" });
      setTrip(prev => ({ ...prev, status: "complete" }));
      setCompleteModalOpen(false);
      await onRefreshActiveTrip?.();
    } catch (e) {
      setError(e.message || "Couldn't complete the trip.");
    } finally {
      setStatusBusy(false);
    }
  }

  // Build the priorDays array (everything ALREADY planned on other days)
  // that the AI uses to avoid repeating the hero piece across the trip.
  // We flatten every outfit on every other day so a dinner look's items still
  // count against repetition for the next day's daytime look.
  // Pins the trip hasn't placed yet, given a plans snapshot. The AI path
  // generates one day at a time, so handing every day the full pin list would
  // ask each of them to wear all of it. Passing only what's still unplaced
  // spreads the pins across the trip the same way the local packer's placement
  // pass does — and once a pin is on a day, later days stop being told about
  // it. `skipOutfitId` is the outfit currently being regenerated: its items
  // don't count as placed, so a pin whose only home is that outfit is offered
  // back to it rather than lost.
  const unplacedPins = (plansMap, skipOutfitId = null) => {
    if (!mustIncludeIds.size) return mustIncludeIds;
    const placed = new Set();
    for (const d of days) {
      for (const o of outfitsOf(plansMap[d])) {
        if (skipOutfitId && o.id === skipOutfitId) continue;
        for (const id of (o.items || [])) placed.add(id);
      }
    }
    return new Set([...mustIncludeIds].filter(id => !placed.has(id)));
  };

  const pinnedItems = useMemo(
    () => resolveItemIds(wardrobeAll, [...mustIncludeIds]),
    [wardrobeAll, mustIncludeIds],
  );

  // Pieces the pin sheet may offer: "bringing for sure" means CARRYING it, so
  // anything already at the destination is excluded — it needs no packing
  // decision. Already-pinned pieces stay listed regardless so they can be
  // un-pinned. Mirrors TripModal's pinPool.
  const pinPool = useMemo(() => {
    if (!destClosetId) return genItems;
    return genItems.filter(it => closetOf(it) !== destClosetId || mustIncludeIds.has(it.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genItems, destClosetId, mustIncludeIds]);

  // Persist a pin change to trips.must_include_ids. Optimistic: the local set
  // drives generation immediately and a failed write only costs the persisted
  // copy, which the next edit retries. updateTrip strips the column on
  // PGRST204, so a project without migration 0033 keeps working with
  // session-only pins.
  async function changePins(next) {
    setMustIncludeIds(next);
    try {
      await updateTrip(trip.id, { must_include_ids: [...next] });
      setTrip(t => ({ ...t, must_include_ids: [...next] }));
    } catch { /* non-fatal — pins still apply for this session */ }
    // Rows for a newly pinned piece (and cleanup for an unpinned one) come
    // from the standard reconcile, which now reads the pin set.
    runReconcile();
  }

  const buildPriorDays = (currentIso, plansMap) =>
    days
      .filter(d => d !== currentIso && plansMap[d])
      .flatMap(d => outfitsOf(plansMap[d]).map(o => ({
        occasion: o.occasion || plansMap[d].occasion || dayOccasion[d] || "Casual",
        weather:  weatherForDay(d),
        itemIds:  o.items || [],
      })));

  // Persist a full plan row (with `outfits` and legacy mirrors) and patch the
  // local plans map. Used by every mutation path below — generate, regenerate,
  // add outfit, remove outfit, change occasion.
  async function persistPlan(iso, outfits, extras = {}) {
    const payload = buildPlanPayload({
      date: iso,
      outfits,
      source: "trip",
      notes: trip.destination || null,
      weather: weatherForDay(iso),
      activity: extras.activity ?? dayActivity[iso] ?? null,
      day_label: extras.day_label ?? dayLabel[iso] ?? null,
    });
    const saved = await savePlan(payload);
    const row = Array.isArray(saved) ? saved[0] : saved;
    const merged = { ...(row || {}), ...payload };
    setPlans(prev => ({ ...prev, [iso]: merged }));
    return merged;
  }

  // Generate a look for one outfit slot on a day. outfitIdx === null means
  // "replace the day's primary outfit if it exists, otherwise create it".
  // outfitIdx >= 0 regenerates that specific slot. outfitIdx === "append"
  // adds a new outfit to the day.
  const handleGenerate = async (iso, outfitIdx = null) => {
    if (!apiKey) { setError("Add your Anthropic API key in Settings first."); return; }
    setGeneratingDay(iso);
    setError("");
    try {
      const existing = outfitsOf(plans[iso]);
      // Decide the occasion for the new/regenerated outfit.
      let occasion;
      if (outfitIdx === "append") {
        // New outfit on the day — pick an occasion not already used, default Dinner.
        const used = new Set(existing.map(o => o.occasion).filter(Boolean));
        occasion = ["Dinner","Occasion","Lounge","Casual"].find(o => !used.has(o)) || "Dinner";
      } else if (outfitIdx == null) {
        occasion = existing[0]?.occasion || dayOccasion[iso] || "Casual";
      } else {
        occasion = existing[outfitIdx]?.occasion || dayOccasion[iso] || "Casual";
      }
      const weather   = weatherForDay(iso);
      const priorDays = buildPriorDays(iso, plans);
      const activity  = dayActivity[iso] || trip.activity || "Sightseeing";
      const skipOutfitId = outfitIdx === "append" ? null
        : (outfitIdx == null ? existing[0]?.id : existing[outfitIdx]?.id) || null;
      const look = await generateTripDayLook(genItems, occasion, weather, trip.destination, apiKey, {
        priorDays, brief, activity, preferItemIds,
        mustIncludeIds: unplacedPins(plans, skipOutfitId),
      });
      if (!look) { setError("Couldn't generate a look — try again."); return; }

      let nextOutfits;
      if (outfitIdx === "append") {
        nextOutfits = [...existing, { id: newOutfitId(), label: "", occasion, items: look.items }];
      } else if (outfitIdx == null || existing.length === 0) {
        // Replace the primary outfit (or create one if none existed).
        const id = existing[0]?.id || newOutfitId();
        const label = existing[0]?.label || "";
        nextOutfits = [{ id, label, occasion, items: look.items }, ...existing.slice(1)];
      } else {
        nextOutfits = existing.map((o, i) => i === outfitIdx
          ? { ...o, occasion, items: look.items }
          : o);
      }
      await persistPlan(iso, nextOutfits);
    } catch (e) {
      setError(e.message || "Generation failed.");
    } finally {
      setGeneratingDay(null);
    }
  };

  // Generate looks for every day that doesn't have one yet. Runs sequentially
  // so each call sees the previous days' picks via a running plans snapshot —
  // that's what gives us variety across the trip without a single megaprompt.
  const [generatingAll, setGeneratingAll] = useState(false);
  const handleGenerateAll = async () => {
    if (!apiKey) { setError("Add your Anthropic API key in Settings first."); return; }
    const empty = days.filter(iso => outfitsOf(plans[iso]).length === 0);
    if (empty.length === 0) return;
    setGeneratingAll(true);
    setError("");
    let running = { ...plans };
    for (const iso of empty) {
      setGeneratingDay(iso);
      try {
        const occasion  = dayOccasion[iso] || "Casual";
        const weather   = weatherForDay(iso);
        const priorDays = buildPriorDays(iso, running);
        const activity  = dayActivity[iso] || trip.activity || "Sightseeing";
        const look = await generateTripDayLook(genItems, occasion, weather, trip.destination, apiKey, {
          priorDays, brief, activity, preferItemIds,
          // `running` grows as days are generated, so each day is told about
          // only the pins the earlier days didn't already use.
          mustIncludeIds: unplacedPins(running),
        });
        if (!look) continue;
        const outfits = [{ id: newOutfitId(), label: "", occasion, items: look.items }];
        const payload = buildPlanPayload({
          date: iso,
          outfits,
          source: "trip",
          notes: trip.destination || null,
          weather,
          activity: dayActivity[iso] || null,
          day_label: dayLabel[iso] || null,
        });
        const saved = await savePlan(payload);
        const newPlan = { ...(Array.isArray(saved) ? saved[0] : saved || {}), ...payload };
        running = { ...running, [iso]: newPlan };
        setPlans(running);
      } catch (e) {
        setError(e.message || `Generation failed for ${iso}.`);
      }
    }
    setGeneratingDay(null);
    setGeneratingAll(false);
  };

  const handleClearDay = async (iso) => {
    try {
      await deletePlan(iso);
      setPlans(prev => { const n = { ...prev }; delete n[iso]; return n; });
    } catch { setError("Couldn't clear this day."); }
  };

  // Remove a single outfit from a day. If it's the last one, delete the whole
  // plan row so the day looks unplanned again.
  const handleRemoveOutfit = async (iso, outfitIdx) => {
    const existing = outfitsOf(plans[iso]);
    if (existing.length === 0) return;
    // Indices shift after removal — don't leave the move picker pointing at
    // whatever outfit slides into this slot.
    setMovePicker(null);
    if (existing.length === 1) return handleClearDay(iso);
    const next = existing.filter((_, i) => i !== outfitIdx);
    try {
      await persistPlan(iso, next);
    } catch (e) {
      setError(e.message || "Couldn't update this day.");
    }
  };

  // Move one outfit from a day to another: append it to the target day, then
  // remove it from the source (deleting the source plan row when it was the
  // last outfit, same as handleRemoveOutfit). Target-first ordering means a
  // mid-move failure can duplicate but never lose the outfit; refreshPlans()
  // resyncs local state with whatever actually landed.
  const handleMoveOutfit = async (fromIso, outfitIdx, toIso) => {
    if (fromIso === toIso) return;
    // Indices shift after a move — don't leave the move picker pointing at
    // whatever outfit slides into this slot (same as handleRemoveOutfit).
    setMovePicker(null);
    const source = outfitsOf(plans[fromIso]);
    const moved = source[outfitIdx];
    if (!moved) return;
    const remaining = source.filter((_, i) => i !== outfitIdx);
    try {
      await persistPlan(toIso, [...outfitsOf(plans[toIso]), moved]);
      if (remaining.length === 0) {
        await deletePlan(fromIso);
        setPlans(prev => { const n = { ...prev }; delete n[fromIso]; return n; });
      } else {
        await persistPlan(fromIso, remaining);
      }
    } catch (e) {
      setError(e.message || "Couldn't move this outfit.");
      refreshPlans();
    }
  };

  // "+ Add another outfit" → just append an empty slot. Previously this
  // auto-fired generation; users wanted to choose Generate vs Build vs leave
  // it blank themselves. The empty-outfit branch of the per-outfit render
  // shows the right CTA buttons.
  const handleAppendEmptyOutfit = async (iso) => {
    const existing = outfitsOf(plans[iso]);
    const used = new Set(existing.map(o => o.occasion).filter(Boolean));
    const occasion = ["Dinner","Occasion","Lounge","Casual"].find(o => !used.has(o)) || "Casual";
    const next = [...existing, { id: newOutfitId(), label: "", occasion, items: [] }];
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || {}), outfits: next } }));
    persistPlan(iso, next).catch(() => {});
  };

  // Free-text label edit on a single outfit. Saved immediately (with an
  // optimistic local update) so it persists without a separate Save action.
  const handleOutfitLabelChange = async (iso, outfitIdx, label) => {
    const existing = outfitsOf(plans[iso]);
    if (!existing[outfitIdx]) return;
    const next = existing.map((o, i) => i === outfitIdx ? { ...o, label } : o);
    // Optimistic local update so the input stays responsive while saving.
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || {}), outfits: next } }));
    persistPlan(iso, next).catch(() => {});
  };

  const handleOccasionChange = (iso, outfitIdx, occ) => {
    const existing = outfitsOf(plans[iso]);
    if (outfitIdx == null) setDayOccasion(prev => ({ ...prev, [iso]: occ }));
    if (!existing[outfitIdx]) {
      // No outfit yet — just remember the picked occasion for when generation runs.
      setDayOccasion(prev => ({ ...prev, [iso]: occ }));
      return;
    }
    const next = existing.map((o, i) => i === outfitIdx ? { ...o, occasion: occ } : o);
    persistPlan(iso, next).catch(() => {});
  };

  // Per-day Activity override. Persisted on the plan row even when the day
  // has no outfit yet — otherwise it'd evaporate the moment the user picks
  // an activity before generating.
  const handleDayActivityChange = (iso, act) => {
    setDayActivity(prev => ({ ...prev, [iso]: act }));
    const existing = outfitsOf(plans[iso]);
    persistPlan(iso, existing, { activity: act }).catch(() => {});
  };

  // Free-text day-level label. Same persist-on-empty-day rule.
  const handleDayLabelChange = (iso, label) => {
    setDayLabel(prev => ({ ...prev, [iso]: label }));
    const existing = outfitsOf(plans[iso]);
    // Optimistic — keep the input responsive even if the upsert lags.
    setPlans(prev => ({ ...prev, [iso]: { ...(prev[iso] || { date: iso }), day_label: label } }));
    persistPlan(iso, existing, { day_label: label }).catch(() => {});
  };

  // Extend the trip by one day at the end. The new day starts empty (no
  // plan row); the user picks activity / occasion / generates from there.
  const [addingDay, setAddingDay] = useState(false);
  const handleAddDay = async () => {
    if (addingDay) return;
    setAddingDay(true);
    try {
      const cur = new Date(trip.end_date + "T00:00:00Z");
      const nextEnd = new Date(cur.getTime() + 86400000).toISOString().slice(0, 10);
      await updateTrip(trip.id, { end_date: nextEnd });
      setTrip(prev => ({ ...prev, end_date: nextEnd }));
    } catch (e) {
      setError(e.message || "Couldn't add a day.");
    } finally {
      setAddingDay(false);
    }
  };

  // Delete the whole trip so it can be rebuilt from scratch. The trip row goes
  // first — if that fails, nothing else is touched. Day-plan rows for the
  // trip's dates are then cleared best-effort (they hold the trip's looks;
  // leaving them would strand orphan outfits on the calendar and pre-fill any
  // re-created trip with the old plan). onBack() re-fetches plans + trips, so
  // the calendar reflects the deletion immediately.
  const [deleting, setDeleting] = useState(false);
  const handleDeleteTrip = async () => {
    if (deleting) return;
    const plannedDays = days.filter(iso => outfitsOf(plans[iso]).length > 0);
    const msg = plannedDays.length > 0
      ? `Delete this trip? Its ${plannedDays.length} planned day${plannedDays.length === 1 ? "" : "s"} will be cleared from the calendar too. This can't be undone.`
      : "Delete this trip? This can't be undone.";
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      const ok = await deleteTrip(trip.id);
      if (!ok) throw new Error("Couldn't delete the trip — check your connection and try again.");
      await Promise.all(plannedDays.map(iso => deletePlan(iso).catch(() => {})));
      onBack();
    } catch (e) {
      setError(e.message || "Couldn't delete the trip.");
      setDeleting(false);
    }
  };

  // ── Derived packing data ──────────────────────────────────────────────────
  // Flattens every outfit on every day, then groups items by category with
  // per-item worn-day counts. Coverage warnings now run per OUTFIT — a day
  // with a daytime look but no dinner look flags the dinner outfit, not the
  // whole day.
  const packingData = useMemo(() => {
    const itemDays = {};  // { itemId: Set<dayIndex> }
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      if (!plan) return;
      for (const id of flattenPlanItemIds(plan)) {
        if (!itemDays[id]) itemDays[id] = new Set();
        itemDays[id].add(idx + 1);
      }
    });

    // Pinned pieces belong on the list even when no look has picked them up
    // yet — the trip_items row already exists (packingSync's carve-out), so
    // without this the checklist and the database would disagree. An empty day
    // set is what marks them as "pinned, not yet worn" in the rows below.
    for (const id of mustIncludeIds) {
      if (!itemDays[id]) itemDays[id] = new Set();
    }

    const allIds = Object.keys(itemDays);
    // Resolve against the FULL wardrobe: during an ACTIVE trip the scoped
    // pool excludes still-suggested home pieces — exactly the checklist rows.
    const usedItems = resolveItemIds(wardrobeAll, allIds);

    // Pulled vs at-destination (Phase B): pieces already living in the trip's
    // destination closet don't need carrying — they get a badge instead of a
    // slot in the suitcase count. (Wave 2 builds the real checklist.)
    const byCategory = {};
    let pulledCount = 0;
    usedItems.forEach(it => {
      const cat = it.category || "Other";
      const atDest = !!destClosetId && closetOf(it) === destClosetId;
      if (!atDest) pulledCount++;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({ item: it, days: [...itemDays[it.id]].sort((a, b) => a - b), atDest });
    });

    const sorted = CAT_ORDER
      .filter(c => byCategory[c])
      .map(c => ({ category: c, entries: byCategory[c] }));
    const extra = Object.keys(byCategory).filter(c => !CAT_ORDER.includes(c))
      .map(c => ({ category: c, entries: byCategory[c] }));

    // Coverage warnings — one row per outfit slot that's missing a core piece.
    const warnings = [];
    days.forEach((iso, idx) => {
      const plan = plans[iso];
      const outfits = outfitsOf(plan);
      if (outfits.length === 0) { warnings.push(`Day ${idx + 1}: no outfit planned`); return; }
      outfits.forEach((o, oIdx) => {
        // Shared slot-based coverage rule (outfits.js).
        const gaps = outfitCoverageGaps(resolveItems(o.items));
        const tag = outfits.length > 1 ? ` (${o.label || o.occasion || `Outfit ${oIdx + 1}`})` : "";
        if (gaps.includes("top")) warnings.push(`Day ${idx + 1}${tag}: no top or dress`);
        else if (gaps.includes("bottom")) warnings.push(`Day ${idx + 1}${tag}: no bottoms`);
        if (gaps.includes("shoes")) warnings.push(`Day ${idx + 1}${tag}: no shoes`);
      });
    });

    return {
      categories: [...sorted, ...extra],
      totalItems: allIds.length,
      pulledCount,
      atDestinationCount: usedItems.length - pulledCount,
      warnings,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, days, genItems, wardrobeAll, destClosetId, mustIncludeIds]);

  const plannedCount = days.filter(iso => outfitsOf(plans[iso]).length > 0).length;
  const weatherBucket = brief ? bucketFromHigh(brief.tempHighF) : null;

  return (
    <div style={{ paddingBottom: 100 }}>

      {/* ── Header ── */}
      <div style={{ padding: "14px 16px 0", borderBottom: `1px solid ${PALETTE.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <button onClick={onBack}
            style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 12, cursor: "pointer", letterSpacing: "0.06em", padding: 0 }}>
            ← Back to Calendar
          </button>
          <button onClick={handleDeleteTrip} disabled={deleting}
            style={{ background: "none", border: "none", color: "var(--color-danger)", fontSize: 11, cursor: deleting ? "default" : "pointer", letterSpacing: "0.06em", padding: 0, opacity: deleting ? 0.5 : 1 }}>
            {deleting ? "Deleting…" : "Delete Trip"}
          </button>
        </div>

        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>TRIP</div>
          <div style={{ fontSize: 22, fontFamily: "serif", color: PALETTE.ink, lineHeight: 1.2 }}>
            {trip.destination || "Untitled Trip"}
          </div>
          <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2 }}>
            {new Date(trip.start_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}
            {" – "}
            {new Date(trip.end_date + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
            {" · "}{days.length} day{days.length === 1 ? "" : "s"}
            {" · "}{plannedCount}/{days.length} looks planned
          </div>
        </div>

        {/* ── Trip status (wave 2): planning → Start trip; active → badge +
            Mark complete; complete → read-only badge. ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 6px", flexWrap: "wrap" }}>
          {trip.status === "active" && (
            <span style={{ padding: "4px 10px", background: PALETTE.ink, color: PALETTE.bg, borderRadius: 12, fontSize: 10, letterSpacing: "0.1em", fontWeight: 600 }}>
              ✈ ACTIVE TRIP
            </span>
          )}
          {trip.status === "complete" && (
            <span style={{ padding: "4px 10px", background: PALETTE.cream, color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 12, fontSize: 10, letterSpacing: "0.1em", fontWeight: 600 }}>
              ✓ TRIP COMPLETE
            </span>
          )}
          {trip.status === "active" ? (
            <button onClick={handleCompleteClick} disabled={statusBusy}
              style={{ padding: "5px 12px", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: statusBusy ? "default" : "pointer", opacity: statusBusy ? 0.6 : 1 }}>
              {statusBusy ? "Saving…" : "✓ Mark trip complete"}
            </button>
          ) : trip.status !== "complete" ? (
            <button onClick={handleStartTrip} disabled={statusBusy}
              style={{ padding: "5px 12px", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: statusBusy ? "default" : "pointer", opacity: statusBusy ? 0.6 : 1 }}>
              {statusBusy ? "Starting…" : "✈ Start trip"}
            </button>
          ) : null}
          {trip.status === "active" && (
            <span style={{ fontSize: 10, color: PALETTE.muted }}>
              Pool = {destClosetId ? ((closets || []).find(c => c.id === destClosetId)?.name || "destination closet") : "suitcase only"} + packed pieces
            </span>
          )}
        </div>

        {/* Climate brief */}
        {briefLoading && (
          <div style={{ fontSize: 11, color: PALETTE.muted, fontStyle: "italic", padding: "6px 0 10px" }}>
            Checking weather for {trip.destination}…
          </div>
        )}
        {brief && (
          <div style={{ padding: "8px 10px", background: `${PALETTE.accent}0A`, borderLeft: `2px solid ${PALETTE.accent}`, borderRadius: "0 6px 6px 0", marginBottom: 12, marginTop: 6 }}>
            <div style={{ fontSize: 11, color: PALETTE.ink, fontWeight: 500 }}>
              {brief.tempLowF}–{brief.tempHighF}°F · {weatherBucket}
            </div>
            <div style={{ fontSize: 11, color: PALETTE.soft, marginTop: 2 }}>{brief.weatherNotes}</div>
            <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 2, fontStyle: "italic" }}>💡 {brief.packingTip}</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginTop: 4 }}>
          {["looks", "packing"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1,
              padding: "10px 0",
              background: "none",
              border: "none",
              borderBottom: tab === t ? `2px solid ${PALETTE.ink}` : "2px solid transparent",
              color: tab === t ? PALETTE.ink : PALETTE.muted,
              fontSize: 11,
              letterSpacing: "0.14em",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              textTransform: "uppercase",
            }}>
              {t === "looks" ? `Looks (${plannedCount}/${days.length})` : `Packing (${packingData.totalItems})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ margin: "12px 16px 0", padding: "8px 12px", background: "#FBE9E7", border: `1px solid ${PALETTE.accent}`, borderRadius: 6, fontSize: 11, color: PALETTE.accent }}>
          {error}
          <button onClick={() => setError("")} style={{ marginLeft: 8, background: "none", border: "none", color: PALETTE.accent, cursor: "pointer", fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* ── LOOKS TAB ── */}
      {tab === "looks" && (
        <div style={{ padding: "16px 16px 0" }}>
          {/* Bringing for sure — pins the generator must place and the packing
              list must keep. Editable while the trip is still being planned;
              once it's complete, generation is over and this is read-only. */}
          <div style={{ marginBottom: 14, padding: "10px 12px", border: `1px solid ${PALETTE.line}`, borderRadius: 8, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, letterSpacing: "0.14em", color: PALETTE.muted }}>BRINGING FOR SURE</span>
              {trip.status !== "complete" && (
                <button onClick={() => setShowPinPicker(true)}
                  style={{ background: "transparent", border: `1px solid ${PALETTE.line}`, borderRadius: 999, color: PALETTE.ink, fontSize: 11, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {mustIncludeIds.size ? "Edit picks" : "+ Pick pieces"}
                </button>
              )}
            </div>
            {pinnedItems.length > 0 ? (
              <>
                <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
                  {pinnedItems.map(it => (
                    <div key={it.id} title={it.name}
                      style={{ position: "relative", flexShrink: 0, width: 46, height: 46, padding: 2, background: "#fff", border: `1px solid ${PALETTE.ink}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                      {it.image
                        ? <TrimmedImage src={it.image} alt={it.name} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                        : <span style={{ fontSize: 9, color: PALETTE.muted }}>{it.name?.slice(0, 8)}</span>}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4, fontStyle: "italic", lineHeight: 1.5 }}>
                  Kept on the packing list whatever the looks do. Regenerate a day to build it around
                  {pinnedItems.length === 1 ? " this piece" : " these pieces"}.
                </div>
              </>
            ) : (
              <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 4, fontStyle: "italic", lineHeight: 1.5 }}>
                Pin the pieces you know you're taking and regenerated looks will be built around them.
              </div>
            )}
          </div>

          {/* Generate-all CTA: only shown when at least one day is empty. Runs
              sequentially so prior picks inform later ones (variety). */}
          {days.some(iso => outfitsOf(plans[iso]).length === 0) && (
            <button
              onClick={handleGenerateAll}
              disabled={generatingAll || !apiKey}
              style={{
                width: "100%",
                padding: "10px 0",
                marginBottom: 14,
                background: PALETTE.ink,
                color: PALETTE.bg,
                border: "none",
                borderRadius: 8,
                fontSize: 11,
                letterSpacing: "0.14em",
                cursor: generatingAll ? "default" : "pointer",
                opacity: generatingAll ? 0.6 : 1,
              }}>
              {generatingAll
                ? <><span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> Styling your trip…</>
                : `✦ Generate all empty days (${days.filter(iso => outfitsOf(plans[iso]).length === 0).length})`}
            </button>
          )}
          {days.map((iso, idx) => {
            const plan = plans[iso];
            const outfits = outfitsOf(plan);
            const wx = weatherForDay(iso);
            const isGenerating = generatingDay === iso;
            const hasOutfits = outfits.length > 0;
            // A day is a drop target while an outfit from a DIFFERENT day is
            // in flight; the source day never highlights (same-day = no-op).
            const isDropTarget = dragSource != null && dragSource.iso !== iso;
            const isDropHover = isDropTarget && dragOverIso === iso;

            return (
              <div key={iso}
                onDragOver={isDropTarget ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverIso !== iso) setDragOverIso(iso);
                } : undefined}
                onDragLeave={isDropTarget ? (e) => {
                  // dragleave fires when entering children too — only clear
                  // when the pointer genuinely left this card.
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragOverIso(cur => (cur === iso ? null : cur));
                  }
                } : undefined}
                onDrop={isDropTarget ? (e) => {
                  e.preventDefault();
                  const src = dragSource;
                  setDragSource(null);
                  setDragOverIso(null);
                  handleMoveOutfit(src.iso, src.outfitIdx, iso);
                } : undefined}
                style={{
                marginBottom: 14,
                border: `1px solid ${isDropHover ? PALETTE.accent : hasOutfits ? PALETTE.accent + "40" : PALETTE.line}`,
                borderRadius: 10,
                overflow: "hidden",
                background: isDropHover ? `${PALETTE.accent}0A` : "#fff",
                boxShadow: isDropHover ? `0 0 0 2px ${PALETTE.accent}40` : "none",
              }}>
                {/* Day header — date + temp + count badge */}
                <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${PALETTE.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: PALETTE.ink }}>{friendlyDay(iso, idx)}</div>
                    <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 1 }}>
                      {wx}
                      {(() => {
                        // Real Open-Meteo forecast → exact temp + condition when
                        // it's packing-relevant (rain/snow/storm/fog). Beyond the
                        // 16-day horizon (or when geocode/fetch failed) → the
                        // seasonal/brief estimate, marked "~ … (est)".
                        const t = tempHighForDay(iso);
                        if (t == null) return "";
                        const fc = forecast?.[iso];
                        const isForecast = fc?.high != null;
                        if (!isForecast) return ` · ~${t}°F (est)`;
                        let line = ` · ${t}°F`;
                        if (isNotableCondition(fc.condition)) {
                          line += ` · ${fc.condition}${fc.precip != null ? ` ${fc.precip}%` : ""}`;
                        }
                        return line;
                      })()}
                    </div>
                  </div>
                  {outfits.length > 1 && (
                    <div style={{ fontSize: 10, color: PALETTE.muted, padding: "3px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 12 }}>
                      {outfits.length} looks
                    </div>
                  )}
                </div>

                {/* Per-day Activity + free-text label. Always visible, even on
                    empty days — so the user can plan ("theme park day", "beach
                    day") before any outfit is generated. */}
                <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: `1px solid ${PALETTE.line}`, background: PALETTE.cream }}>
                  <select value={dayActivity[iso] || trip.activity || "Sightseeing"}
                    onChange={e => handleDayActivityChange(iso, e.target.value)}
                    style={{ flex: "0 0 120px", fontSize: 10, letterSpacing: "0.04em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "4px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                    {TRIP_ACTIVITIES.map(a => <option key={a}>{a}</option>)}
                  </select>
                  <input type="text"
                    value={dayLabel[iso] || ""}
                    onChange={e => handleDayLabelChange(iso, e.target.value)}
                    placeholder="Day label (e.g. Disneyland, Pool day)"
                    style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, minWidth: 0 }}/>
                </div>

                {/* Outfit stack */}
                {isGenerating ? (
                  <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 12 }}>
                    <span style={{ marginRight: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
                    Styling your look…
                  </div>
                ) : !hasOutfits ? (
                  <>
                    <div style={{ height: 90, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 11, fontStyle: "italic" }}>
                      No look planned yet
                    </div>
                    <div style={{ padding: "8px 12px", borderTop: `1px solid ${PALETTE.line}`, display: "flex", gap: 6 }}>
                      <select value={dayOccasion[iso] || "Casual"}
                        onChange={e => handleOccasionChange(iso, null, e.target.value)}
                        style={{ fontSize: 10, letterSpacing: "0.06em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "5px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                        {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                      </select>
                      <button onClick={() => handleGenerate(iso, null)}
                        style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                        ✦ Generate
                      </button>
                      {onBuildDay && (
                        <button onClick={() => onBuildDay(iso, [])}
                          style={{ padding: "7px 12px", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                          ⊞ Build
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {outfits.map((outfit, outfitIdx) => {
                      const outfitItems = resolveItems(outfit.items);
                      // Legacy plan rows can carry retired occasion labels
                      // (e.g. "Travel" → "Travel Day"). The <select> needs a
                      // value that matches one of OCCASIONS, else browsers
                      // silently render the first option ("Work") even though
                      // the underlying data isn't Work.
                      const occ = normalizeOccasion(outfit.occasion) || "Casual";
                      return (
                        <div key={outfit.id} style={{
                          borderTop: outfitIdx === 0 ? "none" : `1px solid ${PALETTE.line}`,
                        }}>
                          {/* Outfit meta row */}
                          <div style={{ display: "flex", gap: 6, padding: "8px 12px", alignItems: "center", background: PALETTE.cream }}>
                            {days.length > 1 && (
                              // Desktop drag handle. Touch users move via the ⇄
                              // button below — HTML5 DnD doesn't fire on touch.
                              <div
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.effectAllowed = "move";
                                  // Firefox requires data for the drag to start.
                                  e.dataTransfer.setData("text/plain", outfit.id);
                                  setDragSource({ iso, outfitIdx });
                                }}
                                onDragEnd={() => { setDragSource(null); setDragOverIso(null); }}
                                title="Drag to another day"
                                style={{ cursor: "grab", color: PALETTE.muted, fontSize: 13, lineHeight: 1, padding: "4px 2px", userSelect: "none", flexShrink: 0 }}>
                                ⠿
                              </div>
                            )}
                            <select value={occ}
                              onChange={e => handleOccasionChange(iso, outfitIdx, e.target.value)}
                              style={{ flex: "0 0 96px", fontSize: 10, letterSpacing: "0.04em", border: `1px solid ${PALETTE.line}`, borderRadius: 4, padding: "4px 6px", background: "#fff", color: PALETTE.ink, cursor: "pointer" }}>
                              {OCCASIONS.map(o => <option key={o}>{o}</option>)}
                            </select>
                            <input type="text"
                              value={outfit.label || ""}
                              onChange={e => handleOutfitLabelChange(iso, outfitIdx, e.target.value)}
                              placeholder="Label (e.g. Daytime, Dinner)"
                              style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${PALETTE.line}`, borderRadius: 4, background: "#fff", color: PALETTE.ink, minWidth: 0 }}/>
                          </div>
                          {/* Collage. Compact grid keeps the trip-day outfits
                              looking like a tight set rather than scattered
                              across a tall 4:5 mobile canvas. */}
                          {outfitItems.length > 0 ? (
                            <div style={{ position: "relative" }}>
                              <EditorialCollage
                                lookItems={outfitItems}
                                compact
                                canvasStyle={{ borderRadius: 0, padding: "8px 12px" }}
                              />
                            </div>
                          ) : (
                            <div style={{ height: 70, display: "flex", alignItems: "center", justifyContent: "center", color: PALETTE.muted, fontSize: 11, fontStyle: "italic" }}>
                              Empty outfit — generate or build to add items
                            </div>
                          )}
                          {/* Per-outfit actions */}
                          <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: `1px solid ${PALETTE.line}` }}>
                            <button onClick={() => handleGenerate(iso, outfitIdx)} disabled={isGenerating}
                              style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: isGenerating ? "default" : "pointer" }}>
                              {outfitItems.length > 0 ? "↺ Regenerate" : "✦ Generate"}
                            </button>
                            {onBuildDay && (
                              <button onClick={() => onBuildDay(iso, outfit.items || [], outfitIdx)}
                                style={{ flex: 1, padding: "7px 0", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", cursor: "pointer" }}>
                                ⊞ Build
                              </button>
                            )}
                            {days.length > 1 && (
                              <button
                                onClick={() => setMovePicker(cur =>
                                  cur && cur.iso === iso && cur.outfitIdx === outfitIdx
                                    ? null
                                    : { iso, outfitIdx })}
                                title="Move to another day"
                                style={{ padding: "7px 10px", background: movePicker && movePicker.iso === iso && movePicker.outfitIdx === outfitIdx ? PALETTE.cream : "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, cursor: "pointer" }}>
                                ⇄
                              </button>
                            )}
                            <button onClick={() => handleRemoveOutfit(iso, outfitIdx)}
                              title={outfits.length > 1 ? "Remove this outfit" : "Clear this day"}
                              style={{ padding: "7px 10px", background: "transparent", color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, cursor: "pointer" }}>
                              ✕
                            </button>
                          </div>
                          {/* Compact day picker — the touch-first way to move
                              this outfit; taps do exactly what a drop does. */}
                          {movePicker && movePicker.iso === iso && movePicker.outfitIdx === outfitIdx && (
                            <div style={{ padding: "8px 12px 10px", borderTop: `1px dashed ${PALETTE.line}`, background: PALETTE.cream }}>
                              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, fontWeight: 600, marginBottom: 6 }}>MOVE TO</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {days.map((d, dIdx) => d === iso ? null : (
                                  <button key={d}
                                    onClick={() => { setMovePicker(null); handleMoveOutfit(iso, outfitIdx, d); }}
                                    style={{ padding: "5px 10px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 12, fontSize: 10, color: PALETTE.ink, cursor: "pointer" }}>
                                    {friendlyDay(d, dIdx)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button onClick={() => handleAppendEmptyOutfit(iso)} disabled={isGenerating}
                      style={{ display: "block", margin: "8px 12px 12px", width: "calc(100% - 24px)", padding: "7px 0", background: "transparent", border: `1px dashed ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.1em", color: PALETTE.soft, cursor: isGenerating ? "default" : "pointer" }}>
                      + Add another outfit
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Extend the trip end-date by one day. The new day starts empty;
              the user picks activity/occasion and generates from there. */}
          <button onClick={handleAddDay} disabled={addingDay}
            style={{
              width: "100%",
              padding: "10px 0",
              marginTop: 4,
              marginBottom: 18,
              background: "transparent",
              color: PALETTE.soft,
              border: `1px dashed ${PALETTE.line}`,
              borderRadius: 8,
              fontSize: 11,
              letterSpacing: "0.14em",
              cursor: addingDay ? "default" : "pointer",
              opacity: addingDay ? 0.6 : 1,
            }}>
            {addingDay ? "Adding…" : "+ Add a day"}
          </button>
        </div>
      )}

      {/* ── PACKING TAB ── */}
      {tab === "packing" && (
        <div style={{ padding: "16px 16px 0" }}>

          {/* Summary bar — with a destination closet the suitcase counts only
              the PULLED pieces; the rest already live there. */}
          {(() => {
            const carryCount = destClosetId ? packingData.pulledCount : packingData.totalItems;
            const destName = destClosetId
              ? ((closets || []).find(c => c.id === destClosetId)?.name || "destination")
              : null;
            return (
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ padding: "6px 12px", background: PALETTE.cream, borderRadius: 20, fontSize: 11, color: PALETTE.ink }}>
                  {destClosetId ? `${carryCount} to pack` : `${packingData.totalItems} items total`}
                </div>
                {destClosetId && packingData.atDestinationCount > 0 && (
                  <div style={{ padding: "6px 12px", background: PALETTE.cream, borderRadius: 20, fontSize: 11, color: PALETTE.muted }}>
                    {packingData.atDestinationCount} already at {destName}
                  </div>
                )}
                <div style={{ padding: "6px 12px", background: carryCount <= 15 ? "#E8F5E9" : "#FBE9E7", borderRadius: 20, fontSize: 11, color: carryCount <= 15 ? "#2E7D32" : PALETTE.accent }}>
                  {carryCount <= 15 ? "✓ Carry-on friendly" : `⚠ ${carryCount - 15} over carry-on limit`}
                </div>
              </div>
            );
          })()}

          {/* ── Suitcase checklist summary + close actions (wave 2 — B4) ── */}
          {packedNote && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "#FFF8EC", border: "1px solid #E8D5A0", borderRadius: 6, fontSize: 11, color: "#8B6914", lineHeight: 1.5 }}>
              🧳 {packedNote}
              <button onClick={() => setPackedNote("")} style={{ marginLeft: 8, background: "none", border: "none", color: "#8B6914", cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
            </div>
          )}
          {trip.status !== "complete" && tripItemsLoaded && (packedRows.length > 0 || suggestedRows.length > 0) && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: PALETTE.ink, fontWeight: 500, marginBottom: suggestedRows.length > 0 ? 8 : 0 }}>
                🧳 Suitcase: {packedRows.length} packed
                {suggestedRows.length > 0
                  ? ` · ${suggestedRows.length} still unpacked`
                  : packedRows.length > 0 ? " · all set ✓" : ""}
              </div>
              {suggestedRows.length > 0 && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={handleEverythingPacked} disabled={closeBusy}
                    style={{ flex: 1, padding: "7px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 6, fontSize: 10, letterSpacing: "0.08em", cursor: closeBusy ? "default" : "pointer", opacity: closeBusy ? 0.6 : 1 }}>
                    ✓ Everything's packed
                  </button>
                  <button onClick={handleCloseWithUnpacked} disabled={closeBusy}
                    style={{ flex: 1, padding: "7px 0", background: "transparent", color: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 6, fontSize: 10, letterSpacing: "0.08em", cursor: closeBusy ? "default" : "pointer", opacity: closeBusy ? 0.6 : 1 }}>
                    {closeBusy ? "Restyling…" : `Close with ${suggestedRows.length} unpacked`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Coverage warnings */}
          {packingData.warnings.length > 0 && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "#FBE9E7", borderLeft: `3px solid ${PALETTE.accent}`, borderRadius: "0 6px 6px 0" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", fontWeight: 600, color: PALETTE.accent, marginBottom: 4 }}>NEEDS ATTENTION</div>
              {packingData.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: PALETTE.accent, lineHeight: 1.6 }}>· {w}</div>
              ))}
            </div>
          )}

          {packingData.totalItems === 0 && (
            <div style={{ textAlign: "center", padding: 32, color: PALETTE.muted, fontSize: 12 }}>
              Generate or build looks in the Looks tab to see your packing list here.
            </div>
          )}

          {/* Items by category */}
          {packingData.categories.map(({ category, entries }) => (
            <div key={category} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>
                {category} ({entries.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {entries.map(({ item, days: wornDays, atDest }) => {
                  const row = tripItemById.get(item.id);
                  const isPacked = row?.status === "packed";
                  const isLeftBehind = row?.status === "left_behind";
                  return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: PALETTE.cream, borderRadius: 6, opacity: isLeftBehind ? 0.6 : 1 }}>
                    {/* Checklist checkbox (wave 2): pulled pieces only — the
                        at-destination group needs no packing. ticked = 'packed',
                        untick = out of the suitcase (regenerates its outfits). */}
                    {!atDest && trip.status !== "complete" && (
                      <input type="checkbox"
                        checked={isPacked}
                        disabled={!tripItemsLoaded}
                        onChange={() => isPacked ? handleUntickItem(item.id) : handleTickItem(item.id)}
                        title={isPacked ? "Packed — untick to take it out of the suitcase" : "Tick when it's in the suitcase"}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: PALETTE.ink, cursor: "pointer" }}/>
                    )}
                    {!atDest && trip.status === "complete" && (
                      <span style={{ fontSize: 11, flexShrink: 0, width: 16, textAlign: "center", color: isPacked ? "#2E7D32" : PALETTE.muted }} title={isLeftBehind ? "Left at the destination" : isPacked ? "Packed" : ""}>
                        {isLeftBehind ? "↩" : isPacked ? "✓" : ""}
                      </span>
                    )}
                    <div style={{ width: 44, height: 52, flexShrink: 0, borderRadius: 4, overflow: "hidden", background: "#fff", border: `1px solid ${PALETTE.line}` }}>
                      {item.image
                        ? <TrimmedImage src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: PALETTE.muted }}>{category[0]}</div>
                      }
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: 10, color: PALETTE.muted, marginTop: 1 }}>
                        {item.color ? `${item.color} · ` : ""}
                        {wornDays.length === 0
                          ? "no look uses it yet"
                          : `worn day${wornDays.length === 1 ? "" : "s"} ${wornDays.join(", ")}`}
                      </div>
                    </div>
                    {mustIncludeIds.has(item.id) && (
                      <div title="Bringing for sure — stays on the list whatever the looks do"
                        style={{ fontSize: 9, letterSpacing: "0.06em", color: PALETTE.ink, border: `1px solid ${PALETTE.ink}`, borderRadius: 10, padding: "2px 7px", flexShrink: 0 }}>
                        pinned
                      </div>
                    )}
                    {atDest && (
                      <div style={{ fontSize: 9, letterSpacing: "0.06em", color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "2px 7px", flexShrink: 0 }}>
                        at destination
                      </div>
                    )}
                    {isLeftBehind && (
                      <div style={{ fontSize: 9, letterSpacing: "0.06em", color: PALETTE.muted, border: `1px solid ${PALETTE.line}`, borderRadius: 10, padding: "2px 7px", flexShrink: 0 }}>
                        stayed behind
                      </div>
                    )}
                    {wornDays.length > 0 && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: wornDays.length > 1 ? PALETTE.accent : PALETTE.muted, flexShrink: 0 }}>
                        ×{wornDays.length}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Trip-complete modal (wave 2 — B5 data hygiene) ──
          "Anything staying at the destination?" — packed pieces only, none
          preselected. Flagged pieces get status 'left_behind' AND move to the
          destination closet; everything else keeps its home closet. */}
      {showPinPicker && (
        <MustIncludePicker
          items={pinPool}
          selectedIds={mustIncludeIds}
          onChange={changePins}
          onClose={() => setShowPinPicker(false)}
          preferItemIds={preferItemIds}
          weather={weatherForDay(days[0])}
          destClosetName={(closets || []).find(c => c.id === destClosetId)?.name || ""}
        />
      )}

      {completeModalOpen && (() => {
        const destName = (closets || []).find(c => c.id === destClosetId)?.name || trip.destination_city || trip.destination || "the destination";
        const packedItems = packedRows
          .map(r => ({ row: r, item: itemsById.get(r.item_id) }))
          .filter(x => x.item);
        return (
          <div onClick={() => !statusBusy && setCompleteModalOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(28,24,20,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: PALETTE.bg, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", borderRadius: "14px 14px 0 0", padding: 20, boxShadow: "0 -4px 20px rgba(0,0,0,0.15)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 9, letterSpacing: "0.18em", color: PALETTE.muted }}>COMPLETE TRIP</div>
                  <div style={{ fontSize: 17, fontFamily: "serif", color: PALETTE.ink }}>
                    Anything staying in {destName}?
                  </div>
                  <div style={{ fontSize: 11, color: PALETTE.muted, marginTop: 3, lineHeight: 1.5 }}>
                    Tap the packed pieces you're leaving there — they'll move to that closet. Everything else comes home with you.
                  </div>
                </div>
                <button onClick={() => setCompleteModalOpen(false)} disabled={statusBusy}
                  style={{ background: "none", border: "none", color: PALETTE.muted, fontSize: 22, cursor: "pointer", padding: 0 }}>×</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                {packedItems.map(({ item }) => {
                  const staying = stayingIds.has(item.id);
                  return (
                    <button key={item.id}
                      onClick={() => setStayingIds(prev => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                        return next;
                      })}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: staying ? `${PALETTE.accent}12` : "#fff", border: staying ? `1px solid ${PALETTE.accent}` : `1px solid ${PALETTE.line}`, borderRadius: 6, cursor: "pointer", textAlign: "left" }}>
                      <div style={{ width: 40, height: 48, flexShrink: 0, borderRadius: 4, overflow: "hidden", background: PALETTE.cream, border: `1px solid ${PALETTE.line}` }}>
                        {item.image
                          ? <TrimmedImage src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain" }}/>
                          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: PALETTE.muted }}>{item.category?.[0] || "?"}</div>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: PALETTE.ink, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: PALETTE.muted }}>{item.category}{item.color ? ` · ${item.color}` : ""}</div>
                      </div>
                      <span style={{ fontSize: 11, flexShrink: 0, color: staying ? PALETTE.accent : PALETTE.muted }}>
                        {staying ? "staying" : "coming home"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button onClick={() => finishTrip([...stayingIds])} disabled={statusBusy}
                style={{ width: "100%", padding: "10px 0", background: PALETTE.ink, color: PALETTE.bg, border: "none", borderRadius: 8, fontSize: 11, letterSpacing: "0.12em", cursor: statusBusy ? "default" : "pointer", opacity: statusBusy ? 0.6 : 1 }}>
                {statusBusy ? "Completing…"
                  : stayingIds.size > 0
                    ? `Leave ${stayingIds.size} in ${destName} & complete trip`
                    : "Nothing's staying — complete trip"}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
