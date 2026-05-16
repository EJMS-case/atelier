// ── DESTINATION GEOCODER (Open-Meteo) ────────────────────────────────────────
// Resolves a free-text place name ("Lisbon", "Tokyo", "Paris, France") to
// lat/lon + timezone so we can pull a per-day forecast for trips.
// Free, keyless, no signup. Results cached in localStorage for 30 days
// since cities don't move — the cache survives reloads.

const CACHE_KEY = "atelier:geocode:v1";
const TTL_MS    = 30 * 24 * 60 * 60 * 1000;

/**
 * Look up a destination string. Returns the first hit:
 *   { name, country, lat, lon, timezone }
 * or null if the query is empty, the network fails, or nothing matches.
 */
export async function geocodeDestination(query) {
  const q = (query || "").trim();
  if (!q) return null;
  const cache = readCache();
  if (cache[q.toLowerCase()]) return cache[q.toLowerCase()];
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.results?.[0];
    if (!hit) return null;
    const out = {
      name:     hit.name,
      country:  hit.country || "",
      lat:      hit.latitude,
      lon:      hit.longitude,
      timezone: hit.timezone || "UTC",
    };
    writeCache({ ...cache, [q.toLowerCase()]: out });
    return out;
  } catch {
    return null;
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) return {};
    return data || {};
  } catch { return {}; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* quota; skip */ }
}
