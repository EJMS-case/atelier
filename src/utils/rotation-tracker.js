// ── ROTATION TRACKER ─────────────────────────────────────────────────────────
// Tracks which items have been suggested and how often, enabling cold-item
// boosting and recently-suggested avoidance in the sampling pipeline.

import { RECENT_ITEMS_KEY, SUGGESTION_COUNTS_KEY } from "./storage.js";

const MAX_RECENT_GENERATIONS = 3;

/**
 * Load the rolling list of recently suggested item IDs (from the last 3 generations).
 * Stored as an array of arrays: [[gen1Ids], [gen2Ids], [gen3Ids]]
 * Flattened for the prompt.
 * @returns {string[][]} - array of generation arrays
 */
export function loadRecentGenerations() {
  try {
    const raw = localStorage.getItem(RECENT_ITEMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Get a flat list of all recently suggested item IDs (from last 3 generations).
 * @returns {string[]}
 */
export function getRecentlySuggestedItems() {
  const gens = loadRecentGenerations();
  return [...new Set(gens.flat())];
}

/**
 * Record a new generation's suggested item IDs.
 * Pushes the new IDs onto the rolling list and trims to MAX_RECENT_GENERATIONS.
 * @param {string[]} itemIds - all item IDs from the latest generation
 */
export function recordGeneration(itemIds) {
  const gens = loadRecentGenerations();
  gens.push(itemIds);
  // Keep only the last 3 generations
  while (gens.length > MAX_RECENT_GENERATIONS) gens.shift();
  try {
    localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(gens));
  } catch {
    // localStorage full — silently fail
  }

  // Also update the per-item suggestion counts
  const counts = loadSuggestionCounts();
  for (const id of itemIds) {
    counts[id] = (counts[id] || 0) + 1;
  }
  try {
    localStorage.setItem(SUGGESTION_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // localStorage full — silently fail
  }
}

/**
 * Load the per-item suggestion count map.
 * @returns {Object.<string, number>} - { itemId: count }
 */
export function loadSuggestionCounts() {
  try {
    const raw = localStorage.getItem(SUGGESTION_COUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Clear all rotation tracking data (for debugging / reset).
 */
export function clearRotationData() {
  localStorage.removeItem(RECENT_ITEMS_KEY);
  localStorage.removeItem(SUGGESTION_COUNTS_KEY);
}
