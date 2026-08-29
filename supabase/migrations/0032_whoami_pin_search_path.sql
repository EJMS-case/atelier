-- The database linter flags public.whoami() for a role-mutable search_path.
-- It is SECURITY INVOKER so the exposure is small, but an unqualified name in a
-- function body can resolve differently depending on the caller's search_path.
-- Pin it empty and fully qualify the one call.
--
-- APPLIED LIVE 2026-08-29. Verified after: whoami() still returns the owner's
-- uid and the owner still reads all 515 wardrobe items.

create or replace function public.whoami()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$ select auth.uid() $$;

grant execute on function public.whoami() to anon, authenticated;
