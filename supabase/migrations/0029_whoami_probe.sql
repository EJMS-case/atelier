-- Read-only probe so the owner can prove, from her actual phone, that the JWT
-- is reaching Postgres — before any policy depends on it. Returns null for an
-- anonymous request, her user id for an authenticated one.
--
-- Surfaced in Settings → Account ("Server sees me as"). There are no browser
-- devtools on a phone, so this is the only way to diagnose a broken session in
-- the field, and it is the gate that must show a tick on every device before
-- the table policies are tightened.
--
-- APPLIED LIVE 2026-08-28.

create or replace function public.whoami()
returns uuid
language sql
stable
security invoker
as $$ select auth.uid() $$;

grant execute on function public.whoami() to anon, authenticated;
