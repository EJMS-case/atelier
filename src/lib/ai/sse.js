// ── SSE FRAME READER ─────────────────────────────────────────────────────────
// The Anthropic streaming endpoints all speak the same wire format, and three
// call sites had grown their own byte-identical copy of the parser:
//
//   · lib/ai/stylist.js      streamStyleProfile  → text_delta
//   · features/builder/builderChat.js            → text_delta
//     (its own comment read "SSE parse (same shape as streamStyleProfile)")
//   · lib/ai/toolUse.js                          → input_json_delta
//
// Only the last line differs — WHICH delta each one accumulates. So the frame
// parsing lives here and the callers keep their own accumulation, which is the
// part that is genuinely different.
//
// Deliberately NOT swallowing errors: toolUse needs to catch a mid-stream drop
// (Safari surfaces it as "Load failed") and return null rather than bubble a
// raw network error, and that decision belongs to the caller, not here.

/**
 * Read an SSE body and hand each parsed event to `onEvent`.
 *
 * Frames arrive split across chunk boundaries, so lines are buffered until a
 * newline completes them — reading `data:` off a raw chunk drops events at the
 * seam. Malformed payloads are skipped rather than thrown: a partial JSON line
 * at the stream edge is normal, not an error.
 *
 * @param {ReadableStream} body    - res.body from a streaming fetch
 * @param {(evt: Object) => void} onEvent
 * @returns {Promise<void>} resolves when the stream ends
 */
export async function readSSEEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { onEvent(JSON.parse(payload)); }
      catch { /* partial or malformed JSON at the stream edge */ }
    }
  }
}

/**
 * The common case: accumulate one delta type into a growing string, calling
 * `onDelta` with the text so far after each piece.
 *
 * @param {ReadableStream} body
 * @param {Object}   opts
 * @param {string}   opts.deltaType - "text_delta" or "input_json_delta"
 * @param {string}   opts.field     - "text" or "partial_json"
 * @param {Function} [opts.onDelta] - called with the accumulated string
 * @returns {Promise<string>} everything accumulated
 */
export async function readSSEText(body, { deltaType, field, onDelta }) {
  let acc = "";
  await readSSEEvents(body, (evt) => {
    if (evt.type === "content_block_delta" && evt.delta?.type === deltaType) {
      acc += evt.delta[field] || "";
      onDelta?.(acc);
    }
  });
  return acc;
}
