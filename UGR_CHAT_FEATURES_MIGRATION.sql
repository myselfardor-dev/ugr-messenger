-- UGR Messenger: ответы и закрепление сообщений
-- Выполнить в Supabase SQL Editor после резервной копии.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

-- Индекс для быстрого поиска закреплённых сообщений в диалоге.
CREATE INDEX IF NOT EXISTS messages_conversation_pinned_idx
  ON public.messages (conversation_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- Разрешаем участникам диалога менять только поле закрепления.
GRANT UPDATE (pinned_at) ON TABLE public.messages TO authenticated;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='messages' AND policyname='ugr_members_pin_messages') THEN
    CREATE POLICY ugr_members_pin_messages ON public.messages FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id=messages.conversation_id AND cm.user_id=auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.conversation_members cm WHERE cm.conversation_id=messages.conversation_id AND cm.user_id=auth.uid()));
  END IF;
END $$;
