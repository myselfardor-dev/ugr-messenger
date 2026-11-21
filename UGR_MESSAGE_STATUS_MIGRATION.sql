-- UGR MESSENGER: стабильные статусы доставки, прочтения и реакции.
-- Выполнить в Supabase -> SQL Editor -> New query -> Run.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Участники диалога могут менять поля квитанций и реакций.
GRANT UPDATE (delivered_at, read_at, reactions) ON TABLE public.messages TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
      AND policyname = 'ugr_members_update_message_receipts_reactions'
  ) THEN
    CREATE POLICY ugr_members_update_message_receipts_reactions
      ON public.messages FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.conversation_members cm
        WHERE cm.conversation_id = messages.conversation_id
          AND cm.user_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.conversation_members cm
        WHERE cm.conversation_id = messages.conversation_id
          AND cm.user_id = auth.uid()
      ));
  END IF;
END $$;

-- Добавить messages в Realtime, если таблица ещё не опубликована.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
