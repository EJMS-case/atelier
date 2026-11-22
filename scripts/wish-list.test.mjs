// ── THE WISH LIST (owner, 2026-11-22) ───────────────────────────────────────
// Her Wishlists app, moved into Atelier: a wish carries a photo, brand, price
// and link; Safari sends one in through the "＋ Atelier" bookmarklet; and the
// list totals what she has named.
// Run: npm run test:wish-list
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  parseWishPayload, bookmarkletFor, storeName, nameFromUrl, guessCategory, WISH_CLIP_PREFIX,
} from "../src/features/shopping/wishCapture.js";
import { addEntry, updateEntry, wishTotals, describeShoppingList, cleanList } from "../src/features/shopping/shoppingList.js";
import { cleanPrice } from "../src/features/shopping/shoppingListStore.js";

test("a price reads as dollars, whatever the store wrote", () => {
  assert.equal(cleanPrice("$1,524.60"), 1524.6);
  assert.equal(cleanPrice("675.00"), 675);
  assert.equal(cleanPrice(895), 895);
  assert.equal(cleanPrice(""), null);
  assert.equal(cleanPrice("free"), null);
  assert.equal(cleanPrice(0), null);
});

test("store names and categories read off what a product page gives", () => {
  assert.equal(storeName("www.bloomingdales.com"), "Bloomingdales");
  assert.equal(storeName("us.christianlouboutin.com"), "Christianlouboutin");
  assert.equal(guessCategory("Twisted Gold Side Handle Clutch"), "Bags");
  assert.equal(guessCategory("Black leather ballet flats with high heel"), "Shoes");
  assert.equal(guessCategory("YSL Cassandra extra thin black belt"), "Belts");
  assert.equal(guessCategory("Milano Two Handles Medium Bag - Black"), "Bags");
  assert.equal(guessCategory("Pro Express Ultimate"), "");
  assert.equal(nameFromUrl("https://www.ballerette.com/products/black-leather-ballet-flats-with-heel?variant=123"), "Black leather ballet flats with heel");
});

test("the bookmarklet's payload becomes a wish, image and all", () => {
  const d = { t: "Twisted Gold Side Handle Clutch | Bloomingdale's", b: "Alexis Bittar", p: "675.00", i: "https://images.bloomingdales.com/clutch.jpg", u: "https://www.bloomingdales.com/shop/product/clutch?ID=1", s: "www.bloomingdales.com" };
  for (const raw of [WISH_CLIP_PREFIX + JSON.stringify(d), "https://atelier.app/#wish=" + encodeURIComponent(JSON.stringify(d)), JSON.stringify(d)]) {
    const w = parseWishPayload(raw);
    assert.equal(w.text, "Twisted Gold Side Handle Clutch");
    assert.equal(w.brand, "Alexis Bittar");
    assert.equal(w.price, 675);
    assert.equal(w.image, "https://images.bloomingdales.com/clutch.jpg");
    assert.equal(w.store, "Bloomingdales");
    assert.equal(w.category, "Bags");
    assert.equal(w.color, "", "no colour guessed from a title (the gold is hardware)");
  }
});

test("a bare link is a wish to finish by hand; anything else is not a wish", () => {
  const w = parseWishPayload("look at this https://www.ballerette.com/products/black-leather-ballet-flats");
  assert.equal(w.text, "Black leather ballet flats");
  assert.equal(w.store, "Ballerette");
  assert.equal(w.category, "Shoes");
  assert.equal(w.image, "");
  assert.equal(parseWishPayload("a burgundy suede loafer"), null);
  assert.equal(parseWishPayload(""), null);
  assert.equal(parseWishPayload("atelier-wish:{not json"), null);
  // An http image (mixed content on her https app) is dropped, not kept broken.
  assert.equal(parseWishPayload(JSON.stringify({ t: "Bag", i: "http://x/y.jpg", u: "https://x" })).image, "");
});

