// ── BACKGROUND CUTOUT RE-CUT (DRIP) ──────────────────────────────────────────
// Quietly re-crops a few closet cutouts per session so transparent PNGs that
// carry oversized padding (photoroom / bulk-import exports the crop pipeline
// never actually ran on) get tightened over time — no manual batch, no cost.
// It's pure client-side image cropping: fetch the photo, find the alpha
// bounding box, crop tight, re-upload. Fire-and-forget; any failure is
// swallowed and simply retried a future session.
//
// Progress is tracked by the `is_recut` column (distinct from the legacy,
// blanket-set `is_trimmed`), so the drip converges and never redoes an item.

import { imageToBase64, trimTransparentBorders, compressImage, PHOTO_MAX_DIM } from "../../utils/images.js";
import { sb } from "../../lib/supabase.js";

/**
 * @param {Object}   p
 * @param {Object[]} p.items       - current closet
 * @param {Function} p.updateItem  - App's updateItem(id, fields); pass a URL (not
 *                                    a data: URL) for image so it skips its own
 *                                    upload path (and its failure alert).
 * @param {number}   [p.limit=12]       - max items to process this run
 * @param {number}   [p.concurrency=2]  - parallel workers
 * @returns {Promise<number>} how many items were processed
 */
export async function runRecutDrip({ items, updateItem, limit = 12, concurrency = 2 }) {
  const pending = (items || []).filter(it => it.image && it.is_recut !== true).slice(0, limit);
  if (!pending.length) return 0;

  let processed = 0;
  const queue = [...pending];
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try {
        const b64 = await imageToBase64(it.image);
        const trimmed = await trimTransparentBorders(b64);
        if (trimmed && trimmed !== b64) {
          // Had padding to crop — re-upload the tightened image.
          const compressed = await compressImage(trimmed, PHOTO_MAX_DIM, 0.9, true);
          const url = await sb.uploadImage(it.id, compressed);
          await updateItem(it.id, { image: url, is_recut: true, is_trimmed: true });
        } else {
          // Already tight (or unreadable) — just mark it so we don't re-check.
          await updateItem(it.id, { is_recut: true });
        }
        processed++;
      } catch { /* swallow — a future session retries this item */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return processed;
}
