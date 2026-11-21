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

-- UGR live chat enhancements: text/voice messages, reactions and presence-support fields.
-- Safe additive migration; existing messages and profiles are preserved.
alter table public.messages
  add column if not exists message_type text not null default 'text',
  add column if not exists media_url text,
  add column if not exists reactions jsonb not null default '{}'::jsonb;

-- Voice files bucket (public read URLs; uploads remain authenticated and user-folder scoped).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ugr-voice','ugr-voice',true,15728640,array['audio/webm','audio/ogg','audio/mp4','audio/m4a','audio/mpeg','audio/wav'])
on conflict (id) do update set public=true, file_size_limit=15728640;

drop policy if exists "UGR voice upload own folder" on storage.objects;
create policy "UGR voice upload own folder" on storage.objects
for insert to authenticated
with check (bucket_id='ugr-voice' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "UGR voice delete own folder" on storage.objects;
create policy "UGR voice delete own folder" on storage.objects
for delete to authenticated
using (bucket_id='ugr-voice' and (storage.foldername(name))[1]=auth.uid()::text);

-- Ensure messages updates/inserts are available to authenticated chat participants,
-- subject to the existing messages RLS policies in the project.
-- Realtime publication membership is intentionally left as-is; existing realtime
-- subscription to messages should be enabled for the project.
