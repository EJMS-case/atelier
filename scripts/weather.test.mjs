// ── WEATHER / FORECAST TESTS ─────────────────────────────────────────────────
// Node-runnable checks for the Open-Meteo client (src/lib/weather.js) and the
// destination geocoder (src/lib/geocode.js). The live API is not reachable
// from CI/sandboxes, so `fetch` is stubbed — these tests pin down the parsing,
// the condition-label mapping, the in-memory caching, and (most importantly)
// the graceful-degradation contract: every failure path returns null so the
// planner falls back to the seasonal estimate instead of erroring.
//
// Run: npm run test:weather

import {
  bucketFromHigh,
  conditionFromCode,
  isNotableCondition,
  fetchTripForecast,
  FORECAST_HORIZON_DAYS,
} from "../src/lib/weather.js";
import { geocodeDestination } from "../src/lib/geocode.js";

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error(`✗ ${name}`); }
}

// ── bucketFromHigh boundaries ────────────────────────────────────────────────
check("bucket: 85 → Hot",   bucketFromHigh(85) === "Hot");
check("bucket: 84 → Warm",  bucketFromHigh(84) === "Warm");
check("bucket: 70 → Warm",  bucketFromHigh(70) === "Warm");
check("bucket: 69 → Mild",  bucketFromHigh(69) === "Mild");
check("bucket: 55 → Mild",  bucketFromHigh(55) === "Mild");
check("bucket: 54 → Cool",  bucketFromHigh(54) === "Cool");
check("bucket: 40 → Cool",  bucketFromHigh(40) === "Cool");
check("bucket: 39 → Cold",  bucketFromHigh(39) === "Cold");
check("bucket: null → ''",  bucketFromHigh(null) === "");

// ── WMO weathercode → condition label ────────────────────────────────────────
check("code 0 → Clear",          conditionFromCode(0) === "Clear");
check("code 1 → Clear",          conditionFromCode(1) === "Clear");
check("code 2 → Partly cloudy",  conditionFromCode(2) === "Partly cloudy");
check("code 3 → Overcast",       conditionFromCode(3) === "Overcast");
check("code 45 → Foggy",         conditionFromCode(45) === "Foggy");
check("code 55 → Drizzly",       conditionFromCode(55) === "Drizzly");
check("code 61 → Rainy",         conditionFromCode(61) === "Rainy");
check("code 67 → Rainy",         conditionFromCode(67) === "Rainy");
check("code 71 → Snowy",         conditionFromCode(71) === "Snowy");
check("code 81 → Rainy (showers)", conditionFromCode(81) === "Rainy");
check("code 86 → Snowy (showers)", conditionFromCode(86) === "Snowy");
check("code 95 → Stormy",        conditionFromCode(95) === "Stormy");
check("code 99 → Stormy",        conditionFromCode(99) === "Stormy");
check("code null → ''",          conditionFromCode(null) === "");
check("unknown code → ''",       conditionFromCode(42) === "");

// ── Notable-condition gate (what earns a spot on a compact day chip) ────────
check("Rainy is notable",          isNotableCondition("Rainy"));
check("Snowy is notable",          isNotableCondition("Snowy"));
check("Stormy is notable",         isNotableCondition("Stormy"));
check("Drizzly is notable",        isNotableCondition("Drizzly"));
check("Foggy is notable",          isNotableCondition("Foggy"));
check("Clear is NOT notable",      !isNotableCondition("Clear"));
check("Partly cloudy NOT notable", !isNotableCondition("Partly cloudy"));
check("empty is NOT notable",      !isNotableCondition(""));

// ── fetchTripForecast: parse + cache + graceful degradation ─────────────────
// Distinct coords per scenario — the module-level Map caches by rounded
// coords, so reusing lat/lon across scenarios would cross-contaminate.
const realFetch = globalThis.fetch;
let fetchCalls = 0;

function stubFetch(impl) {
  fetchCalls = 0;
  globalThis.fetch = async (...args) => { fetchCalls++; return impl(...args); };
}

const SAMPLE = {
  daily: {
    time: ["2026-08-02", "2026-08-03", "2026-08-04"],
    temperature_2m_max: [88.4, 67.2, null],
    temperature_2m_min: [70.1, 55.9, null],
    weathercode: [61, 0, null],
    precipitation_probability_max: [72, null, null],
  },
};