// The bookmarklet runs on the STORE's page. Run it against a fake one: a
// schema.org Product in JSON-LD, the og: tags behind it.
function runBookmarklet({ ld = null, meta = {}, title = "Store" } = {}) {
  const opened = [];
  const copied = [];
  const scripts = ld ? [{ textContent: JSON.stringify(ld) }] : [];
  const document = {
    title,
    querySelector: (sel) => {
      const key = Object.keys(meta).find(k => sel.includes(`"${k}"`));
      return key ? { getAttribute: () => meta[key] } : null;
    },
    querySelectorAll: () => scripts,
  };
  const ctx = {
    document,
    location: { href: "https://www.example-store.com/p/clutch?x=1", hostname: "www.example-store.com" },
    navigator: { clipboard: { writeText: (t) => copied.push(t) } },
    window: { open: (u) => { opened.push(u); return {}; } },
    JSON, encodeURIComponent, Array, String,
  };
  const src = decodeURIComponent(bookmarkletFor("https://atelier.example").slice("javascript:".length));
  vm.runInNewContext(src, ctx);
  return { opened, copied };
}

test("the bookmarklet reads a Product's JSON-LD and opens Atelier with it", () => {
  const { opened, copied } = runBookmarklet({
    ld: { "@context": "https://schema.org", "@graph": [{ "@type": "BreadcrumbList" }, {
      "@type": "Product", name: "Cassia Nodo", brand: { "@type": "Brand", name: "Christian Louboutin" },
      image: ["//img.example.com/cassia.jpg"], offers: { "@type": "Offer", price: "895.00", priceCurrency: "USD" },
    }] },
  });
  assert.equal(opened.length, 1);
  assert.ok(opened[0].startsWith("https://atelier.example/#wish="));
  const w = parseWishPayload(opened[0]);
  assert.equal(w.text, "Cassia Nodo");
  assert.equal(w.brand, "Christian Louboutin");
  assert.equal(w.price, 895);
  assert.equal(w.image, "https://img.example.com/cassia.jpg", "a protocol-relative image gains https");
  assert.equal(copied.length, 1);
  assert.deepEqual(parseWishPayload(copied[0]), w, "the clipboard carries the same wish for the home-screen app");
});

test("with no JSON-LD the bookmarklet falls back to the page's og: tags", () => {
  const { opened } = runBookmarklet({
    meta: { "og:title": "Black Leather Ballet Flats – BalleretTe", "og:image": "https://cdn.example.com/flats.jpg", "product:price:amount": "245" },
  });
  const w = parseWishPayload(opened[0]);
  assert.equal(w.text, "Black Leather Ballet Flats");
  assert.equal(w.image, "https://cdn.example.com/flats.jpg");
  assert.equal(w.price, 245);
  assert.equal(w.url, "https://www.example-store.com/p/clutch?x=1");
});

test("wishes keep their details, total up, and reach every prompt with them", () => {
  let list = addEntry([], { text: "Cassia Nodo", brand: "Christian Louboutin", price: 895, image: "https://x/c.jpg", url: "https://a", category: "Shoes", mustHave: true });
  list = addEntry(list, { text: "Twisted Gold Side Handle Clutch", brand: "Alexis Bittar", price: "675.00", url: "https://b" });
  list = addEntry(list, { text: "a burgundy suede loafer" });
  assert.equal(list.length, 3);
  assert.deepEqual(wishTotals(list), { open: 3, total: 1570 });
  // Two links with alike names are two wishes; the same words with no link are one.
  assert.equal(addEntry(list, { text: "Cassia Nodo", url: "https://other" }).length, 4);
  assert.equal(addEntry(list, { text: "a burgundy suede loafer" }).length, 3);
  const id = list[1].id;
  list = updateEntry(list, id, { mustHave: true, read: { headline: "Yes — it finishes your black evening looks.", take: "…", owns: [{ id: "w1", note: "your black clutch" }], pairs: [], at: "2026-11-22" } });
  assert.equal(list[1].mustHave, true);
  assert.equal(list[1].read.owns[0].id, "w1");
  assert.equal(cleanList(list)[1].read.headline, "Yes — it finishes your black evening looks.", "a read survives the store's clean");
  const block = describeShoppingList(list);
  assert.match(block, /Cassia Nodo by Christian Louboutin \$895 \[Shoes\] \(a must-have for her\)/);
  assert.match(block, /Twisted Gold Side Handle Clutch by Alexis Bittar \$675/);
});

