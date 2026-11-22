// ── A LOOK THAT ECHOES ONE SHE WORE BEFORE (owner, 2026-11-22) ───────────────
// Display only: never a prompt, never the sampler. Run: npm run test:look-echo
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookEcho, echoLine } from "../src/features/stylist/lookEcho.js";

const W = [
  { id: "blz", name: "Camel Blazer", category: "Outerwear" },
  { id: "trs", name: "Black Trouser", category: "Bottoms" },
  { id: "tee", name: "White Tee", category: "Tops" },
  { id: "pump", name: "Black Pump", category: "Shoes" },
  { id: "bag", name: "Tote", category: "Bags" },
];
const byId = new Map(W.map(i => [i.id, i]));
const NOW = new Date("2026-11-22T12:00:00Z");

test("the most-shared look from four or more weeks ago, hearts breaking ties", () => {
  const logs = [
    { id: "recent", date_worn: "2026-11-10", garment_ids: ["blz", "trs", "tee"], occasion: "Work" },   // too recent
    { id: "old2", date_worn: "2026-09-01", garment_ids: ["blz", "trs", "pump"], occasion: "Work" },
    { id: "old2h", created_at: "2026-08-15T10:00:00Z", garment_ids: ["trs", "tee", "bag"], occasion: "Casual" },
  ];
  const echo = lookEcho(["blz", "trs", "tee", "pump"], logs, { byId, hearted: new Set(["old2h"]), now: NOW });
  assert.equal(echo.id, "old2h", "two shared + a heart beats two shared");
  assert.equal(echo.hearted, true);
  assert.equal(echoLine(echo), "Echoes your Casual look from Aug 15 ♥ — the Black Trouser and the White Tee.");
});

test("nothing inside four weeks, nothing on one shared piece, nothing on shoes and bags alone", () => {
  assert.equal(lookEcho(["blz", "trs"], [{ id: "r", date_worn: "2026-11-01", garment_ids: ["blz", "trs"] }], { byId, now: NOW }), null);
  assert.equal(lookEcho(["blz", "trs"], [{ id: "o", date_worn: "2026-08-01", garment_ids: ["blz", "tee"] }], { byId, now: NOW }), null);
  assert.equal(lookEcho(["tee", "pump", "bag"], [{ id: "o", date_worn: "2026-08-01", garment_ids: ["tee", "pump", "bag"] }], { byId, now: NOW }), null);
  assert.equal(echoLine(null), "");
});

test("the echo never reaches a prompt or the sampler (display only)", () => {
  const root = new URL("../", import.meta.url);
  for (const f of ["src/lib/ai/stylist.js", "src/utils/closet-sampler.js", "src/prompts/styling-system-prompt.js"]) {
    assert.doesNotMatch(readFileSync(new URL(f, root), "utf8"), /lookEcho/, `${f} reads the echo`);
  }
});
