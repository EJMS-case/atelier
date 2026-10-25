// ── A HEART ON A WORN DAY ────────────────────────────────────────────────────
// Owner, 2026-10-25: "I can't heart outfits from planner outfits I already
// wore." 120 of her 131 worn calendar days pointed at no saved look, so a
// heart had nowhere to land. wornHeart.js makes the worn look a saved look
// and hearts it — reusing the saved look that already IS this wear (same
// date, same pieces), never saving it twice — and links the day's first look
// so Home's look-back counts the heart. Also: the look-back's "judge again"
// count (wornSinceJudged).
//
//   npm run test:worn-heart

import { test } from "node:test";
import assert from "node:assert/strict";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
  const body = /outfit_logs/.test(String(url)) && init.method === "POST"
    ? [{ id: "new-log", ...JSON.parse(init.body) }]
    : [];
  return { ok: true, status: 201, text: async () => JSON.stringify(body), json: async () => body };
};

const { findWornLog, wornLookHearted, toggleWornHeart } = await import("../src/features/planner/wornHeart.js");
const { wornSinceJudged } = await import("../src/features/recap/recapData.js");

const favs = new Set();
const isFav = (type, id) => favs.has(`${type}:${id}`);
const toggleFav = async (type, id) => { const k = `${type}:${id}`; favs.has(k) ? favs.delete(k) : favs.add(k); };
const posts = (re) => calls.filter(c => c.method === "POST" && re.test(c.url));

test("the saved look that is this wear: same date, same pieces, any order", () => {
  const logs = [{ id: "a", date_worn: "2026-10-20", garment_ids: ["x", "y"] }, { id: "b", date_worn: "2026-10-21", garment_ids: ["y", "x"] }];
  assert.equal(findWornLog(logs, "2026-10-21", ["x", "y"])?.id, "b");
  assert.equal(findWornLog(logs, "2026-10-21", ["x"]), null);
  assert.equal(findWornLog(logs, "2026-10-22", ["x", "y"]), null);
  assert.equal(findWornLog(null, "2026-10-21", ["x", "y"]), null);
});

test("an unsaved worn look is saved with its date, pieces and layout, hearted, and linked", async () => {
  calls.length = 0; favs.clear();
  const plan = { date: "2026-10-20", weather: "Mild", outfit_log_id: null };
  const layout = [{ id: "x", x: 1, y: 2, w: 3, h: 4, z: 1 }];
  const r = await toggleWornHeart({ date: "2026-10-20", outfit: { items: ["x", "y"], occasion: "Work" }, idx: 0, plan, layout, logs: [], isFav, toggleFav });
  assert.equal(r.created, true);
  assert.equal(r.hearted, true);
  const [save] = posts(/outfit_logs/);
  assert.equal(save.body.date_worn, "2026-10-20");
  assert.deepEqual(save.body.garment_ids, ["x", "y"]);
  assert.equal(save.body.occasion, "Work");
  assert.deepEqual(save.body.layout_data, layout);
  assert.ok(isFav("outfit", "new-log"));
  const [link] = posts(/planned_outfits/);
  assert.deepEqual(Object.keys(link.body).filter(k => k !== "updated_at").sort(), ["date", "outfit_log_id"], "the link writes one column and nothing else of the day");
  assert.equal(link.body.outfit_log_id, "new-log");
});

test("a look already saved for that day is reused, never saved twice; a second tap un-hearts", async () => {
  calls.length = 0; favs.clear();
  const logs = [{ id: "old", date_worn: "2026-10-20", garment_ids: ["y", "x"] }];
  const plan = { date: "2026-10-20", outfit_log_id: "old" };
  const first = await toggleWornHeart({ date: "2026-10-20", outfit: { items: ["x", "y"] }, plan, logs, isFav, toggleFav });
  assert.equal(first.created, false);
  assert.equal(first.hearted, true);
  assert.equal(posts(/outfit_logs/).length, 0);
  assert.equal(posts(/planned_outfits/).length, 0, "a day already linked keeps its link");
  assert.ok(wornLookHearted({ logs, date: "2026-10-20", ids: ["x", "y"], isFav }));
  const second = await toggleWornHeart({ date: "2026-10-20", outfit: { items: ["x", "y"] }, plan, logs, isFav, toggleFav });
  assert.equal(second.hearted, false);
  assert.ok(!wornLookHearted({ logs, date: "2026-10-20", ids: ["x", "y"], isFav }));
});

test("a day's second look saves without her first look's layout and leaves the day's link alone", async () => {
  calls.length = 0; favs.clear();
  await toggleWornHeart({ date: "2026-10-20", outfit: { items: ["p", "q"], occasion: "Dinner" }, idx: 1, plan: { date: "2026-10-20", outfit_log_id: null }, layout: [{ id: "x" }], logs: [], isFav, toggleFav });
  assert.equal(posts(/outfit_logs/)[0].body.layout_data, null);
  assert.equal(posts(/planned_outfits/).length, 0);
});

test("a look with no pieces is refused, not saved empty", async () => {
  calls.length = 0;
  await assert.rejects(() => toggleWornHeart({ date: "2026-10-20", outfit: { items: [] }, logs: [], isFav, toggleFav }));
  assert.equal(calls.length, 0);
});

test("the look-back counts looks worn after the day it was judged (New York time)", () => {
  const looks = [{ date: "2026-10-20" }, { date: "2026-10-22" }, { date: "2026-10-23" }];
  // 2026-10-22 03:00Z is still 10-21 in New York.
  assert.equal(wornSinceJudged(looks, Date.parse("2026-10-22T03:00:00Z")), 2);
  assert.equal(wornSinceJudged(looks, Date.parse("2026-10-22T15:00:00Z")), 1);
  assert.equal(wornSinceJudged(looks, null), 0);
});
