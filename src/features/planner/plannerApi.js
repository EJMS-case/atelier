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
export const updateTrip = sb.updateTrip.bind(sb);
export const deleteTrip = sb.deleteTrip.bind(sb);
export const fetchActiveTrip = sb.fetchActiveTrip.bind(sb);
export const fetchTripItems = sb.fetchTripItems.bind(sb);
export const replaceTripItems = sb.replaceTripItems.bind(sb);
export const upsertTripItems = sb.upsertTripItems.bind(sb);
export const deleteTripItems = sb.deleteTripItems.bind(sb);
export const updateTripItemOutfits = sb.updateTripItemOutfits.bind(sb);
export const setTripItemStatus = sb.setTripItemStatus.bind(sb);
