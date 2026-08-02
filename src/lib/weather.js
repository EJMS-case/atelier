// ── WEATHER (Open-Meteo) ─────────────────────────────────────────────────────
// Free, keyless, no signup. Returns the daily high for the next 16 days at
// any lat/lon and buckets each into the same 5-band scale used everywhere
// else (Hot / Warm / Mild / Cool / Cold) so the planner can auto-tag plans
// without the user touching a chip. Each day also carries the WMO weathercode
// mapped to a condition label ("Rainy", "Snowy", …) plus the max precipitation
// probability, so trip days can flag packing-relevant weather.
//
// Cache: in-memory Map first (re-renders/tab switches never refetch), then
// localStorage (survives reloads), keyed by NY date + location, 6-hour TTL.
// Avoids hammering Open-Meteo on every planner mount.

import { LAT, LON, nyToday } from "./time.js";

// v2: entries gained { code, precip, condition } when the forecast started
// requesting weathercode + precipitation_probability_max.
const NYC_CACHE_KEY  = "atelier:weather:nyc:v2";
const TRIP_CACHE_KEY = "atelier:weather:trip:v2";
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

// Map a WMO weathercode (Open-Meteo's `weathercode` daily variable) to the
// planner's condition labels. Same adjective register as the old "+ Rainy"
// weather strings the filters/prompt already tolerate — but these labels are
// DISPLAY-ONLY: downstream outfit logic keeps consuming the pure temperature
// bucket from bucketFromHigh().
export function conditionFromCode(code) {
  if (code == null) return "";
  if (code === 0 || code === 1) return "Clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzly";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "Rainy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snowy";
  if (code >= 95) return "Stormy";
  return "";
}

// Conditions worth surfacing on a compact day chip — precip/fog changes what
// you pack; "Clear" and "Partly cloudy" are just noise at that size.
export function isNotableCondition(condition) {
  return condition === "Drizzly" || condition === "Rainy" ||
         condition === "Snowy"   || condition === "Stormy" ||
         condition === "Foggy";
}

// Returns { [iso]: { high, low, bucket, code, precip, condition } } for the
// next ~16 days at NYC. Falls back to null on network failure.
export async function fetchNycForecast() {
  return fetchForecastAt(LAT, LON, "America/New_York", NYC_CACHE_KEY);
}

/**
 * Per-day forecast for a trip destination. lat/lon come from geocodeDestination().
 * Returns { [iso]: { high, low, bucket, code, precip, condition } } or null on
 * failure. Cached under a key that includes the rounded coords so trips to
 * different cities don't stomp each other.
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&temperature_unit=fahrenheit&timezone=${encodeURIComponent(tz)}&forecast_days=${FORECAST_HORIZON_DAYS}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const days   = data?.daily?.time || [];
    const highs  = data?.daily?.temperature_2m_max || [];
    const lows   = data?.daily?.temperature_2m_min || [];
    // Open-Meteo mirrors the requested param name; accept the newer
    // `weather_code` alias too in case the API normalizes it someday.
    const codes  = data?.daily?.weathercode || data?.daily?.weather_code || [];
    const precip = data?.daily?.precipitation_probability_max || [];
    const map = {};
    days.forEach((iso, i) => {
      const high = Number.isFinite(highs[i]) ? Math.round(highs[i]) : null;
      const low  = Number.isFinite(lows[i])  ? Math.round(lows[i])  : null;
      const code = Number.isFinite(codes[i]) ? codes[i] : null;
      map[iso] = {
        high,
        low,
        bucket: bucketFromHigh(high),
        code,
        precip: Number.isFinite(precip[i]) ? Math.round(precip[i]) : null,
        condition: conditionFromCode(code),
      };
    });
    if (days.length === 0) return null;
    writeCache(cacheKey, map);
    return map;
  } catch { return null; }
}

// ── Cache plumbing ───────────────────────────────────────────────────────────
// Module-level Map in front of localStorage: re-renders and tab switches hit
// the Map (even when localStorage writes fail on quota); reloads hit
// localStorage. Both layers share the same TTL + NY-day-boundary validation.

const memCache = new Map(); // cacheKey → { ts, today, data }

function validEnvelope(env) {
  if (!env) return null;
  if (Date.now() - env.ts > TTL_MS) return null;
  // Bust the cache once we cross into a new NY day so "today" stays correct.
  if (env.today !== nyToday()) return null;
  return env.data;
}

function readCache(key) {
  const memEnv = memCache.get(key);
  const memHit = validEnvelope(memEnv);
  if (memHit) return memHit;
  // Evict expired envelopes — validEnvelope returning null used to leave the
  // dead entry in the Map forever (one per trip destination per session).
  if (memEnv) memCache.delete(key);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw);
    const data = validEnvelope(env);
    if (data) memCache.set(key, env);
    return data;
  } catch { return null; }
}

function writeCache(key, data) {
  const env = { ts: Date.now(), today: nyToday(), data };
  memCache.set(key, env);
  try {
    localStorage.setItem(key, JSON.stringify(env));
  } catch { /* quota; memory layer still covers this session */ }
}
