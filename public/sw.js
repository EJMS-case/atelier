// ── ATELIER SERVICE WORKER ───────────────────────────────────────────────────
// Two placeholders below are rewritten by scripts/stamp-sw.mjs (which runs as
// part of `npm run build`): the build id, and this build's full js/css chunk
// list. Keep both tokens out of prose here — the stamper validates and
// rewrites every occurrence.
//
// Why the chunk list is PRECACHED (owner outage, 2026-09-10): deploys are
// atomic — the new deploy stops serving the previous build's hashed files.
// The app is a PWA she keeps open on her phone, and its AI surfaces are
// code-split, so the first tap on Style Me after a deploy dynamic-imported a
// chunk that no longer existed: every tap errored until a full reload. Worse,
// the old fetch handler cached that 404/HTML response under the chunk's URL,
// so the failure stuck. Now each build precaches its own chunks at install,
// the previous build's cache is RETAINED (one deploy back), and asset lookup
// searches every cache — an already-open page keeps working right through a
// deploy. src/main.jsx's vite:preloadError listener is the last-resort floor
// (two deploys while open, install races): reload once for the fresh index.
//
// The ML runtimes (ort*, *.wasm — ~24 MB, only local background removal) are
// deliberately NOT precached; the stamper excludes them.
const CACHE = "atelier-__BUILD_ID__";
const CORE = ["/", "/favicon.svg", "/manifest.webmanifest", "/icon-192.svg", "/icon-512.svg"];
const BUILD_ASSETS = __ASSET_LIST__;
// Install-time registry (cache name → install ms) so activate can keep the
// newest two build caches and delete the rest. A plain named cache, never
// deleted, holding one synthetic entry per build.
const INDEX_CACHE = "atelier-cache-index";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...CORE, ...BUILD_ASSETS]);
    const idx = await caches.open(INDEX_CACHE);
    await idx.put(new Request(`/__cache_index__/${CACHE}`), new Response(String(Date.now())));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const idx = await caches.open(INDEX_CACHE);
    const reqs = await idx.keys();
    const entries = await Promise.all(reqs.map(async (req) => ({
      req,
      name: req.url.split("/__cache_index__/")[1] || "",
      at: Number(await (await idx.match(req)).text()) || 0,
    })));
    // Newest two builds survive — the one just installed plus the previous
    // deploy, so a page that was open across the deploy still finds its own
    // chunks. Everything older (and any pre-registry cache, poisoned entries
    // included) goes.
    const keep = new Set(entries.sort((a, b) => b.at - a.at).slice(0, 2).map(e => e.name));
    keep.add(CACHE);
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n !== INDEX_CACHE && !keep.has(n))
      .map(n => caches.delete(n)));
    await Promise.all(entries.filter(e => !keep.has(e.name)).map(e => idx.delete(e.req)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a good response may replace the cached shell — caching a 404
          // or error page under "/" would poison every offline launch.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  if (/\.(?:js|css|svg|webmanifest|png|jpg|jpeg|woff2?|mjs|wasm)$/.test(url.pathname)) {
    // caches.match with no cache name searches EVERY cache, newest first —
    // this is what lets a page from the previous build load its own hashed
    // chunks out of the retained previous cache after a deploy.
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            // Never cache a failed asset response: the pre-2026-09-10 worker
            // cached whatever came back, so one 404 during a deploy window
            // wedged that URL until the next build's activate.
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
