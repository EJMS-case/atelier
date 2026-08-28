-- Every storage.objects policy today is scoped TO anon. Postgres role `anon`
-- does NOT match `authenticated`, so the moment the client starts sending a
-- user JWT its role flips and every Storage write 403s — photo upload, thumb
-- upload, duplicate-item image copy, image delete, orphan scan.
--
-- This MUST land before any login code ships. It only widens access, so it
-- cannot break anything currently working. The anon grants stay for now to
-- preserve the overlap window for cached clients; they come off in a later
-- migration once login is verified on every device.
--
-- APPLIED LIVE 2026-08-28.

create policy "wardrobe-images authenticated all"
  on storage.objects
  for all
  to authenticated
  using      (bucket_id = 'wardrobe-images')
  with check (bucket_id = 'wardrobe-images');
