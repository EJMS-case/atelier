// ── WEATHER ──────────────────────────────────────────────────────────────────
// Open-Meteo forecast client. Free, keyless, CORS-friendly.
// Maps today's forecast high to one of Atelier's five weather buckets so the
// existing prompt/filter code keeps working unchanged.

const GEOCODE_URL  = "https://api.open-meteo.com/v1/forecast";

/**
 * Fetch today's forecast for a lat/lon and return the matching weather bucket
 * label used by the existing Style Me panel.
 *
 * @returns {Promise<{ label: string, highF: number, condition: string }>}
 */
export async function fetchTodayWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude:  String(lat),
    longitude: String(lon),
    daily: "temperature_2m_max,precipitation_probability_max,weather_code",
    temperature_unit: "fahrenheit",
    timezone: "auto",
    forecast_days: "1",
  });
  const res = await fetch(`${GEOCODE_URL}?${params}`);
  if (!res.ok) throw new Error(`Weather fetch failed ${res.status}`);
  const body = await res.json();
  const high  = body.daily?.temperature_2m_max?.[0];
  const precip = body.daily?.precipitation_probability_max?.[0] ?? 0;
  const code  = body.daily?.weather_code?.[0];
  if (typeof high !== "number") throw new Error("No temperature in forecast");

  const rainy = precip >= 60 || (code >= 51 && code <= 82); // WMO codes for drizzle/rain/showers
  return { label: rainy ? "Rainy" : bucketForHigh(high), highF: high, condition: rainy ? "rainy" : "dry" };
}

/**
 * Map a Fahrenheit high to an Atelier weather bucket label, matching the
 * values used by the Style Me chip row.
 */
export function bucketForHigh(highF) {
  if (highF >= 85) return "Hot (85°F+)";
  if (highF >= 70) return "Warm (70-84°F)";
  if (highF >= 55) return "Mild (55-69°F)";
  if (highF >= 40) return "Cool (40-54°F)";
  return "Cold (below 40°F)";
}

/**
 * Browser geolocation wrapped in a promise with a timeout.
 */
export function getGeolocation({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Geolocation not available"));
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Geolocation timeout"));
    }, timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/**
 * One-call helper — geolocate + fetch + bucket. Throws on any failure.
 */
export async function getLocalWeatherLabel() {
  const { lat, lon } = await getGeolocation();
  const { label } = await fetchTodayWeather(lat, lon);
  return label;
}
