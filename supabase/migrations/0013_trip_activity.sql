-- activity column on trips: persists the trip-level Activity selection
-- (Sightseeing / Theme Park / Beach / Resort / Active / City Walking) so
-- TripDetailView's per-day AI generation can honor it and so reopening
-- a saved trip restores the activity selector instead of defaulting back
-- to "Sightseeing."
--
-- Additive-only. Safe to re-run.

alter table trips add column if not exists activity text;
