-- UGR MESSENGER: delivery receipts
-- Выполни этот запрос в Supabase → SQL Editor → New query → Run.
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- read_at уже используется приложением как отметка прочтения.
-- delivered_at выставляется клиентом получателя после получения сообщения.
-- Для realtime-обновления статусов таблица messages должна быть включена
-- в Supabase Realtime (если INSERT/UPDATE уже приходят в приложении — всё готово).
