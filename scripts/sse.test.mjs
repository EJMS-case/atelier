// ── SSE READER TESTS ─────────────────────────────────────────────────────────
// The Anthropic streaming frame parser (src/lib/ai/sse.js), which until
// 2026-09-02 existed as three byte-identical copies across stylist.js,
// builderChat.js and toolUse.js — and had no test at all in any of them.
//
// The cases that matter are the ones a real stream produces and a naive parser
// gets wrong: a frame split across chunk boundaries, a partial JSON line at the
// edge, and keep-alive noise between events.
//
// Run: npm run test:sse

import { readSSEEvents, readSSEText } from "../src/lib/ai/sse.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

// A ReadableStream-alike over a list of string chunks, matching the shape the
// reader actually consumes (res.body.getReader() → { value: Uint8Array, done }).
function streamOf(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length
        ? { value: enc.encode(chunks[i++]), done: false }
        : { value: undefined, done: true }),
    }),
  };
}
const delta = (t) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n`;

// ── 1. The happy path ────────────────────────────────────────────────────────
section("whole frames");
{
  const seen = [];
  await readSSEEvents(streamOf([delta("a"), delta("b")]), e => seen.push(e));
  assert(seen.length === 2, "every complete frame is delivered");
  assert(seen[0].delta.text === "a" && seen[1].delta.text === "b", "in order, with their payloads");
}

// ── 2. Frames split across chunk boundaries ──────────────────────────────────
// The reason the parser buffers instead of reading each chunk directly. A
// naive version drops the event at every seam.
section("split frames");
{
  const whole = delta("hello");
  for (const cut of [1, 5, 12, whole.length - 2]) {
    const seen = [];
    await readSSEEvents(streamOf([whole.slice(0, cut), whole.slice(cut)]), e => seen.push(e));
    assert(seen.length === 1 && seen[0].delta.text === "hello", `a frame cut at byte ${cut} still arrives whole`);
  }
  // Cut inside the JSON itself, one byte at a time.
  const seen = [];
  await readSSEEvents(streamOf([...whole].map(c => c)), e => seen.push(e));
  assert(seen.length === 1 && seen[0].delta.text === "hello", "byte-at-a-time delivery still yields one event");
}

// ── 3. Noise a real stream carries ───────────────────────────────────────────
section("noise");
{
  const seen = [];
  await readSSEEvents(streamOf([
    "event: message_start\n", "\n", ": keep-alive\n",
    delta("x"),
    "data: [DONE]\n", "data: \n", "data: {not json\n",
  ]), e => seen.push(e));
  assert(seen.length === 1 && seen[0].delta.text === "x",
    "event: lines, blank lines, comments, [DONE] and malformed JSON are all skipped");
}
{
  // A truncated frame at the very end of the stream must not throw — it is the
  // normal shape of a connection that ends mid-frame.
  const seen = [];
  let threw = false;
  try { await readSSEEvents(streamOf([delta("y"), 'data: {"type":"content_bl']), e => seen.push(e)); }
  catch { threw = true; }
  assert(!threw, "a truncated final frame does not throw");
  assert(seen.length === 1, "and the complete frames before it are still delivered");
}
{
  const seen = [];
  await readSSEEvents(streamOf([]), e => seen.push(e));
  assert(seen.length === 0, "an empty stream yields nothing");
}

// ── 4. readSSEText — the accumulating wrapper ────────────────────────────────
section("readSSEText");
{
  const progress = [];
  const out = await readSSEText(streamOf([delta("Hel"), delta("lo")]), {
    deltaType: "text_delta", field: "text", onDelta: t => progress.push(t),
  });
  assert(out === "Hello", "pieces accumulate into the final string");
  assert(progress.join("|") === "Hel|Hello", "onDelta sees the text SO FAR, not just the new piece");

  // The other delta type, which is why the parser and the accumulation are
  // separate functions in the first place.
  const json = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"a":' } })}\n`;
  const json2 = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "1}" } })}\n`;
  const acc = await readSSEText(streamOf([json, json2]), { deltaType: "input_json_delta", field: "partial_json" });
  assert(acc === '{"a":1}', "input_json_delta accumulates the same way");

  // A delta of the wrong type is ignored rather than concatenated.
  const mixed = await readSSEText(streamOf([delta("keep"), json]), { deltaType: "text_delta", field: "text" });
  assert(mixed === "keep", "a delta of another type is not accumulated");

  assert(await readSSEText(streamOf([]), { deltaType: "text_delta", field: "text" }) === "",
    "an empty stream accumulates to the empty string");
  // No onDelta must not throw.
  assert(await readSSEText(streamOf([delta("z")]), { deltaType: "text_delta", field: "text" }) === "z",
    "onDelta is optional");
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\nsse: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
