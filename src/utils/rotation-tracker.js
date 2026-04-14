// ── ROTATION TRACKER ─────────────────────────────────────────────────────────
// Tracks which items have been suggested and how often, enabling cold-item
// boosting and recently-suggested avoidance in the sampling pipeline.

const RECENT_ITEMS_KEY = "atelier-recently-suggested-items";
const SUGGESTION_COUNTS_KEY = "atelier-item-suggestion-counts";
const MAX_RECENT_GENERATIONS = 3;

export function loadRecentGenerations() {
  try {
    const raw = localStorage.getItem(RECENT_ITEMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getRecentlySuggestedItems() {
  const gens = loadRecentGenerations();
  return [...new Set(gens.flat())];
}

export function recordGeneration(itemIds) {
  const gens = loadRecentGenerations();
  gens.push(itemIds);
  while (gens.length > MAX_RECENT_GENERATIONS) gens.shift();
  try {
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(gens));
  } catch {}
  const counts = loadSuggestionCounts();
  for (const id of itemIds) {
    counts[id] = (counts[id] || 0) + 1;
  }
  try {
    localStorage.setItem(SUGGESTION_COUNTS_KEY, JSON.stringify(counts));
  } catch {}
}

export function loadSuggestionCounts() {
  try {
    const raw = localStorage.getItem(SUGGESTION_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function clearRotationData() {
  localStorage.removeItem(RECENT_ITEMS_KEY);
  localStorage.removeItem(SUGGESTION_COUNTS_KEY);
}
