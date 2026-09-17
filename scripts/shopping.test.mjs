// Shopping — the gap analysis grounded in her rows and verified against them.
// Owner, 2026-09-17: "It suggested a blue tote which I have. And the price
// points are way high! … 1 of the shopping suggestions was menswear only."
import test from "node:test";
import assert from "node:assert/strict";
import { spendBands, brandTier, describeSpend, describeBrandTier } from "../src/features/shopping/spend.js";
import { verifyGaps, ownedMatches, canonicalCategory, suggestionFamily, gapKey, MENSWEAR_RE } from "../src/features/shopping/verifyGaps.js";
import { describeBrandFinds, findsForCategory } from "../src/features/shopping/brandFinds.js";
import { withVerdict, describeVerdicts } from "../src/features/shopping/verdicts.js";
import { describeWearRooms, WOMENSWEAR_LINE } from "../src/features/shopping/gapAnalysis.js";

let n = 0;
const piece = (category, subcategory, color, extra = {}) => ({ id: `w${++n}`, name: `${color} ${subcategory}`, category, subcategory, color, ...extra });

const wardrobe = [
  piece("Bags", "Tote", "Navy", { brand: "Quince", price_paid: 368 }),
  piece("Bags", "Tote", "Black", { brand: "Tory Burch", price_paid: 350 }),
  piece("Bags", "Shoulder", "Black", { brand: "Dior", price_paid: 4500 }),
  piece("Bags", "Crossbody", "Brown", { brand: "Rebecca Minkoff", price_paid: 175 }),
  piece("Bags", "Shoulder", "Burgundy", { brand: "Mansur Gavriel", price_paid: 275 }),
  piece("Shoes", "Loafers", "Chocolate", { brand: "Sam Edelman", price_paid: 150 }),
  piece("Shoes", "Heels", "Black", { brand: "Sam Edelman", price_paid: 175 }),
  piece("Shoes", "Boots", "Black", { brand: "Sam Edelman", price_paid: 260 }),
  piece("Tops", "Blouses", "Ivory", { brand: "Favorite Daughter", price_paid: 90 }),
  piece("Tops", "Blouses", "Navy", { brand: "Favorite Daughter", price_paid: 110 }),
  piece("Tops", "Tees", "White", { brand: "Favorite Daughter", price_paid: 70 }),
  piece("Knits", "Cardigans", "Camel", { brand: "Quince", price_paid: 100 }),
  piece("Knits", "Pullovers", "Black", { price_paid: 120 }),
  piece("Misc", "", "Red", { price_paid: 9999 }),
];

