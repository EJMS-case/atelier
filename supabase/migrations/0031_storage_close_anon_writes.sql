-- Removes anonymous upload, update, delete and directory-listing on the photo
-- bucket. The `authenticated` grant from 0028 replaces all of it for the app.
--
-- Image DISPLAY is unaffected. The bucket stays public, and reads via
-- /storage/v1/object/public/... are served on the bucket's public flag rather
-- than a SELECT policy on storage.objects. What goes away is the ability of an
-- anonymous caller to LIST the bucket or MUTATE it — including deleting all
-- 1,039 images, which "Allow anon all" permitted.
--
-- After this, reading an image requires knowing its exact key. Keys are
-- item-<epoch_ms>-<10-11 base36 chars>, ~51-57 bits of entropy, and no longer
-- enumerable now that listing is closed.
--
-- APPLIED LIVE 2026-08-29.
--
-- ROLLBACK (break glass — restores the previous grants exactly):
--   create policy "Allow anon all" on storage.objects for all to anon
--     using (bucket_id = 'wardrobe-images')
--     with check (bucket_id = 'wardrobe-images');
--   create policy "wardrobe-images 13rjsfd_0" on storage.objects for select
--     to anon using (bucket_id = 'wardrobe-images');
--   create policy "wardrobe-images 13rjsfd_1" on storage.objects for insert
--     to anon with check (bucket_id = 'wardrobe-images');
--   create policy "wardrobe-images 13rjsfd_2" on storage.objects for update
--     to anon using (bucket_id = 'wardrobe-images');

drop policy if exists "Allow anon all"            on storage.objects;
drop policy if exists "wardrobe-images 13rjsfd_0" on storage.objects;
drop policy if exists "wardrobe-images 13rjsfd_1" on storage.objects;
drop policy if exists "wardrobe-images 13rjsfd_2" on storage.objects;