// Happy path: fields parsed, rounded, bucketed, condition-mapped.
stubFetch(async (url) => {
  check("url: forecast endpoint",     url.startsWith("https://api.open-meteo.com/v1/forecast?"));
  check("url: requests weathercode",  url.includes("weathercode"));
  check("url: requests precip prob",  url.includes("precipitation_probability_max"));
  check("url: fahrenheit",            url.includes("temperature_unit=fahrenheit"));
  check("url: 16-day horizon",        url.includes(`forecast_days=${FORECAST_HORIZON_DAYS}`));
  return { ok: true, json: async () => SAMPLE };
});
const fc = await fetchTripForecast(10.11, 20.22, "Europe/Lisbon");
check("parse: returns a map",              fc != null);
check("parse: high rounded",               fc?.["2026-08-02"]?.high === 88);
check("parse: low rounded",                fc?.["2026-08-02"]?.low === 70);
check("parse: bucket Hot",                 fc?.["2026-08-02"]?.bucket === "Hot");
check("parse: condition Rainy",            fc?.["2026-08-02"]?.condition === "Rainy");
check("parse: precip 72",                  fc?.["2026-08-02"]?.precip === 72);
check("parse: day 2 bucket Mild",          fc?.["2026-08-03"]?.bucket === "Mild");
check("parse: day 2 condition Clear",      fc?.["2026-08-03"]?.condition === "Clear");
check("parse: day 2 precip null",          fc?.["2026-08-03"]?.precip === null);
check("parse: null temps → null high",     fc?.["2026-08-04"]?.high === null);
check("parse: null temps → empty bucket",  fc?.["2026-08-04"]?.bucket === "");
check("parse: null code → empty condition", fc?.["2026-08-04"]?.condition === "");

// In-memory cache: same coords again → no second network call (node has no
// localStorage, so this exercises the module-level Map layer specifically).
const before = fetchCalls;
const fc2 = await fetchTripForecast(10.11, 20.22, "Europe/Lisbon");
check("cache: second call served from memory", fetchCalls === before);
check("cache: same data returned",             fc2?.["2026-08-02"]?.high === 88);

// Graceful degradation: every failure shape → null, never a throw.
stubFetch(async () => { throw new Error("network down"); });
check("degrade: network error → null", (await fetchTripForecast(11.11, 21.22, "UTC")) === null);

stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
check("degrade: HTTP 500 → null", (await fetchTripForecast(12.11, 22.22, "UTC")) === null);

stubFetch(async () => ({ ok: true, json: async () => ({}) }));
check("degrade: empty body → null", (await fetchTripForecast(13.11, 23.22, "UTC")) === null);

stubFetch(async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }));
check("degrade: malformed JSON → null", (await fetchTripForecast(14.11, 24.22, "UTC")) === null);

check("degrade: non-numeric lat/lon → null (no fetch)", (await fetchTripForecast("Paris", null)) === null);

// ── geocodeDestination: parse + cache + graceful degradation ────────────────
stubFetch(async (url) => {
  check("geo url: geocoding endpoint", url.startsWith("https://geocoding-api.open-meteo.com/v1/search?name="));
  return {
    ok: true,
    json: async () => ({ results: [{ name: "Lisbon", country: "Portugal", latitude: 38.72, longitude: -9.14, timezone: "Europe/Lisbon" }] }),
  };
});
const geo = await geocodeDestination("Lisbon");
check("geo: resolves name",     geo?.name === "Lisbon");
check("geo: resolves lat/lon",  geo?.lat === 38.72 && geo?.lon === -9.14);
check("geo: resolves timezone", geo?.timezone === "Europe/Lisbon");

const geoBefore = fetchCalls;
const geoAgain = await geocodeDestination("  lisbon "); // trim + case-insensitive key
check("geo cache: repeat query served from memory", fetchCalls === geoBefore);
check("geo cache: same coords",                     geoAgain?.lat === 38.72);

stubFetch(async () => ({ ok: true, json: async () => ({ results: [] }) }));
check("geo degrade: no match → null", (await geocodeDestination("xyzzyplugh")) === null);

stubFetch(async () => { throw new Error("network down"); });
check("geo degrade: network error → null", (await geocodeDestination("Atlantis")) === null);
check("geo degrade: empty query → null",   (await geocodeDestination("   ")) === null);

globalThis.fetch = realFetch;

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nweather tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
