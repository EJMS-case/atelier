// ── SELF-HEALING WRITE TESTS ─────────────────────────────────────────────────
// The PGRST204 column-stripping retry (src/lib/selfHealingWrite.js), which
// until 2026-09-02 existed as six hand-copied loops inside supabase.js and had
// no test at all. HANDOFF.md had it on the deferred list as "behaviour-risky
// to merge, no symptom attached" — this suite is what makes merging it safe,
// so the cases below are chosen to pin the behaviour the copies actually had,
// including the two DIFFERENT error wordings they had drifted into.
//
// Run: npm run test:selfheal

import { selfHealingWrite, MAX_STRIP_ATTEMPTS } from "../src/lib/selfHealingWrite.js";
import { sb, mergeOutfitLogMeta, OUTFIT_LOG_COLUMNS, SETTINGS_BATCH_KEYS } from "../src/lib/supabase.js";

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n— ${name}`); }

// A fetch stub that records every request and replays a scripted list of
// responses. `json` is what res.json() resolves to; `throws` makes it reject,
// which is how a non-JSON error body behaves.
function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[calls.length - 1];
    if (!r) throw new Error(`unscripted call #${calls.length}`);
    return {
      ok: r.status === undefined || r.status < 400,
      status: r.status ?? 200,
      json: async () => { if (r.throws) throw new Error("not json"); return r.json; },
    };
  };
  return calls;
}
const pgrst204 = (col) => ({
  status: 400,
  json: { code: "PGRST204", message: `Could not find the '${col}' column of 'x' in the schema cache` },
});
const base = { url: "https://x/rest/v1/t", headers: () => ({ a: "1" }), label: "Upsert" };
async function caught(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

// ── 1. The happy path ────────────────────────────────────────────────────────
section("success");
{
  const calls = stubFetch([{ json: [{ id: 1 }] }]);
  const out = await selfHealingWrite({ ...base, body: { id: 1, name: "Bow bag" } });
  assert(JSON.stringify(out) === '[{"id":1}]', "the representation is returned");
  assert(calls.length === 1, "one request when the write succeeds");
  assert(calls[0].method === "POST", "POST is the default method");
  assert(JSON.stringify(calls[0].body) === '{"id":1,"name":"Bow bag"}', "the payload is sent whole");
}
{
  const calls = stubFetch([{ json: {} }]);
  await selfHealingWrite({ ...base, method: "PATCH", body: { a: 1 } });
  assert(calls[0].method === "PATCH", "an explicit method is used");
}

// ── 2. The healing itself ────────────────────────────────────────────────────
// This is the whole reason the loop exists: a client deployed ahead of its
// hand-applied migration must still save the rest of the row.
section("column stripping");
{
  const calls = stubFetch([pgrst204("must_include_ids"), { json: [{ id: 7 }] }]);
  const out = await selfHealingWrite({
    ...base, body: { id: 7, name: "Arizona", must_include_ids: ["a"] },
  });
  assert(out[0].id === 7, "the retry's result is returned");
  assert(calls.length === 2, "one retry after PGRST204");
  assert(!("must_include_ids" in calls[1].body), "the named column is gone from the retry");
  assert(calls[1].body.name === "Arizona", "every other field survives");
}
{
  // Several unknown columns strip one per attempt.
  const calls = stubFetch([pgrst204("a"), pgrst204("b"), pgrst204("c"), { json: [{}] }]);
  await selfHealingWrite({ ...base, body: { a: 1, b: 2, c: 3, keep: 4 } });
  assert(calls.length === 4, "one attempt per unknown column");
  assert(JSON.stringify(calls[3].body) === '{"keep":4}', "only the known column is left");
}
{
  // The caller's object must not be mutated — App state holds these rows.
  const body = { a: 1, keep: 2 };
  stubFetch([pgrst204("a"), { json: [{}] }]);
  await selfHealingWrite({ ...base, body });
  assert(body.a === 1, "the caller's object is untouched by stripping");
}
{
  // PGRST204 whose message names no column is NOT retried — retrying would
  // send the identical payload forever.
  const calls = stubFetch([{ status: 400, json: { code: "PGRST204", message: "schema cache stale" } }]);
  const msg = await caught(() => selfHealingWrite({ ...base, body: { a: 1 } }));
  assert(calls.length === 1, "a PGRST204 naming no column is not retried");
  assert(msg === "Upsert failed: schema cache stale", "it throws with the server's message");
}
{
  const calls = stubFetch(Array.from({ length: MAX_STRIP_ATTEMPTS }, (_, i) => pgrst204(`c${i}`)));
  const msg = await caught(() => selfHealingWrite({ ...base, body: {} }));
  assert(calls.length === MAX_STRIP_ATTEMPTS, `the loop stops at ${MAX_STRIP_ATTEMPTS} attempts`);
  assert(msg === "Upsert failed after stripping unknown columns", "and says so");
}

// ── 3. Headers are rebuilt per attempt ───────────────────────────────────────
// wearApi.js once froze signed-out headers by hoisting them; taking a function
// here is what stops the retries from doing the same on a smaller scale.
section("headers");
{
  let n = 0;
  const calls = stubFetch([pgrst204("a"), { json: [{}] }]);
  await selfHealingWrite({
    ...base, body: { a: 1 }, headers: () => ({ Authorization: `Bearer t${++n}` }),
  });
  assert(n === 2, "headers() is called once per attempt, not once per write");
  assert(calls[1].headers.Authorization === "Bearer t2", "the retry carries the fresh headers");
}

// ── 4. The two error wordings the copies had drifted into ────────────────────
// Reproduced exactly rather than unified: unifying them is a separate decision
// from de-duplicating the loop, and these strings surface in the UI.
section("error wording");
{
  stubFetch([{ status: 409, json: { message: "duplicate key" } }]);
  assert(await caught(() => selfHealingWrite({ ...base, body: {} }))
    === "Upsert failed: duplicate key", "default shape prefixes the label");

  stubFetch([{ status: 409, json: {} }]);
  assert(await caught(() => selfHealingWrite({ ...base, body: {} }))
    === "Upsert failed: 409", "…and falls back to the status when there is no message");

  stubFetch([{ status: 409, json: { message: "duplicate key" } }]);
  assert(await caught(() => selfHealingWrite({
    ...base, label: "saveTrip", preferServerMessage: true, body: {},
  })) === "duplicate key", "preferServerMessage surfaces PostgREST's own message");

  stubFetch([{ status: 409, json: {} }]);
  assert(await caught(() => selfHealingWrite({
    ...base, label: "saveTrip", preferServerMessage: true, body: {},
  })) === "saveTrip failed 409", "…falling back to the label and status");
}
{
  // A non-JSON error body (an HTML 502 from the edge, say) must not crash the
  // parse — it throws the status form, in both shapes.
  stubFetch([{ status: 502, throws: true }]);
  assert(await caught(() => selfHealingWrite({ ...base, body: {} }))
    === "Upsert failed 502", "an unparseable error body throws the status form");

  stubFetch([{ status: 502, throws: true }]);
  assert(await caught(() => selfHealingWrite({
    ...base, label: "savePlan", preferServerMessage: true, body: {},
  })) === "savePlan failed 502", "the same, regardless of the wording flag");
}

// ── Result ──────────────────────────────────────────────────────────────────

// ── Outfit-log slim fetch (2026-09-10) ───────────────────────────────────────
// fetchOutfitLogs is now slim + a collage-meta sidecar (21 legacy rows carry
// dead base64 collages nothing renders; select=* shipped 2.2 MB to every
// caller, the Style Me tap included). The merge is the pure piece.
section("mergeOutfitLogMeta");
{
  const rows = [
    { id: "a", garment_ids: ["1"], occasion: "Work" },
    { id: "b", garment_ids: ["2"], occasion: "Dinner" },
    { id: "c", garment_ids: ["3"] },
  ];
  const meta = [{ id: "b", collage_url: '{"styling":"tonal column"}' }];
  const merged = mergeOutfitLogMeta(rows, meta);
  assert(merged[0].collage_url === null, "a row with no sidecar pair reads collage_url null (legacy base64 stays server-side)");
  assert(merged[1].collage_url === '{"styling":"tonal column"}', "the small JSON meta newer saves store survives the merge");
  assert(merged[2].collage_url === null, "a null collage merges as null");
  assert(merged[1].occasion === "Dinner", "slim fields pass through untouched");
  assert(rows[1].collage_url === undefined, "merge never mutates its inputs");
  assert(mergeOutfitLogMeta(rows, null).length === 3, "a failed sidecar fetch degrades to null collages, not an empty table");
  assert(mergeOutfitLogMeta(null, meta).length === 0, "no rows, no output");
  const cols = OUTFIT_LOG_COLUMNS.split(",");
  assert(!cols.includes("collage_url"), "the slim list must exclude the one heavy column");
  for (const c of ["id", "garment_ids", "date_worn", "occasion", "layout_data", "source"]) {
    assert(cols.includes(c), `slim list carries ${c} — SavedLookCard, wear stats, and builtLookLines read it`);
  }
}

// ── The user_settings mount batch (2026-09-11) ───────────────────────────────
// `_settingsRow` answered ANY key from the batch map with `map[key] ?? null`,
// so the first read of a key outside the key=in.(…) list — the trend brief —
// returned null with no request made. loadTrendBrief() read null at every app
// open, and a web-search research call fired on every cold open with a key.
// A GET-capable stub: the one above JSON.parses a body every request has.
function stubGet(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    const r = responses[calls.length - 1];
    if (!r) throw new Error(`unscripted call #${calls.length}: ${url}`);
    return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.json };
  };
  return calls;
}
section("settings batch");
{
  assert(SETTINGS_BATCH_KEYS.includes("trend_brief"), "the trend brief rides the mount batch");
  assert(SETTINGS_BATCH_KEYS.includes("style_notes_seen"), "style_notes_seen rides the mount batch (its miss re-offered every seed each session)");
  const brief = { text: "• Open blazer.", season: "fall 2026", generated_at: "2026-09-11T00:00:00Z" };
  const calls = stubGet([
    { json: [{ key: "trend_brief", value: JSON.stringify(brief) }, { key: "rotation_state", value: "{\"looks\":[]}" }] },
    { json: [{ value: "[\"x\"]" }] },
    { json: [{ value: JSON.stringify(brief) }] },
  ]);
  const got = await sb.getSettingJson("trend_brief");
  assert(calls.length === 1 && /key=in\.\(/.test(calls[0].url), "the first read issues the one batch GET");
  for (const k of SETTINGS_BATCH_KEYS) assert(calls[0].url.includes(k), `the batch asks for ${k}`);
  assert(got && got.text === brief.text, "a batched key is served from the batch — not null");
  const other = await sb.getSettingJson("not_a_mount_key");
  assert(calls.length === 2 && /key=eq\.not_a_mount_key/.test(calls[1].url), "a key outside the batch takes its own GET at once");
  assert(JSON.stringify(other) === '["x"]', "…and returns the row");
  const again = await sb.getSettingJson("trend_brief");
  assert(calls.length === 3 && /key=eq\.trend_brief/.test(calls[2].url), "the second read of a batched key hits the network (refresh flows stay live)");
  assert(again && again.season === "fall 2026", "…and returns the row");
  const missing = await sb.getSettingJson("chat_lessons");
  assert(calls.length === 3 && missing === null, "a batched key with no row reads null from the batch, no extra request");
}

// ── The collage sidecar is opt-in (2026-09-11) ───────────────────────────────
section("fetchOutfitLogs sidecar");
{
  const rows = [{ id: "a", garment_ids: ["1"], date_worn: "2026-09-01" }];
  let calls = stubGet([{ json: rows }]);
  const slim = await sb.fetchOutfitLogs();
  assert(calls.length === 1, "by default only the slim request is made");
  assert(slim.length === 1 && slim[0].collage_url === null, "rows still carry collage_url (null) so every reader keeps its shape");
  calls = stubGet([{ json: rows }, { json: [{ id: "a", collage_url: "{\"mood\":\"x\"}" }] }]);
  const full = await sb.fetchOutfitLogs({ withCollageMeta: true });
  assert(calls.length === 2 && /collage_url=not\.like\.data/.test(calls[1].url), "withCollageMeta adds the sidecar");
  assert(full[0].collage_url === "{\"mood\":\"x\"}", "…and merges it in");
}

console.log(`\nselfheal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
