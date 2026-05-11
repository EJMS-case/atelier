// ── MULTI-TAG HELPERS ────────────────────────────────────────────────────────
// outfit_logs and planned_outfits now carry both:
//   · occasion / weather   — legacy singleton (still written for back-compat)
//   · occasions / weathers — array of tags (the source of truth for new UI)
//
// These helpers let consumers read either shape without caring which is set.

// Normalize a tag-ish field to an array. Strings become single-element arrays,
// null/undefined/"" become empty arrays. Already-arrays are filtered of falsy
// entries.
export function asArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v == null || v === "") return [];
  return [String(v)];
}

// Pull the canonical multi-tag value from a row that may have either or both
// of the plural and singleton fields. Plural wins when present and non-empty.
export function tagsFor(row, pluralKey, singletonKey) {
  const arr = asArray(row?.[pluralKey]);
  if (arr.length) return arr;
  return asArray(row?.[singletonKey]);
}

// "Work · Casual" / "Work" / "" — for inline display.
export function joinTags(arr, sep = " · ") {
  return asArray(arr).join(sep);
}

// Whether a row matches a single requested tag, treating multi-tag rows as
// "matches if any tag matches." Used by the planner picker and history filter.
export function rowMatchesTag(row, pluralKey, singletonKey, wanted) {
  if (!wanted) return true;
  const tags = tagsFor(row, pluralKey, singletonKey);
  return tags.length === 0 || tags.includes(wanted);
}
