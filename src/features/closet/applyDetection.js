// ── F1 — APPLY AI DETECTION TO A QUEUED UPLOAD ───────────────────────────────
// Rule: only overwrite fields that still equal their upload defaults. Any
// field the user has already edited is left alone. This prevents the AI from
// clobbering manual input when detection lands after the user has started
// typing.

/**
 * @param {Object} queueItem  - the current state of a BulkAddView queue entry
 * @param {Object} detection  - the sanitized result from autoDetectItem()
 * @returns {Object}          - the merged queue entry (same shape as input)
 */
export function applyDetection(queueItem, detection) {
  if (!detection) return queueItem;
  const next = { ...queueItem };

  // Category: only if still the default "Tops" AND subcategory blank — proxy
  // for "user hasn't touched it yet".
  if (detection.category && queueItem.category === "Tops" && !queueItem.subcategory) {
    next.category = detection.category;
    if (detection.subcategory) next.subcategory = detection.subcategory;
  } else if (detection.subcategory && !queueItem.subcategory && detection.category === queueItem.category) {
    // Same category already picked — still safe to fill the subcategory
    next.subcategory = detection.subcategory;
  }

  if (detection.primary_color && !queueItem.color) next.color = detection.primary_color;
  if (detection.primary_color_hex && !queueItem.primary_color_hex) next.primary_color_hex = detection.primary_color_hex;
  if (detection.secondary_color && !queueItem.secondary_color) next.secondary_color = detection.secondary_color;
  if (detection.secondary_color_hex && !queueItem.secondary_color_hex) next.secondary_color_hex = detection.secondary_color_hex;
  if (detection.brand && !queueItem.brand) next.brand = detection.brand;
  if (detection.material && !queueItem.material) next.material = detection.material;
  if (detection.pattern && !queueItem.pattern) next.pattern = detection.pattern;
  if (detection.tags?.length && (!queueItem.tags || queueItem.tags.length === 0)) next.tags = detection.tags;
  if (typeof detection.confidence === "number") next.detection_confidence = detection.confidence;

  return next;
}
