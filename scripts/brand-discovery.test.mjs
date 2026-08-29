#!/usr/bin/env node
// Tests for features/discovery/discoveryAI.js — the pure halves of Brand
// Atlas: the deterministic taste profile and the tolerant response parse.
//
// Run:  node scripts/brand-discovery.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { tasteProfile, parseBrandDiscovery } from "../src/features/discovery/discoveryAI.js";

const CLOSET = [
  { id: "1", brand: "Theory", category: "Bottoms", color: "Navy", name: "Wool trouser", material: "Wool" },
  { id: "2", brand: "Theory", category: "Tops", color: "Black", name: "Silk blouse", material: "Silk" },
  { id: "3", brand: "Favorite Daughter", category: "Tops", color: "Burgundy", name: "Blouse" },
  { id: "4", brand: "", category: "Shoes", color: "Black", name: "Kitten heel" },
];

test("tasteProfile ranks owned brands and carries palette lines", () => {
  const p = tasteProfile(CLOSET);
  assert.deepEqual(p.ownedBrands.slice(0, 2), ["Theory", "Favorite Daughter"]);
  assert.match(p.lines[0], /Theory×2/);
  assert.ok(p.lines.some(l => l.includes("HER CORE PALETTE") || l.includes("TEXTURE COVERAGE")));
});

const GOOD = `I searched around and here's what I found for her.

[
  {"name":"Rohe","origin":"Amsterdam","why":"Sits exactly where her Theory tailoring lives","priceBand":"$$$ · 300-600","startWith":"The draped trouser","url":"https://roheframes.com"},
  {"name":"Amomento","origin":"Seoul","why":"Quiet volume play","priceBand":"$$","startWith":"A sculpted knit","url":"https://amomento.co.kr"}
]`;

test("parseBrandDiscovery pulls the JSON array out of surrounding prose", () => {
  const brands = parseBrandDiscovery(GOOD);
  assert.equal(brands.length, 2);
  assert.equal(brands[0].name, "Rohe");
  assert.equal(brands[1].origin, "Seoul");
});

test("parseBrandDiscovery survives fences, truncation, and dedupes by name", () => {
  const fenced = "```json\n[{\"name\":\"Rohe\",\"url\":\"https://roheframes.com\"},{\"name\":\"rohe\",\"url\":\"https://dupe.com\"}]\n```";
  const brands = parseBrandDiscovery(fenced);
  assert.equal(brands.length, 1, "case-insensitive dedupe");
  const truncated = `[{"name":"Rohe","origin":"Amsterdam","why":"tailoring","priceBand":"$$$","startWith":"trouser","url":"https://roheframes.com"},{"name":"Amomento","origin":"Se`;
  const salvaged = parseBrandDiscovery(truncated);
  assert.ok(salvaged.length >= 1, "loose parse salvages the complete entries");
  assert.equal(salvaged[0].name, "Rohe");
});

test("parseBrandDiscovery rejects junk urls and nameless entries; garbage → []", () => {
  const messy = `[{"name":"X","url":"javascript:alert(1)"},{"url":"https://nameless.com"},{"name":"Ok","url":"https://ok.com"}]`;
  const brands = parseBrandDiscovery(messy);
  assert.equal(brands.length, 2);
  assert.equal(brands.find(b => b.name === "X").url, "", "non-http url dropped");
  assert.deepEqual(parseBrandDiscovery("no json here at all"), []);
  assert.deepEqual(parseBrandDiscovery(""), []);
});

test("parseBrandDiscovery prefers the LAST array when earlier bracketed text exists", () => {
  const text = `Her closet [which is lovely] leans navy.\n[{"name":"Final","url":"https://final.example"}]`;
  const brands = parseBrandDiscovery(text);
  assert.equal(brands.length, 1);
  assert.equal(brands[0].name, "Final");
});
