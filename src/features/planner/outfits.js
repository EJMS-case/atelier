// ── Multi-outfit-per-day helpers ─────────────────────────────────────────────
// A plan row used to be a single look: { items: [ids], occasion }. Now a plan
// can hold several outfits in `outfits` (jsonb) — e.g. Disneyland daytime +
// dinner. The legacy `items`/`occasion` fields still mirror outfit #0 so the
// month-grid collage and DayModal preview keep working unchanged.
//
// New shape on disk:
//   plan.outfits = [
//     { id, label, occasion, items: [itemId, ...] },
//     ...
//   ]
//
// Read path: always use outfitsOf(plan). It returns the new array if present,
// otherwise synthesises a single-outfit array from the legacy fields.

let _outfitCounter = 0;
export function newOutfitId() {
  return `o_${Date.now()}_${++_outfitCounter}`;
}

export function outfitsOf(plan) {
  if (Array.isArray(plan?.outfits) && plan.outfits.length > 0) {
    return plan.outfits.map(o => ({
      id: o.id || newOutfitId(),
      label: o.label || "",
      occasion: o.occasion || plan.occasion || null,
      items: Array.isArray(o.items) ? o.items : [],
    }));
  }
  if (Array.isArray(plan?.items) && plan.items.length > 0) {
    return [{
      id: "_legacy",
      label: "",
      occasion: plan.occasion || null,
      items: plan.items,
    }];
  }
  return [];
}

// Flatten every itemId used across every outfit on a plan — primary use is the
// trip packing list. De-dupes silently.
export function flattenPlanItemIds(plan) {
  const seen = new Set();
  const out = [];
  for (const o of outfitsOf(plan)) {
    for (const id of (o.items || [])) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

// When saving, we serialize the working outfits array AND mirror outfit #0 into
// the legacy fields so anything still reading plan.items / plan.occasion keeps
// rendering the "primary" look for the day. Calendar grid, DayModal, weekly
// agenda — none of those needed changes.
export function buildPlanPayload({ date, outfits, source, notes, weather, activity, day_label }) {
  const first = outfits[0] || { items: [], occasion: null };
  return {
    date,
    items: first.items || [],
    occasion: first.occasion || null,
    outfits: outfits.map(o => ({
      id: o.id,
      label: o.label || "",
      occasion: o.occasion || null,
      items: o.items || [],
    })),
    source,
    notes,
    weather,
    activity: activity || null,
    day_label: day_label || null,
  };
}
