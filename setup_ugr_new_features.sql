-- UGR Messenger: additions for emoji avatars, curtain colors and daily developer greeting
-- Run once in Supabase Dashboard -> SQL Editor -> New query.
-- Existing accounts, chats and messages are not deleted or modified.

alter table public.profiles
  add column if not exists avatar_emoji text,
  add column if not exists curtain_color text not null default '#5a3b8d';

create table if not exists public.developer_welcome_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  welcome_date date not null,
  primary key (user_id, welcome_date)
);

alter table public.developer_welcome_daily enable row level security;

create or replace function public.claim_developer_welcome()
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inserted_count integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  insert into public.developer_welcome_daily(user_id, welcome_date)
  values (auth.uid(), (now() at time zone 'utc')::date)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.claim_developer_welcome() from public;
grant execute on function public.claim_developer_welcome() to authenticated;

-- Public profile card used by the web client when opening another user's profile.
-- It exposes only the fields displayed on a UGR profile page.
create or replace function public.get_public_profile_details(target_user_id uuid)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  avatar_emoji text,
  curtain_color text,
  profile_private boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.bio, p.avatar_url,
         p.avatar_emoji, p.curtain_color, p.profile_private
  from public.profiles p
  where p.id = target_user_id
  limit 1;
$$;

revoke all on function public.get_public_profile_details(uuid) from public;
grant execute on function public.get_public_profile_details(uuid) to authenticated;
