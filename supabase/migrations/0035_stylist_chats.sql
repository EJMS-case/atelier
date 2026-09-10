-- Stylist chats: one row per builder conversation, PATCHed on every turn.
--
-- Why (owner, 2026-09-10): "Review my recent chat with my stylist" could not
-- be answered — the chat lived in React state and nothing kept it. Now the
-- transcript is stored, and the lessons the app distils from it (her standing
-- preferences, written to her) ride along on the row as well as in
-- user_settings.chat_lessons, where every AI surface reads them.
--
-- `id` is text, not uuid: the client mints it (crypto.randomUUID when
-- available, a timestamp fallback otherwise) so the first turn can INSERT and
-- every later turn can UPSERT the same row without a round trip.
--
-- RLS mirrors 0030: owner-pinned, `authenticated` only. The anon key sees
-- nothing. The client's writes are fire-and-forget, so until this is applied
-- the chat simply isn't recorded — degraded, not broken.
--
-- APPLIED LIVE 2026-09-10.
--
-- ROLLBACK (break glass): drop table public.stylist_chats;

create table if not exists public.stylist_chats (
  id          text primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  surface     text not null default 'builder',
  occasions   text[] not null default '{}',
  weathers    text[] not null default '{}',
  item_ids    text[] not null default '{}',
  messages    jsonb not null default '[]'::jsonb,
  lessons     text[] not null default '{}'
);

alter table public.stylist_chats enable row level security;

drop policy if exists "owner only" on public.stylist_chats;
create policy "owner only" on public.stylist_chats
  for all to authenticated
  using ((select auth.uid()) = '4464b540-5d40-45da-8f21-40410fc8b42c'::uuid)
  with check ((select auth.uid()) = '4464b540-5d40-45da-8f21-40410fc8b42c'::uuid);

create index if not exists stylist_chats_updated_at_idx on public.stylist_chats (updated_at desc);
