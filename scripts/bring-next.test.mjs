// ── BRING NEXT TIME (owner, 2026-11-22) ─────────────────────────────────────
// A ★ (the closet's Select bar while she looks through the closet she left,
// since 2026-11-23) remembers pieces for the next trip to the same place.
// Run: npm run test:bring-next
import { test } from "node:test";
import assert from "node:assert/strict";
import { bringNextKey, cleanStars, starredFor, setStars } from "../src/features/planner/bringNext.js";

const AZ = "c0000000-0000-4000-8000-000000000002";

test("a trip's key is its destination closet, else its place name", () => {
  assert.equal(bringNextKey({ destClosetId: AZ, destination: "Scottsdale, AZ" }), `closet:${AZ}`);
  assert.equal(bringNextKey({ destination: "Las Vegas, NV" }), "place:las vegas");
  assert.equal(bringNextKey({ destination: "  " }), "");
  assert.equal(bringNextKey(), "");
});

test("every Arizona trip shares one set of stars, whatever it was called", () => {
  const a = bringNextKey({ destClosetId: AZ, destination: "Arizona" });
  const b = bringNextKey({ destClosetId: AZ, destination: "Phoenix" });
  assert.equal(a, b);
});

test("a selection stars and unstars together, and lists stay clean", () => {
  const k = `closet:${AZ}`;
  let m = setStars({}, k, ["tee", "pant"], true);
  assert.deepEqual([...starredFor(m, k)].sort(), ["pant", "tee"]);
  m = setStars(m, k, ["pant", "coat", "", null], true);
  assert.equal(starredFor(m, k).size, 3, "re-starring adds nothing twice");
  m = setStars(m, k, ["tee"], false);
  assert.deepEqual([...starredFor(m, k)].sort(), ["coat", "pant"]);
  m = setStars(m, k, ["coat", "pant"], false);
  assert.deepEqual(m, {}, "an emptied key is dropped");
  assert.equal(starredFor(m, "place:paris").size, 0);
  assert.deepEqual(setStars({}, "", ["tee"], true), {}, "no key, no star");
  const other = setStars({ "place:las vegas": ["heel"] }, k, ["tee"], true);
  assert.deepEqual(other["place:las vegas"], ["heel"], "another place's stars are untouched");
});

test("a stored map is cleaned on read", () => {
  assert.deepEqual(cleanStars({ a: ["x", "x", "", null], b: [], c: "nope" }), { a: ["x"] });
  assert.deepEqual(cleanStars(null), {});
  assert.deepEqual(cleanStars([1, 2]), {});
});
