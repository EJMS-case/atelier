// ── NYC WEATHER (Open-Meteo) ─────────────────────────────────────────────────
// Free, keyless, no signup. Returns the daily high for the next 16 days in
// Manhattan and buckets each into the same 5-band scale used everywhere else
// (Hot / Warm / Mild / Cool / Cold) so the planner can auto-tag plans
// without the user touching a chip.
//
// Cache: localStorage, keyed by NY date, 6-hour TTL. Avoids hammering
// Open-Meteo on every planner mount.

import { LAT, LON, nyToday } from "./time.js";

const CACHE_KEY = "atelier:weather:nyc:v1";
const TTL_MS    = 6 * 60 * 60 * 1000;

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

// Returns { [iso]: { high, low, bucket } } for the next ~16 days. Falls back
// to null on network failure — callers should treat null as "weather unknown"
// and leave the chip empty.
export async function fetchNycForecast() {
  try {
    const cached = readCache();
    if (cached) return cached;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=16`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const days = data?.daily?.time || [];
    const highs = data?.daily?.temperature_2m_max || [];
    const lows  = data?.daily?.temperature_2m_min || [];
    const map = {};
    days.forEach((iso, i) => {
      const high = Math.round(highs[i]);
      const low  = Math.round(lows[i]);
      map[iso] = { high, low, bucket: bucketFromHigh(high) };
    });
    writeCache(map);
    return map;
  } catch { return null; }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, today, data } = JSON.parse(raw);
    if (Date.now() - ts > TTL_MS) return null;
    // Bust the cache once we cross into a new NY day so "today" stays correct.
    if (today !== nyToday()) return null;
    return data;
  } catch { return null; }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), today: nyToday(), data }));
  } catch { /* quota; skip */ }
}
