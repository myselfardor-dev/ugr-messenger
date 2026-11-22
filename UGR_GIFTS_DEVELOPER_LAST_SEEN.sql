-- UGR Gifts + закреплённый чат разработчика + last_seen
-- Выполнить один раз в Supabase SQL Editor.
-- Использует существующую таблицу public.user_xp и существующий RPC
-- public.create_or_get_direct_conversation(uuid). UGR Coin не затрагивается.

-- 1. Последняя активность профилей
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON public.profiles (last_seen_at DESC);

-- Возвращает last_seen только для авторизованных пользователей.
CREATE OR REPLACE FUNCTION public.get_profile_last_seen(target_user_ids uuid[])
RETURNS TABLE(user_id uuid, last_seen_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.last_seen_at
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(target_user_ids, ARRAY[]::uuid[]))
    AND auth.uid() IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_profile_last_seen(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_profile_last_seen(uuid[]) TO authenticated;

-- Публичная карточка только одного фиксированного аккаунта разработчика.
-- Нужна, чтобы его настоящее имя и аватар отображались в закреплённом чате,
-- даже если обычная выдача профилей скрывает закрытые профили.
CREATE OR REPLACE FUNCTION public.get_developer_profile_card()
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, avatar_emoji text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.avatar_emoji
  FROM public.profiles p
  WHERE p.id = '3bc957da-10a5-4587-aa76-05f4d1d67bb2'::uuid
    AND auth.uid() IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_developer_profile_card() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_developer_profile_card() TO authenticated;

-- 2. Каталог подарков
CREATE TABLE IF NOT EXISTS public.ugr_gift_catalog (
  gift_key text PRIMARY KEY,
  title text NOT NULL,
  emoji text NOT NULL DEFAULT '🎁',
  description text NOT NULL DEFAULT '',
  price_xp integer NOT NULL CHECK (price_xp > 0),
  rarity text NOT NULL DEFAULT 'Обычный',
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ugr_gift_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read active UGR gifts" ON public.ugr_gift_catalog;
CREATE POLICY "Authenticated users can read active UGR gifts"
  ON public.ugr_gift_catalog FOR SELECT TO authenticated
  USING (active = true);
GRANT SELECT ON public.ugr_gift_catalog TO authenticated;

INSERT INTO public.ugr_gift_catalog
  (gift_key, title, emoji, description, price_xp, rarity, sort_order, active)
VALUES
  ('rose', 'Роза', '🌹', 'Небольшой знак внимания', 10, 'Обычный', 10, true),
  ('coffee', 'Кофе', '☕', 'Немного тепла в сообщениях', 20, 'Обычный', 20, true),
  ('star', 'Звезда', '⭐', 'Пусть тебя замечают', 35, 'Обычный', 30, true),
  ('heart', 'Сердце', '💜', 'Тёплый подарок от души', 50, 'Редкий', 40, true),
  ('rocket', 'Ракета', '🚀', 'Для больших идей и свершений', 100, 'Редкий', 50, true),
  ('crown', 'Корона', '👑', 'Подарок с особым статусом', 175, 'Эпический', 60, true),
  ('diamond', 'Алмаз', '💎', 'Редкая драгоценность UGR', 300, 'Легендарный', 70, true),
  ('golden_duck', 'Золотая утка', '🐥', 'Особый символ UGR', 500, 'Коллекционный', 80, true)
ON CONFLICT (gift_key) DO UPDATE SET
  title = EXCLUDED.title,
  emoji = EXCLUDED.emoji,
  description = EXCLUDED.description,
  price_xp = EXCLUDED.price_xp,
  rarity = EXCLUDED.rarity,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active;

-- 3. История отправленных подарков и коллекции получателей
CREATE TABLE IF NOT EXISTS public.ugr_user_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gift_key text NOT NULL REFERENCES public.ugr_gift_catalog(gift_key),
  xp_spent integer NOT NULL CHECK (xp_spent > 0),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ugr_user_gifts_recipient_created_idx
  ON public.ugr_user_gifts (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ugr_user_gifts_sender_created_idx
  ON public.ugr_user_gifts (sender_id, created_at DESC);

ALTER TABLE public.ugr_user_gifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can view gift collections and history" ON public.ugr_user_gifts;
CREATE POLICY "Authenticated users can view gift collections and history"
  ON public.ugr_user_gifts FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.ugr_user_gifts TO authenticated;

-- Запись и списание XP доступны только через эту атомарную функцию.
CREATE OR REPLACE FUNCTION public.send_ugr_gift(
  p_gift_key text,
  p_recipient_id uuid,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sender uuid := auth.uid();
  v_gift public.ugr_gift_catalog%ROWTYPE;
  v_balance integer;
  v_gift_id uuid;
  v_message text := NULLIF(left(trim(COALESCE(p_message, '')), 180), '');
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_sender THEN
    RAISE EXCEPTION 'Нельзя отправить подарок самому себе';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_recipient_id) THEN
    RAISE EXCEPTION 'Получатель не найден';
  END IF;

  SELECT * INTO v_gift
  FROM public.ugr_gift_catalog
  WHERE gift_key = p_gift_key AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Этот подарок сейчас недоступен';
  END IF;

  -- Блокируем XP-строку, чтобы параллельные покупки не могли потратить XP дважды.
  SELECT ux.xp INTO v_balance
  FROM public.user_xp ux
  WHERE ux.user_id = v_sender
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'У тебя пока нет XP. Забери ежедневную награду';
  END IF;
  IF v_balance < v_gift.price_xp THEN
    RAISE EXCEPTION 'Недостаточно XP. Нужно %, у тебя %', v_gift.price_xp, v_balance;
  END IF;

  UPDATE public.user_xp
  SET xp = xp - v_gift.price_xp
  WHERE user_id = v_sender AND xp >= v_gift.price_xp
  RETURNING xp INTO v_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Недостаточно XP';
  END IF;

  INSERT INTO public.ugr_user_gifts
    (sender_id, recipient_id, gift_key, xp_spent, message)
  VALUES
    (v_sender, p_recipient_id, v_gift.gift_key, v_gift.price_xp, v_message)
  RETURNING id INTO v_gift_id;

  RETURN jsonb_build_object(
    'gift_id', v_gift_id,
    'gift_key', v_gift.gift_key,
    'title', v_gift.title,
    'emoji', v_gift.emoji,
    'xp_spent', v_gift.price_xp,
    'remaining_xp', v_balance,
    'recipient_id', p_recipient_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_ugr_gift(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_ugr_gift(text, uuid, text) TO authenticated;

-- Таблица user_xp и функция claim_daily_xp не меняются.
-- Чат разработчика создаётся клиентом через уже существующую функцию
-- public.create_or_get_direct_conversation(uuid), поэтому новые таблицы чатов не нужны.

-- Идемпотентное создание закреплённого личного чата с разработчиком.
-- Advisory lock предотвращает создание дублей при одновременном входе
-- пользователя из нескольких вкладок/устройств.
CREATE OR REPLACE FUNCTION public.ensure_developer_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_developer uuid := '3bc957da-10a5-4587-aa76-05f4d1d67bb2'::uuid;
  v_conversation uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF v_me = v_developer THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      LEAST(v_me::text, v_developer::text) || ':' || GREATEST(v_me::text, v_developer::text),
      0
    )
  );

  SELECT c.id INTO v_conversation
  FROM public.conversations c
  WHERE EXISTS (
    SELECT 1 FROM public.conversation_members a
    WHERE a.conversation_id = c.id AND a.user_id = v_me
  )
  AND EXISTS (
    SELECT 1 FROM public.conversation_members b
    WHERE b.conversation_id = c.id AND b.user_id = v_developer
  )
  AND (
    SELECT count(*) FROM public.conversation_members x
    WHERE x.conversation_id = c.id
  ) = 2
  LIMIT 1;

  IF v_conversation IS NOT NULL THEN
    RETURN v_conversation;
  END IF;

  INSERT INTO public.conversations DEFAULT VALUES
  RETURNING id INTO v_conversation;
  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_conversation, v_me), (v_conversation, v_developer);

  RETURN v_conversation;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_developer_chat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_developer_chat() TO authenticated;
