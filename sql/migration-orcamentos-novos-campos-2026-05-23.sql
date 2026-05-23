-- ============================================================
-- MestrePro — Migration: Novos campos em orcamentos
-- Data: 2026-05-23
-- Adiciona colunas para aprovação, portal do cliente e indicação
-- Rollback: ver seção ROLLBACK ao final
-- ============================================================

-- ── Aprovação de orçamento ───────────────────────────────────
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS aprov_token   text UNIQUE,
  ADD COLUMN IF NOT EXISTS aprov_status  text DEFAULT 'pendente'
    CHECK (aprov_status IN ('pendente','aprovado','recusado')),
  ADD COLUMN IF NOT EXISTS aprov_at      timestamptz,
  ADD COLUMN IF NOT EXISTS aprov_motivo  text;

-- ── Portal do cliente ────────────────────────────────────────
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS portal_token      text UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_progresso  int2 DEFAULT 0 CHECK (portal_progresso BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS portal_etapa      int2 DEFAULT 0 CHECK (portal_etapa BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS portal_fotos      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_mensagens  jsonb DEFAULT '[]'::jsonb;

-- ── Índices para busca por token ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orcamentos_aprov_token  ON public.orcamentos(aprov_token) WHERE aprov_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orcamentos_portal_token ON public.orcamentos(portal_token) WHERE portal_token IS NOT NULL;

-- ── RPC: atualizar_progresso_portal ──────────────────────────
-- Chamada pelo pintor para atualizar progresso sem expor service_key
CREATE OR REPLACE FUNCTION public.atualizar_progresso_portal(
  p_orc_id       uuid,
  p_progresso    int,
  p_etapa        int DEFAULT NULL,
  p_nova_foto    text DEFAULT NULL,  -- URL da foto no Storage
  p_mensagem     text DEFAULT NULL   -- Mensagem do pintor para o cliente
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Verifica que o orçamento pertence ao usuário autenticado
  IF NOT EXISTS (SELECT 1 FROM orcamentos WHERE id = p_orc_id AND user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'erro', 'Orçamento não encontrado ou sem permissão');
  END IF;

  -- Atualiza progresso
  UPDATE orcamentos SET
    portal_progresso = GREATEST(0, LEAST(100, p_progresso)),
    portal_etapa     = COALESCE(p_etapa, portal_etapa),
    portal_fotos     = CASE
      WHEN p_nova_foto IS NOT NULL
      THEN portal_fotos || jsonb_build_array(p_nova_foto)
      ELSE portal_fotos
    END,
    portal_mensagens = CASE
      WHEN p_mensagem IS NOT NULL
      THEN portal_mensagens || jsonb_build_array(jsonb_build_object(
        'de', 'pintor', 'texto', p_mensagem, 'em', now()::text
      ))
      ELSE portal_mensagens
    END
  WHERE id = p_orc_id AND user_id = v_uid;

  RETURN json_build_object('ok', true);
END;
$$;

-- ── RPC: responder_mensagem_portal ────────────────────────────
-- Chamada pelo pintor para responder mensagem do cliente
CREATE OR REPLACE FUNCTION public.responder_mensagem_portal(
  p_orc_id    uuid,
  p_mensagem  text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orcamentos WHERE id = p_orc_id AND user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'erro', 'Sem permissão');
  END IF;

  UPDATE orcamentos SET
    portal_mensagens = portal_mensagens || jsonb_build_array(jsonb_build_object(
      'de', 'pintor', 'texto', p_mensagem, 'em', now()::text
    ))
  WHERE id = p_orc_id AND user_id = v_uid;

  RETURN json_build_object('ok', true);
END;
$$;

-- ── ROLLBACK ─────────────────────────────────────────────────
-- ALTER TABLE public.orcamentos
--   DROP COLUMN IF EXISTS aprov_token,
--   DROP COLUMN IF EXISTS aprov_status,
--   DROP COLUMN IF EXISTS aprov_at,
--   DROP COLUMN IF EXISTS aprov_motivo,
--   DROP COLUMN IF EXISTS portal_token,
--   DROP COLUMN IF EXISTS portal_progresso,
--   DROP COLUMN IF EXISTS portal_etapa,
--   DROP COLUMN IF EXISTS portal_fotos,
--   DROP COLUMN IF EXISTS portal_mensagens;
-- DROP FUNCTION IF EXISTS public.atualizar_progresso_portal(uuid,int,int,text,text);
-- DROP FUNCTION IF EXISTS public.responder_mensagem_portal(uuid,text);
