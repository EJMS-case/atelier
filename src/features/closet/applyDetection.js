// ── F1 — APPLY AI DETECTION TO A QUEUED UPLOAD ───────────────────────────────
// Rule: only overwrite fields that still equal their upload defaults. Any
// field the user has already edited is left alone. This prevents the AI from
// clobbering manual input when detection lands after the user has started
// typing.

import { MISC_CATEGORY } from "../../constants/taxonomy.js";

/**
 * @param {Object} queueItem  - the current state of a BulkAddView queue entry
 * @param {Object} detection  - the sanitized result from autoDetectItem()
 * @returns {Object}          - the merged queue entry (same shape as input)
 */
export function applyDetection(queueItem, detection) {
  if (!detection) return queueItem;
  // The Misc holding room is filed by hand and carries no styling metadata —
  // an AI-proposed color/material/pattern on a row she deliberately parked
  // there is noise. (The model can't propose Misc itself: the auto-detect
  // taxonomy is STYLING_TAXONOMY, which omits it.)
  if (queueItem.category === MISC_CATEGORY) return queueItem;
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

  // Name defaults to "" on upload (filenames made garbage titles) — the AI's
  // proposed title fills it unless the user already typed one.
  if (detection.name && !queueItem.name) next.name = detection.name;
  if (detection.primary_color && !queueItem.color) next.color = detection.primary_color;
  if (detection.brand && !queueItem.brand) next.brand = detection.brand;
  if (detection.material && !queueItem.material) next.material = detection.material;
  if (detection.pattern && !queueItem.pattern) next.pattern = detection.pattern;
  if (typeof detection.confidence === "number") next.detection_confidence = detection.confidence;

  return next;
}
