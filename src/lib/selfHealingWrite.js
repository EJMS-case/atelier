// ── SELF-HEALING WRITE ───────────────────────────────────────────────────────
// Six write paths in supabase.js had each grown their own copy of the same
// retry loop: POST or PATCH the payload, and when PostgREST answers PGRST204
// ("Could not find the 'x' column"), drop that column and try again.
//
// It exists because migrations are applied to the live project BY HAND. A
// client deployed ahead of its migration would otherwise fail the whole write
// over one column the project has never heard of; instead the row saves
// without it. The loop is bounded — a payload cannot cost more attempts than
// it has columns, and a server that keeps naming columns is not healing.
//
// The six copies were identical apart from the URL, the method, the Prefer
// header and the wording of their errors — and the wording had already drifted
// into two shapes, which is why `preferServerMessage` exists rather than one
// tidy format. Both shapes are reproduced exactly; unifying them is a separate
// decision from de-duplicating the loop.
//
// `headers` is a FUNCTION, not an object, and is called fresh on every attempt.
// supabase.js builds headers per request so that a session arriving mid-flight
// is picked up; accepting a prebuilt object here would freeze the signed-out
// headers for the whole retry sequence — the exact bug wearApi.js shipped.

export const MAX_STRIP_ATTEMPTS = 15;

const missingColumn = (err) => err?.message?.match(/find the '([^']+)' column/)?.[1];

/**
 * @param {Object}   opts
 * @param {string}   opts.url      - full PostgREST URL, filters included
 * @param {string}   [opts.method] - "POST" (default) or "PATCH"
 * @param {() => Object} opts.headers - built per attempt, never hoisted
 * @param {Object}   opts.body     - copied before any column is stripped, so
 *                                   the caller's object is never mutated
 * @param {string}   opts.label    - verb for the error text ("Upsert", "saveTrip")
 * @param {boolean}  [opts.preferServerMessage] - true: surface PostgREST's own
 *                   message and fall back to the label; false (default): always
 *                   prefix with the label
 * @returns {Promise<Object>} the representation PostgREST returns
 */
export async function selfHealingWrite({
  url, method = "POST", headers, body, label, preferServerMessage = false,
}) {
  const payload = { ...body };
  for (let attempt = 0; attempt < MAX_STRIP_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method,
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();

    let err;
    try { err = await res.json(); } catch { throw new Error(`${label} failed ${res.status}`); }

    if (err.code === "PGRST204") {
      const column = missingColumn(err);
      if (column) { delete payload[column]; continue; }
    }
    throw new Error(preferServerMessage
      ? (err?.message || `${label} failed ${res.status}`)
      : `${label} failed: ${err.message || res.status}`);
  }
  throw new Error(`${label} failed after stripping unknown columns`);
}
