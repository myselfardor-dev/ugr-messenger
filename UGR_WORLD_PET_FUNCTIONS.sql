-- UGR WORLD / UGR PET — server-authoritative pet operations
-- Additive migration. Run AFTER UGR_WORLD_INITIAL_MIGRATION.sql.
-- Clients must call these RPCs; do not grant direct table writes.

alter table public.ugr_user_pets
  add column if not exists last_interaction_at timestamptz;

create or replace function public.ugr_adopt_first_pet(
  p_pet_key text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pet public.ugr_user_pets%rowtype;
  v_reward integer := 25;
begin
  if v_user is null then raise exception 'Требуется авторизация'; end if;
  if p_nickname is null or char_length(trim(p_nickname)) not between 1 and 24 then
    raise exception 'Имя питомца должно быть от 1 до 24 символов';
  end if;
  if not exists (
    select 1 from public.ugr_pet_catalog
    where pet_key = p_pet_key and active
  ) then raise exception 'Такого питомца нет в каталоге'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if exists (select 1 from public.ugr_user_pets where user_id = v_user) then
    raise exception 'Первый питомец уже получен. Новых питомцев можно будет приобрести в UGR SHOP';
  end if;

  insert into public.ugr_user_pets
    (user_id, pet_key, nickname, hunger, thirst, energy, mood, is_active)
  select v_user, c.pet_key, trim(p_nickname),
    coalesce((c.base_stats->>'hunger')::smallint,80),
    coalesce((c.base_stats->>'thirst')::smallint,80),
    coalesce((c.base_stats->>'energy')::smallint,80),
    coalesce((c.base_stats->>'mood')::smallint,80),
    true
  from public.ugr_pet_catalog c where c.pet_key = p_pet_key
  returning * into v_pet;

  insert into public.ugr_coin_wallets(user_id,balance)
  values(v_user,v_reward)
  on conflict(user_id) do update
    set balance = public.ugr_coin_wallets.balance + v_reward,
        updated_at = now();

  insert into public.ugr_coin_transactions(user_id,amount,reason,reference_id)
  values(v_user,v_reward,'first_pet',v_pet.id::text)
  on conflict(user_id,reason,reference_id) do nothing;

  insert into public.ugr_user_achievements(user_id,achievement_key,progress,unlocked_at)
  values(v_user,'first_pet',1,now())
  on conflict(user_id,achievement_key) do update
    set progress = greatest(public.ugr_user_achievements.progress,1),
        unlocked_at = coalesce(public.ugr_user_achievements.unlocked_at,now());

  return jsonb_build_object('pet',to_jsonb(v_pet),'coins_awarded',v_reward);
end;
$$;

create or replace function public.ugr_set_active_pet(p_pet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_pet public.ugr_user_pets%rowtype;
begin
  if v_user is null then raise exception 'Требуется авторизация'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  if not exists(select 1 from public.ugr_user_pets where id=p_pet_id and user_id=v_user) then
    raise exception 'Питомец не найден';
  end if;
  update public.ugr_user_pets set is_active=false,updated_at=now()
    where user_id=v_user and is_active;
  update public.ugr_user_pets set is_active=true,updated_at=now()
    where id=p_pet_id and user_id=v_user returning * into v_pet;
  return to_jsonb(v_pet);
end;
$$;

create or replace function public.ugr_interact_with_pet(
  p_pet_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pet public.ugr_user_pets%rowtype;
  v_xp integer := 5;
  v_interactions integer;
  v_reward integer := 0;
begin
  if v_user is null then raise exception 'Требуется авторизация'; end if;
  if p_action not in ('feed','water','play','pet','sleep') then
    raise exception 'Неизвестное действие';
  end if;

  select * into v_pet from public.ugr_user_pets
    where id=p_pet_id and user_id=v_user for update;
  if not found then raise exception 'Питомец не найден'; end if;
  if v_pet.last_interaction_at is not null
     and v_pet.last_interaction_at > now() - interval '12 seconds' then
    raise exception 'Питомцу нужен небольшой перерыв. Попробуй через несколько секунд';
  end if;

  update public.ugr_user_pets set
    hunger = case when p_action='feed' then least(100,hunger+25) else hunger end,
    thirst = case when p_action='water' then least(100,thirst+25) else thirst end,
    energy = case
      when p_action='sleep' then least(100,energy+30)
      when p_action='play' then greatest(0,energy-15)
      else energy end,
    mood = case
      when p_action='play' then least(100,mood+18)
      when p_action='pet' then least(100,mood+12)
      when p_action='feed' or p_action='water' then least(100,mood+4)
      when p_action='sleep' then least(100,mood+5)
      else mood end,
    xp = xp + v_xp,
    level = least(100, ((xp + v_xp) / 100)::integer + 1),
    last_interaction_at = now(),
    updated_at = now()
  where id=p_pet_id returning * into v_pet;

  insert into public.ugr_user_achievements(user_id,achievement_key,progress)
  values(v_user,'pet_interactions_100',1)
  on conflict(user_id,achievement_key) do update
    set progress=least(100,public.ugr_user_achievements.progress+1);

  select progress into v_interactions from public.ugr_user_achievements
    where user_id=v_user and achievement_key='pet_interactions_100';

  if v_interactions >= 100 and exists(
    select 1 from public.ugr_user_achievements
    where user_id=v_user and achievement_key='pet_interactions_100' and unlocked_at is null
  ) then
    update public.ugr_user_achievements
      set unlocked_at=now()
      where user_id=v_user and achievement_key='pet_interactions_100';
    v_reward := 100;
    insert into public.ugr_coin_wallets(user_id,balance)
      values(v_user,v_reward)
      on conflict(user_id) do update
        set balance=public.ugr_coin_wallets.balance+v_reward,updated_at=now();
    insert into public.ugr_coin_transactions(user_id,amount,reason,reference_id)
      values(v_user,v_reward,'achievement_pet_interactions_100',v_user::text);
  end if;

  return jsonb_build_object(
    'pet',to_jsonb(v_pet),
    'xp_awarded',v_xp,
    'achievement_progress',v_interactions,
    'coins_awarded',v_reward
  );
end;
$$;

revoke all on function public.ugr_adopt_first_pet(text,text) from public;
revoke all on function public.ugr_set_active_pet(uuid) from public;
revoke all on function public.ugr_interact_with_pet(uuid,text) from public;
grant execute on function public.ugr_adopt_first_pet(text,text) to authenticated;
grant execute on function public.ugr_set_active_pet(uuid) to authenticated;
grant execute on function public.ugr_interact_with_pet(uuid,text) to authenticated;
