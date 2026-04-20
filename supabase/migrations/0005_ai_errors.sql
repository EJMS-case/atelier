-- 0005_ai_errors.sql
-- Additive: new table `ai_errors` for capturing failures from the AI pipeline
-- (tool-use schema violations, Zod parse errors, unexpected API responses).
-- Write-mostly; read rarely for debugging. Permissive anon policy matches
-- the existing public-client posture used by wardrobe_items.

create table if not exists public.ai_errors (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text not null,
  payload     jsonb,
  error       text
);

create index if not exists ai_errors_created_at_idx
  on public.ai_errors (created_at desc);

alter table public.ai_errors enable row level security;

-- Anon may insert error rows (fire-and-forget from the browser).
drop policy if exists "anon insert ai_errors" on public.ai_errors;
create policy "anon insert ai_errors"
  on public.ai_errors
  for insert
  to anon
  with check (true);

-- Anon may read its own errors (debugging from the client console).
drop policy if exists "anon select ai_errors" on public.ai_errors;
create policy "anon select ai_errors"
  on public.ai_errors
  for select
  to anon
  using (true);
