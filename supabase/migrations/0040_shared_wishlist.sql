-- 0040 · A wish list Mike can open (owner, 2026-11-22: "I'd like to share the
-- wishlist with Mike").
--
-- BREAK-GLASS ROLLBACK (stops all sharing at once; nothing else depends on it):
--   drop function if exists public.shared_wishlist(text);
--
-- Every table stays pinned to the owner (0026–0031, 0038). Nothing here adds a
-- policy or a table grant. Instead, ONE security-definer function answers
-- exactly one question: "the open wishes, for whoever holds the current share
-- token". The token lives in user_settings (key `wishlist_share`, written by
-- the owner's signed-in app as {"token": "<32+ random chars>", "at": "..."});
-- turning sharing off deletes or replaces it, which kills every old link.
--
-- What it returns is the public face of a wish only: name, brand, price,
-- photo, link, note (sizes live there, which is the point for a gift) and
-- the must-have star. Never Atelier's read, the source, ids or anything else
-- in the row. Bought wishes are left out.

create or replace function public.shared_wishlist(share_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with share as (
    select (value::jsonb ->> 'token') as token
    from user_settings
    where key = 'wishlist_share'
  ),
  ok as (
    select 1
    from share
    where length(coalesce(share_token, '')) >= 24
      and share.token = share_token
  ),
  wishes as (
    select e
    from user_settings s,
         jsonb_array_elements(case when jsonb_typeof(s.value::jsonb) = 'array' then s.value::jsonb else '[]'::jsonb end) e
    where s.key = 'shopping_list'
      and coalesce(e ->> 'status', 'open') = 'open'
  )
  select case when exists (select 1 from ok) then
    jsonb_build_object('wishes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'text',     e ->> 'text',
        'brand',    e ->> 'brand',
        'price',    e -> 'price',
        'image',    e ->> 'image',
        'url',      e ->> 'url',
        'note',     e ->> 'note',
        'mustHave', coalesce((e ->> 'mustHave')::boolean, false)
      ) order by e ->> 'addedAt' desc)
      from wishes
    ), '[]'::jsonb))
  else null end;
$$;

revoke all on function public.shared_wishlist(text) from public;
grant execute on function public.shared_wishlist(text) to anon, authenticated;
