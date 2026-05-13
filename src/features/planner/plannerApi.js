// ── F3 — PLANNED OUTFITS API ─────────────────────────────────────────────────
// Thin re-exports over the centralized Supabase client. Implementation lives
// in `sb.*` so credentials and request shapes live in exactly one place.

import { sb } from "../../lib/supabase.js";

export const fetchPlansBetween = sb.fetchPlansBetween.bind(sb);
export const fetchAllPlans = sb.fetchAllPlans.bind(sb);
export const savePlan = sb.savePlan.bind(sb);
export const deletePlan = sb.deletePlan.bind(sb);
export const saveTrip = sb.saveTrip.bind(sb);
export const fetchTripsBetween = sb.fetchTripsBetween.bind(sb);
export const fetchAllTrips = sb.fetchAllTrips.bind(sb);
export const updateTrip = sb.updateTrip.bind(sb);
export const deleteTrip = sb.deleteTrip.bind(sb);
