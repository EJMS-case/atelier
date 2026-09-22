-- Photos and thumbs are served cacheable.
--
-- Owner, 2026-09-22, from the Plan a trip sheet: "Nothing is really loading
-- here :-/" — every tile blank. Every one of the 1,129 objects in
-- wardrobe-images (photos, thumbs, inspiration) carried
-- metadata.cacheControl = 'no-cache', because the app's raw REST uploads
-- never sent a Cache-Control header and that is the storage API's default.
-- storage-api serves that value as the response's Cache-Control, so the
-- browser re-downloaded the full 200–400 kB photo on every <img> mount. The
-- trip sheet re-renders on every tap and on every app-focus refetch; each
-- render re-fetched all ~28 tiles, and on a phone the loads never finished.
-- Her edge logs show the same photo requested 6–9× inside one minute.
--
-- Safe to cache for a year: the URL is the key and it changes with the bytes
-- (uploadImage stamps ?v=<now>; thumbUrl hashes the photo URL into ?v=).
-- lib/supabase.js sends the same header on every upload from now on
-- (PHOTO_CACHE_CONTROL); this backfills what was uploaded before.
--
-- Applied live 2026-09-22.
--
-- Break-glass rollback:
--   update storage.objects
--      set metadata = metadata || '{"cacheControl":"no-cache"}'::jsonb
--    where bucket_id = 'wardrobe-images';

update storage.objects
   set metadata = coalesce(metadata, '{}'::jsonb) || '{"cacheControl":"max-age=31536000"}'::jsonb
 where bucket_id = 'wardrobe-images'
   and coalesce(metadata->>'cacheControl', '') <> 'max-age=31536000';
