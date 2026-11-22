-- UGR WORLD: постепенные потребности питомца и сон.
-- Выполнить в Supabase SQL Editor после предыдущих UGR WORLD migrations.

ALTER TABLE public.ugr_user_pets
  ADD COLUMN IF NOT EXISTS cleanliness smallint NOT NULL DEFAULT 85,
  ADD COLUMN IF NOT EXISTS last_needs_update_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sleep_started_at timestamptz;

-- Сервер рассчитывает изменения по реальному времени, даже если пользователь
-- не открывал приложение несколько дней. Максимальный интервал сна — 8 часов.
CREATE OR REPLACE FUNCTION public.ugr_update_pet_needs(p_pet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_pet public.ugr_user_pets%rowtype;
  v_minutes numeric;
  v_sleep_minutes numeric;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  SELECT * INTO v_pet FROM public.ugr_user_pets
   WHERE id = p_pet_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Питомец не найден'; END IF;

  v_minutes := GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(v_pet.last_needs_update_at, now()))) / 60.0);
  v_sleep_minutes := CASE WHEN v_pet.sleep_started_at IS NULL THEN 0
    ELSE LEAST(480, GREATEST(0, EXTRACT(EPOCH FROM (now()-v_pet.sleep_started_at))/60.0)) END;

  UPDATE public.ugr_user_pets SET
    hunger = GREATEST(0, LEAST(100, COALESCE(hunger,80) - FLOOR(v_minutes/30.0)::int)),
    thirst = GREATEST(0, LEAST(100, COALESCE(thirst,80) - FLOOR(v_minutes/22.0)::int)),
    energy = CASE WHEN sleep_started_at IS NOT NULL
      THEN LEAST(100, COALESCE(energy,80) + FLOOR(LEAST(v_minutes, GREATEST(0,480-v_sleep_minutes))/8.0)::int)
      ELSE GREATEST(0, COALESCE(energy,80) - FLOOR(v_minutes/45.0)::int) END,
    mood = GREATEST(0, LEAST(100, COALESCE(mood,80) - FLOOR(v_minutes/60.0)::int)),
    cleanliness = GREATEST(0, LEAST(100, COALESCE(cleanliness,85) - FLOOR(v_minutes/90.0)::int)),
    sleep_started_at = CASE WHEN sleep_started_at IS NOT NULL AND v_sleep_minutes >= 480 THEN NULL ELSE sleep_started_at END,
    last_needs_update_at = now(),
    updated_at = now()
  WHERE id = p_pet_id RETURNING * INTO v_pet;
  RETURN to_jsonb(v_pet);
END;
$$;

REVOKE ALL ON FUNCTION public.ugr_update_pet_needs(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.ugr_update_pet_needs(uuid) TO authenticated;

-- Новая версия взаимодействия: сначала применяет накопившееся изменение
-- потребностей, затем действие пользователя.
CREATE OR REPLACE FUNCTION public.ugr_interact_with_pet(p_pet_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_pet public.ugr_user_pets%rowtype;
  v_xp integer := 5;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF p_action NOT IN ('feed','water','play','pet','sleep') THEN RAISE EXCEPTION 'Неизвестное действие'; END IF;
  PERFORM public.ugr_update_pet_needs(p_pet_id);
  SELECT * INTO v_pet FROM public.ugr_user_pets WHERE id=p_pet_id AND user_id=v_user FOR UPDATE;
  IF v_pet.last_interaction_at IS NOT NULL AND v_pet.last_interaction_at > now()-interval '5 seconds' THEN
    RAISE EXCEPTION 'Питомцу нужен небольшой перерыв. Попробуй через несколько секунд';
  END IF;

  UPDATE public.ugr_user_pets SET
    hunger = CASE WHEN p_action='feed' THEN LEAST(100,hunger+35) ELSE hunger END,
    thirst = CASE WHEN p_action='water' THEN LEAST(100,thirst+40) ELSE thirst END,
    energy = CASE WHEN p_action='play' THEN GREATEST(0,energy-15)
                  WHEN p_action='sleep' THEN LEAST(100,energy+15) ELSE energy END,
    mood = CASE WHEN p_action='play' THEN LEAST(100,mood+18)
                WHEN p_action='pet' THEN LEAST(100,mood+12)
                WHEN p_action IN ('feed','water','sleep') THEN LEAST(100,mood+5) ELSE mood END,
    cleanliness = CASE WHEN p_action='play' THEN GREATEST(0,cleanliness-3) ELSE cleanliness END,
    sleep_started_at = CASE WHEN p_action='sleep' THEN COALESCE(sleep_started_at,now())
                            WHEN p_action IN ('play','feed','water','pet') THEN NULL ELSE sleep_started_at END,
    xp = xp + v_xp,
    level = LEAST(100, ((xp + v_xp) / 100)::integer + 1),
    last_interaction_at = now(), last_needs_update_at=now(), updated_at=now()
  WHERE id=p_pet_id RETURNING * INTO v_pet;

  INSERT INTO public.ugr_user_achievements(user_id,achievement_key,progress)
  VALUES(v_user,'pet_interactions_100',1)
  ON CONFLICT(user_id,achievement_key) DO UPDATE
    SET progress=LEAST(100,public.ugr_user_achievements.progress+1);

  RETURN jsonb_build_object('pet',to_jsonb(v_pet),'xp_awarded',v_xp);
END;
$$;

REVOKE ALL ON FUNCTION public.ugr_interact_with_pet(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.ugr_interact_with_pet(uuid,text) TO authenticated;