test("spend bands come from her own priced rows, per category, and skip thin categories", () => {
  const bands = spendBands(wardrobe);
  assert.equal(bands.Bags.n, 5);
  assert.equal(bands.Bags.median, 350);
  assert.equal(bands.Bags.max, 4500);
  assert.equal(bands.Shoes.median, 175);
  assert.equal(bands.Knits, undefined, "two priced knits is not a band");
  assert.equal(bands.Misc, undefined);
  const text = describeSpend(wardrobe);
  assert.match(text, /Bags: typically \$\d+–\$\d+, median \$350 \(she has gone to \$4,500 once/);
  assert.match(text, /At most ONE pick per run may sit above the band/);
});

test("the brand tier is the brands she keeps buying, with what she paid", () => {
  const tier = brandTier(wardrobe);
  assert.deepEqual(tier.map(b => b.name), ["Favorite Daughter", "Sam Edelman"]);
  assert.equal(tier[0].avg, 90);
  assert.match(describeBrandTier(wardrobe), /Favorite Daughter×3 \(~\$90\)/);
  assert.match(describeBrandTier(wardrobe), /not a luxury house she does not shop/);
});

test("a suggestion she already owns — the blue tote — is caught by category + colour family + form", () => {
  const blueTote = { category: "Bags", subcategory: "Tote", suggestion: "Cobalt blue structured leather tote", description: "", reason: "", price: "$900" };
  const owned = ownedMatches(blueTote, wardrobe);
  assert.equal(owned.length, 1);
  assert.equal(owned[0].name, "Navy Tote");
  // A form she does NOT own in that colour is still a gap.
  const blueClutch = { category: "Bags", subcategory: "Clutch", suggestion: "Navy satin clutch" };
  assert.equal(ownedMatches(blueClutch, wardrobe).length, 0);
  // Free-text categories map onto the taxonomy.
  assert.equal(canonicalCategory("Bag"), "Bags");
  assert.equal(canonicalCategory("Shoes > Loafers"), "Shoes");
  assert.equal(canonicalCategory("footwear"), "Shoes");
  assert.equal(suggestionFamily({ suggestion: "oxblood leather belt" }), "Red");
  // No subcategory on the suggestion: the form word in the suggestion decides.
  const navyLoafer = { category: "Shoes", suggestion: "navy suede loafer" };
  assert.equal(ownedMatches(navyLoafer, wardrobe).length, 0, "she owns chocolate loafers, not navy");
  const blackBoot = { category: "Shoes", suggestion: "black leather knee boot" };
  assert.equal(ownedMatches(blackBoot, wardrobe).length, 1);
});

test("verifyGaps drops owned pieces, menswear, and what her verdicts already settled — and keeps the rest", () => {
  const gaps = [
    { category: "Bags", subcategory: "Tote", suggestion: "Cobalt blue leather tote", description: "", reason: "" },
    { category: "Outerwear", suggestion: "Men's camel overcoat", description: "a menswear classic", reason: "" },
    { category: "Knits", suggestion: "Burgundy merino crewneck", description: "", reason: "" },
    { category: "Shoes", suggestion: "Chocolate suede loafer", description: "", reason: "" },
    { category: "Belts", suggestion: "Black leather belt with a gold buckle", description: "", reason: "" },
  ];
  const verdicts = [
    withVerdict([], { category: "Belts", suggestion: "Black leather belt with a gold buckle" }, "no")[0],
  ];
  const { kept, dropped } = verifyGaps(gaps, { wardrobe, verdicts });
  assert.deepEqual(kept.map(g => g.suggestion), ["Burgundy merino crewneck"]);
  assert.equal(dropped.length, 4);
  assert.match(dropped[0].reason, /already own/);
  assert.equal(dropped[0].owned[0].name, "Navy Tote");
  assert.match(dropped[1].reason, /menswear/);
  assert.match(dropped[2].reason, /already own/);
  assert.match(dropped[3].reason, /isn't for you/);
  assert.ok(MENSWEAR_RE.test("borrowed-from-the-boys menswear trouser"));
  assert.ok(!MENSWEAR_RE.test("a women's tailored trouser"));
});

test("an 'I own this' verdict covers the same category + family whatever the wording next time", () => {
  const verdicts = withVerdict([], { category: "Bags", suggestion: "Deep navy leather work tote" }, "own");
  const next = { category: "Bag", suggestion: "Cobalt structured carryall", description: "", reason: "" };
  const { dropped } = verifyGaps([next], { wardrobe: [], verdicts });
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /you said you own this/);
  // A verdict is replaced, not stacked, for the same suggestion.
  const twice = withVerdict(verdicts, { category: "Bags", suggestion: "Deep navy leather work tote" }, "yes");
  assert.equal(twice.length, 1);
  assert.equal(twice[0].verdict, "yes");
  assert.equal(withVerdict(twice, { category: "Bags", suggestion: "Deep navy leather work tote" }, null).length, 0);
  assert.equal(typeof gapKey(next), "string");
  const text = describeVerdicts([...twice, ...withVerdict([], { category: "Belts", suggestion: "Wide western belt" }, "no")]);
  assert.match(text, /She WANTS.*Deep navy leather work tote/);
  assert.match(text, /NOT her taste: Wide western belt/);
});

test("her brand finds compose into a block and filter by category", () => {
  const finds = [
    { name: "Vagabond", categories: ["Shoes"], url: "https://example.com", note: "" },
    { name: "Sézane", categories: [], note: "everything" },
    { name: "", categories: ["Bags"] },
  ];
  assert.deepEqual(findsForCategory(finds, "shoes").map(f => f.name), ["Vagabond", "Sézane"]);
  assert.deepEqual(findsForCategory(finds, "Bags").map(f => f.name), ["Sézane"]);
  const text = describeBrandFinds(finds);
  assert.match(text, /• Vagabond — Shoes/);
  assert.match(text, /• Sézane — any category \(everything\)/);
  assert.equal(describeBrandFinds([]), "");
});

test("the rooms she dresses for come from worn logs inside the window, and the womenswear line is structural", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const logs = [
    { date_worn: "2026-09-10", occasion: "Work" },
    { date_worn: "2026-09-11", occasion: "Work" },
    { date_worn: "2026-09-12", occasions: ["Casual"] },
    { date_worn: "2026-01-01", occasion: "Occasion" },
  ];
  assert.match(describeWearRooms(logs, { now }), /Work×2, Casual×1/);
  assert.doesNotMatch(describeWearRooms(logs, { now }), /Occasion×/);
  assert.equal(describeWearRooms([], { now }), "");
  assert.match(WOMENSWEAR_LINE, /^WOMENSWEAR ONLY/);
});

test("spend bands weight her most recent purchases, fall back to all-time where recent is thin, and say which", () => {
  // Older tops were cheap; the recent ones are not — her range rose.
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push({ id: `old${i}`, category: "Tops", price_paid: 40 + i, created_at: `2025-01-0${i + 1}` });
  for (let i = 0; i < 4; i++) rows.push({ id: `new${i}`, category: "Tops", price_paid: 150 + i * 10, created_at: `2026-09-0${i + 1}` });
  // Bags: only two recent, five old — the band falls back to all-time.
  for (let i = 0; i < 5; i++) rows.push({ id: `bag${i}`, category: "Bags", price_paid: 300, created_at: `2025-02-0${i + 1}` });
  rows.push({ id: "bagnew", category: "Bags", price_paid: 900, created_at: "2026-09-10" });
  const bands = spendBands(rows, { recent: 5 });
  assert.equal(bands.Tops.basis, "recent");
  assert.equal(bands.Tops.n, 4);
  assert.ok(bands.Tops.median >= 150, `recent median ${bands.Tops.median} should reflect the newer buys`);
  assert.equal(bands.Bags.basis, "all");
  assert.equal(bands.Bags.allTimeMax, 900);
  const text = describeSpend(rows);
  assert.match(text, /weighted to her most recent buys/);
  assert.match(text, /genuinely extraordinary/);
});
