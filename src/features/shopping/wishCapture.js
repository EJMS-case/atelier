// ── GETTING A WISH IN FROM SAFARI ───────────────────────────────────────────
// Owner, 2026-11-22, on her Wishlists app: "I love that I can add wishes from
// safari … I like that when I add something it fills in all the details of
// the wish including an image."
//
// A web app cannot sit in the iOS share sheet, and a store's page cannot be
// fetched from her browser (CORS, and most luxury stores turn away a server
// that asks). What CAN read the page is the page itself, so the capture is a
// bookmarklet: "＋ Atelier" in her Safari bookmarks, tapped on a product page,
// reads the page's own product data (schema.org Product JSON-LD, then the
// og:/product: meta tags every store sets for link previews) and
//   · opens Atelier at /#wish=<details>, where the Add-a-wish sheet is
//     waiting, filled in, and
//   · copies the same details to the clipboard as "atelier-wish:{…}", so the
//     home-screen app (its own storage, separate from Safari's) takes them
//     with one Paste.
// A bare product link pasted into the sheet is the fallback: the store and a
// name read off the link, the rest hers to type.
//
// Pure, no React; exported for scripts/wish-list.test.mjs.

import { canonicalCategory } from "./verifyGaps.js";
import { cleanPrice } from "./shoppingListStore.js";

export const WISH_HASH = "#wish=";
export const WISH_CLIP_PREFIX = "atelier-wish:";

// Runs on the STORE's page, so it is plain ES5 with no imports, and every
// read is guarded: a page that lacks a field yields "", never an error.
const BOOKMARKLET_BODY = `(function(){
var m=function(p){var e=document.querySelector('meta[property="'+p+'"],meta[name="'+p+'"],meta[itemprop="'+p+'"]');return e?(e.getAttribute('content')||''):''};
var ld=null;
var walk=function(o){if(!o||typeof o!=='object'||ld)return;if(Array.isArray(o)){o.forEach(walk);return}if(o['@graph'])walk(o['@graph']);var t=[].concat(o['@type']||[]).join(' ');if(/Product/.test(t))ld=o};
[].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).forEach(function(s){try{walk(JSON.parse(s.textContent))}catch(e){}});
ld=ld||{};
var img=ld.image;if(Array.isArray(img))img=img[0];if(img&&typeof img==='object')img=img.url||img.contentUrl;
var off=ld.offers;if(Array.isArray(off))off=off[0];if(off&&off.offers)off=[].concat(off.offers)[0];
var price=(off&&(off.price||off.lowPrice||(off.priceSpecification&&off.priceSpecification.price)))||m('product:price:amount')||m('og:price:amount')||'';
var brand=ld.brand;if(Array.isArray(brand))brand=brand[0];if(brand&&typeof brand==='object')brand=brand.name;
var d={t:String(ld.name||m('og:title')||document.title||'').trim(),b:String(brand||m('product:brand')||'').trim(),p:String(price),i:String(img||m('og:image')||m('twitter:image')||''),u:m('og:url')||location.href,s:location.hostname};
if(d.i.indexOf('//')===0)d.i='https:'+d.i;
var j=JSON.stringify(d);
try{navigator.clipboard.writeText('${WISH_CLIP_PREFIX}'+j)}catch(e){}
var to='__ORIGIN__/${WISH_HASH}'+encodeURIComponent(j);
if(!window.open(to,'_blank'))location.href=to;
})();`;

/** The javascript: URL she saves as a bookmark, pointed at this deployment. */
export function bookmarkletFor(origin) {
  const code = BOOKMARKLET_BODY.replace("__ORIGIN__", String(origin || "").replace(/\/+$/, "")).replace(/\n/g, "");
  return `javascript:${encodeURIComponent(code)}`;
}

/** "www.bloomingdales.com" → "Bloomingdales". */
export function storeName(host) {
  const h = String(host || "").toLowerCase().replace(/^www\d?\./, "").replace(/^(m|shop|us|en)\./, "");
  const base = h.split(".")[0] || "";
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

/** A readable name from a product link's path, when that is all there is. */
export function nameFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean)
      .map(p => decodeURIComponent(p).replace(/\.(html?|aspx?|php)$/i, ""))
      .filter(p => /[a-z]{3,}/i.test(p) && !/^(p|product|products|shop|en-us|us|en|item|dp)$/i.test(p));
    const slug = parts.sort((a, b) => b.length - a.length)[0] || "";
    const words = slug.replace(/[-_+]+/g, " ").replace(/\b[A-Z0-9]*\d[A-Z0-9]*\b/gi, " ").replace(/\s+/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
  } catch { return ""; }
}

/** The category a product name implies ("… Side Handle Clutch" → Bags), or "". */
export function guessCategory(text) {
  const words = String(text || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const c = canonicalCategory(words[i]);
    if (c) return c;
  }
  return "";
}

// A store title often carries the store: "Twisted Clutch | Bloomingdale's".
function cleanTitle(t, store) {
  let s = String(t || "").replace(/\s+/g, " ").trim();
  const cut = s.split(/\s+[|–—]\s+/)[0];
  if (cut && cut.length >= 6) s = cut;
  if (store && s.toLowerCase().endsWith(` - ${store.toLowerCase()}`)) s = s.slice(0, -(store.length + 3));
  return s.slice(0, 160);
}

/**
 * Whatever she pasted or the bookmarklet sent, as the fields of a wish — or
 * null when it is neither. Accepts "atelier-wish:{…}", a URL or hash carrying
 * "#wish=…", the raw JSON, or a bare https product link.
 */
export function parseWishPayload(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let d = null;
  try {
    if (raw.startsWith(WISH_CLIP_PREFIX)) d = JSON.parse(raw.slice(WISH_CLIP_PREFIX.length));
    else if (raw.includes(WISH_HASH)) d = JSON.parse(decodeURIComponent(raw.slice(raw.indexOf(WISH_HASH) + WISH_HASH.length)));
    else if (raw.startsWith("{")) d = JSON.parse(raw);
  } catch { d = null; }
  if (!d) {
    const link = raw.match(/https?:\/\/\S+/)?.[0];
    if (!link) return null;
    let host = "";
    try { host = new URL(link).hostname; } catch { return null; }
    d = { t: nameFromUrl(link), u: link, s: host };
  }
  const store = storeName(d.s || (() => { try { return new URL(d.u).hostname; } catch { return ""; } })());
  const text = cleanTitle(d.t, store);
  const image = String(d.i || "").startsWith("https://") ? String(d.i) : "";
  return {
    text,
    brand: String(d.b || "").trim().slice(0, 80),
    price: cleanPrice(d.p),
    image,
    url: String(d.u || "").startsWith("http") ? String(d.u) : "",
    store,
    category: guessCategory(text),
    // No colour guess: a title names hardware as often as the piece ("Twisted
    // Gold … Clutch" is burgundy). The photo carries the colour, and Atelier's
    // read looks at it.
    color: "",
  };
}