// ── Atelier's read of a wish ─────────────────────────────────────────────────
import { similarOwned, wearLine, composeWishMessages, resolveWishRead } from "../src/features/shopping/wishRead.js";

const W = [
  { id: "c1", name: "Quilted Chain Clutch", category: "Bags", subcategory: "Clutch", color: "Black", wear_count: 2, last_worn: "2026-03-01" },
  { id: "c2", name: "Satin Evening Clutch", category: "Bags", subcategory: "Clutch", color: "Burgundy", wear_count: 0 },
  { id: "t1", name: "Work Tote", category: "Bags", subcategory: "Tote", color: "Navy", wear_count: 40, last_worn: "2026-11-18" },
  { id: "f1", name: "Ballet Flat", category: "Shoes", subcategory: "Flats", color: "Black", wear_count: 9 },
  { id: "d1", name: "Black Slip Dress", brand: "Theory", category: "Dresses", color: "Black", wear_count: 5 },
];
const NOW = new Date("2026-11-22T12:00:00Z");

test("what she owns like a wish: same category and shape, most worn first", () => {
  const like = similarOwned({ text: "Twisted Gold Side Handle Clutch", category: "Bags" }, W);
  assert.deepEqual(like.map(i => i.id), ["c1", "c2"], "clutches, not the tote");
  assert.deepEqual(similarOwned({ text: "a black ballet flat" }, W).map(i => i.id), ["f1"], "the category is read off the words when unset");
  assert.deepEqual(similarOwned({ text: "Pro Express Ultimate" }, W), [], "no category, no guess");
  assert.equal(wearLine(W[1], NOW), "never worn");
  assert.equal(wearLine(W[2], NOW), "worn 40 times, recently");
  assert.equal(wearLine(W[0], NOW), "worn 2 times, last in March");
});

test("the read composes from the standard, with the app's facts and her closet", () => {
  const { system, user } = composeWishMessages({
    wish: { text: "Twisted Gold Side Handle Clutch", brand: "Alexis Bittar", price: 675, category: "Bags", image: "https://x/y.jpg" },
    wardrobe: W, personal: ["HER BODY & FIT: test"], now: NOW,
  });
  assert.match(system, /You are Elyce's personal stylist/);
  assert.match(system, /HOW SHE WEARS THINGS/);
  assert.match(system, /WOMENSWEAR ONLY/);
  assert.match(system, /HER BODY & FIT: test/);
  assert.match(system, /Work Tote/, "her whole closet, both rooms");
  assert.match(user, /THE WISH: Twisted Gold Side Handle Clutch/);
  assert.match(user, /Price: \$675/);
  assert.match(user, /Satin Evening Clutch.*never worn/);
  assert.match(user, /product photo is attached/);
  assert.match(user, /Taste, never a rule/);
});

test("a read keeps only pieces she owns", () => {
  const r = resolveWishRead({
    headline: "Buy it — it's the evening bag your black dresses keep asking for.",
    take: "You own two clutches and carry neither.",
    owns: [{ name: "Satin Evening Clutch", color: "Burgundy", note: "never out" }, { name: "Gold Minaudière", note: "invented" }],
    pairs: [{ name: "Black Slip Dress", brand: "Theory", why: "the gold against black silk" }],
  }, W, { now: NOW });
  assert.deepEqual(r.owns, [{ id: "c2", note: "never out" }], "the invented piece is dropped");
  assert.deepEqual(r.pairs, [{ id: "d1", why: "the gold against black silk" }]);
  assert.equal(r.at, NOW.toISOString());
});
