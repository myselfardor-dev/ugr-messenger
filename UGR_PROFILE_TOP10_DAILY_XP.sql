-- UGR: animated avatar appearance, real TOP-10 and 5-day daily XP cycle
-- Run once in Supabase Dashboard -> SQL Editor.
-- Additive migration: existing profile, XP and gift data are preserved.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_animation text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS avatar_frame text NOT NULL DEFAULT 'none';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_animation_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_animation_check
  CHECK (avatar_animation IN ('none','pulse','orbit','glitch'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_avatar_frame_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_frame_check
  CHECK (avatar_frame IN ('none','neon','ice','gold','crimson'));

-- A caller can only update their own profile row (existing profile RLS remains in force).
-- Public appearance RPC exposes only the two presentation settings.
CREATE OR REPLACE FUNCTION public.get_ugr_avatar_appearance(target_user_ids uuid[])
RETURNS TABLE(user_id uuid, avatar_animation text, avatar_frame text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.avatar_animation, p.avatar_frame
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(target_user_ids, ARRAY[]::uuid[]))
    AND auth.uid() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.get_ugr_avatar_appearance(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ugr_avatar_appearance(uuid[]) TO authenticated;

-- Real TOP-10 based on the existing user_xp balance table.
CREATE OR REPLACE FUNCTION public.get_ugr_top10_profiles()
RETURNS TABLE(
  id uuid, position bigint, username text, xp integer,
  avatar_url text, avatar_emoji text, avatar_animation text, avatar_frame text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id,
         row_number() OVER (ORDER BY ux.xp DESC, p.username ASC) AS position,
         p.username, ux.xp, p.avatar_url, p.avatar_emoji,
         p.avatar_animation, p.avatar_frame
  FROM public.user_xp ux
  JOIN public.profiles p ON p.id = ux.user_id
  WHERE auth.uid() IS NOT NULL
  ORDER BY ux.xp DESC, p.username ASC
  LIMIT 10;
$$;
REVOKE ALL ON FUNCTION public.get_ugr_top10_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ugr_top10_profiles() TO authenticated;

-- One server-side claim per UTC calendar day and account.
-- Missing a day resets the 5-day cycle to day 1.
CREATE TABLE IF NOT EXISTS public.ugr_daily_xp_cycle (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_claim_date date,
  cycle_day integer NOT NULL DEFAULT 0 CHECK (cycle_day BETWEEN 0 AND 5)
);
ALTER TABLE public.ugr_daily_xp_cycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ugr_daily_xp_cycle FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_ugr_daily_xp_v2()
RETURNS TABLE(awarded integer, total_xp integer, cycle_day integer, already_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_last date;
  v_day integer;
  v_award integer;
  v_total integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.ugr_daily_xp_cycle(user_id, last_claim_date, cycle_day)
  VALUES (v_user, NULL, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT c.last_claim_date, c.cycle_day
    INTO v_last, v_day
  FROM public.ugr_daily_xp_cycle c
  WHERE c.user_id = v_user
  FOR UPDATE;

  IF v_last = v_today THEN
    SELECT COALESCE(x.xp, 0) INTO v_total
    FROM public.user_xp x WHERE x.user_id = v_user;
    RETURN QUERY SELECT 0, COALESCE(v_total, 0), COALESCE(v_day, 0), true;
    RETURN;
  END IF;

  IF v_last = v_today - 1 THEN
    v_day := CASE WHEN v_day >= 5 THEN 1 ELSE v_day + 1 END;
  ELSE
    v_day := 1;
  END IF;

  v_award := CASE v_day
    WHEN 1 THEN 10 WHEN 2 THEN 15 WHEN 3 THEN 30
    WHEN 4 THEN 35 WHEN 5 THEN 50
  END;

  UPDATE public.ugr_daily_xp_cycle
  SET last_claim_date = v_today, cycle_day = v_day
  WHERE user_id = v_user;

  INSERT INTO public.user_xp(user_id, xp)
  VALUES (v_user, v_award)
  ON CONFLICT (user_id)
  DO UPDATE SET xp = public.user_xp.xp + EXCLUDED.xp
  RETURNING xp INTO v_total;

  RETURN QUERY SELECT v_award, v_total, v_day, false;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_ugr_daily_xp_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ugr_daily_xp_v2() TO authenticated;
