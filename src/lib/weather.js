// ── WEATHER (Open-Meteo) ─────────────────────────────────────────────────────
// Free, keyless, no signup. Returns the daily high for the next 16 days at
// any lat/lon and buckets each into the same 5-band scale used everywhere
// else (Hot / Warm / Mild / Cool / Cold) so the planner can auto-tag plans
// without the user touching a chip.
//
// Cache: localStorage, keyed by NY date + location, 6-hour TTL. Avoids
// hammering Open-Meteo on every planner mount.

import { LAT, LON, nyToday } from "./time.js";

const NYC_CACHE_KEY  = "atelier:weather:nyc:v1";
const TRIP_CACHE_KEY = "atelier:weather:trip:v1";
const TTL_MS         = 6 * 60 * 60 * 1000;
// Open-Meteo's forecast endpoint serves 16 days ahead at most.
export const FORECAST_HORIZON_DAYS = 16;

// Map a Fahrenheit high to one of the chips. Thresholds match the
// existing weather labels in App.jsx (85 / 70 / 55 / 40).
export function bucketFromHigh(highF) {
  if (highF == null) return "";
  if (highF >= 85) return "Hot";
  if (highF >= 70) return "Warm";
  if (highF >= 55) return "Mild";
  if (highF >= 40) return "Cool";
  return "Cold";
}

// Returns { [iso]: { high, low, bucket } } for the next ~16 days at NYC.
// Falls back to null on network failure.
export async function fetchNycForecast() {
  return fetchForecastAt(LAT, LON, "America/New_York", NYC_CACHE_KEY);
}

/**
 * Per-day forecast for a trip destination. lat/lon come from geocodeDestination().
 * Returns { [iso]: { high, low, bucket } } or null on failure.
 * Cached under a key that includes the rounded coords so trips to different
 * cities don't stomp each other.
 */
export async function fetchTripForecast(lat, lon, timezone) {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const key = `${TRIP_CACHE_KEY}:${lat.toFixed(2)},${lon.toFixed(2)}`;
  return fetchForecastAt(lat, lon, timezone || "UTC", key);
}

async function fetchForecastAt(lat, lon, tz, cacheKey) {
  try {
    const cached = readCache(cacheKey);
    if (cached) return cached;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}&forecast_days=${FORECAST_HORIZON_DAYS}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const days  = data?.daily?.time || [];
    const highs = data?.daily?.temperature_2m_max || [];
    const lows  = data?.daily?.temperature_2m_min || [];
    const map = {};
    days.forEach((iso, i) => {
      const high = Math.round(highs[i]);
      const low  = Math.round(lows[i]);
      map[iso] = { high, low, bucket: bucketFromHigh(high) };
    });
    writeCache(cacheKey, map);
    return map;
  } catch { return null; }
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, today, data } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) return null;
    // Bust the cache once we cross into a new NY day so "today" stays correct.
    if (today !== nyToday()) return null;
    return data;
  } catch { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), today: nyToday(), data }));
  } catch { /* quota; skip */ }
}
