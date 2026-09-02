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
console.log(`\nselfheal: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
