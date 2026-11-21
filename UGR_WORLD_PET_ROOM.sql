-- UGR WORLD / PET ROOM — additive migration
-- Run AFTER UGR_WORLD_INITIAL_MIGRATION.sql and UGR_WORLD_PET_FUNCTIONS.sql.
-- Room decor is stored as compact JSON. Animation stays client-side to conserve Realtime quota.

create table if not exists public.ugr_pet_rooms (
  pet_id uuid primary key references public.ugr_user_pets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  room_theme text not null default 'violet',
  floor_theme text not null default 'midnight',
  furniture jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint ugr_pet_rooms_furniture_array check (jsonb_typeof(furniture) = 'array')
);

create index if not exists ugr_pet_rooms_owner_idx
  on public.ugr_pet_rooms(user_id);

alter table public.ugr_pet_rooms enable row level security;

drop policy if exists ugr_pet_rooms_read_own on public.ugr_pet_rooms;
create policy ugr_pet_rooms_read_own
  on public.ugr_pet_rooms for select to authenticated
  using (user_id = auth.uid());

grant select on public.ugr_pet_rooms to authenticated;
revoke insert, update, delete on public.ugr_pet_rooms from anon, authenticated;

create or replace function public.ugr_save_pet_room(
  p_pet_id uuid,
  p_room_theme text,
  p_floor_theme text,
  p_furniture jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_key text;
  v_x numeric;
  v_y numeric;
  v_count integer;
  v_result public.ugr_pet_rooms%rowtype;
begin
  if v_user is null then raise exception 'Требуется авторизация'; end if;

  if not exists (
    select 1 from public.ugr_user_pets
    where id = p_pet_id and user_id = v_user
  ) then raise exception 'Питомец не найден'; end if;

  if p_room_theme is null or p_room_theme not in ('violet','neon','forest') then
    raise exception 'Неизвестная тема комнаты';
  end if;
  if p_floor_theme is null or p_floor_theme not in ('midnight','wood','star') then
    raise exception 'Неизвестный вариант пола';
  end if;
  if jsonb_typeof(p_furniture) <> 'array' then
    raise exception 'Некорректный список мебели';
  end if;

  select jsonb_array_length(p_furniture) into v_count;
  if v_count > 12 then raise exception 'В комнате можно разместить не более 12 предметов'; end if;

  for v_item in select value from jsonb_array_elements(p_furniture)
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Некорректный предмет мебели'; end if;
    v_key := v_item->>'item_key';
    if v_key is null or v_key not in (
      'bed','food_bowl','water_bowl','ball','plant','lamp',
      'window','rug','bookshelf','poster','cactus','moon_lamp'
    ) then raise exception 'Неизвестный предмет мебели'; end if;

    begin
      v_x := (v_item->>'x')::numeric;
      v_y := (v_item->>'y')::numeric;
    exception when others then
      raise exception 'Некорректное положение предмета';
    end;
    if v_x is null or v_y is null or v_x < 3 or v_x > 97 or v_y < 8 or v_y > 92 then
      raise exception 'Предмет находится за пределами комнаты';
    end if;
  end loop;

  insert into public.ugr_pet_rooms
    (pet_id,user_id,room_theme,floor_theme,furniture,updated_at)
  values
    (p_pet_id,v_user,p_room_theme,p_floor_theme,p_furniture,now())
  on conflict (pet_id) do update set
    room_theme=excluded.room_theme,
    floor_theme=excluded.floor_theme,
    furniture=excluded.furniture,
    updated_at=now()
  where public.ugr_pet_rooms.user_id = v_user
  returning * into v_result;

  if v_result.pet_id is null then raise exception 'Не удалось сохранить комнату'; end if;
  return to_jsonb(v_result);
end;
$$;

revoke all on function public.ugr_save_pet_room(uuid,text,text,jsonb) from public;
grant execute on function public.ugr_save_pet_room(uuid,text,text,jsonb) to authenticated;
