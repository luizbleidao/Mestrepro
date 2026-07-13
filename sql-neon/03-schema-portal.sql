-- Colunas de aprovação pública e portal do cliente em orcamentos
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS aprov_token   text UNIQUE,
  ADD COLUMN IF NOT EXISTS aprov_status  text DEFAULT 'pendente'
    CHECK (aprov_status IN ('pendente','aprovado','recusado')),
  ADD COLUMN IF NOT EXISTS aprov_at      timestamptz,
  ADD COLUMN IF NOT EXISTS aprov_motivo  text,
  ADD COLUMN IF NOT EXISTS portal_token      text UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_progresso  int2 DEFAULT 0 CHECK (portal_progresso BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS portal_etapa      int2 DEFAULT 0 CHECK (portal_etapa BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS portal_fotos      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_mensagens  jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_orcamentos_aprov_token  ON public.orcamentos(aprov_token) WHERE aprov_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orcamentos_portal_token ON public.orcamentos(portal_token) WHERE portal_token IS NOT NULL;

-- RPCs públicas de leitura (sem user_id — corrigido em 2026-06-01 no Supabase, já nasce certo aqui)
CREATE OR REPLACE FUNCTION public.pub_orcamento_aprovacao(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(o) FROM (
    SELECT id, numero, cliente, endereco, status, total, data_completa,
           aprov_token, aprov_status, aprov_at, aprov_motivo, mode, sig_token
    FROM orcamentos
    WHERE (aprov_token = p_token OR sig_token = p_token) AND p_token IS NOT NULL
    LIMIT 1
  ) o;
$$;

CREATE OR REPLACE FUNCTION public.pub_orcamento_portal(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(o) FROM (
    SELECT id, numero, cliente, endereco, status, total, data_completa, sig_token,
           aprov_status, mode, portal_token, portal_progresso,
           portal_fotos, portal_mensagens, portal_etapa
    FROM orcamentos
    WHERE (portal_token = p_token OR aprov_token = p_token) AND p_token IS NOT NULL
    LIMIT 1
  ) o;
$$;

-- Cliente responde aprovação/recusa via token (sem auth — SECURITY DEFINER valida pelo token)
CREATE OR REPLACE FUNCTION public.responder_aprovacao_orcamento(p_token text, p_status text, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id text;
BEGIN
  IF p_status NOT IN ('aprovado', 'recusado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status inválido');
  END IF;
  SELECT id INTO v_id FROM orcamentos
  WHERE (aprov_token = p_token OR sig_token = p_token) AND aprov_status = 'pendente';
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'token inválido ou já respondido');
  END IF;
  UPDATE orcamentos SET aprov_status = p_status, aprov_at = now(), aprov_motivo = p_motivo WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- Pintor atualiza progresso/foto/mensagem do portal (autenticado, precisa ser dono)
CREATE OR REPLACE FUNCTION public.atualizar_progresso_portal(
  p_orc_id text, p_progresso int, p_etapa int DEFAULT NULL,
  p_nova_foto text DEFAULT NULL, p_mensagem text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orcamentos WHERE id = p_orc_id AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Orçamento não encontrado ou sem permissão');
  END IF;
  UPDATE orcamentos SET
    portal_progresso = GREATEST(0, LEAST(100, p_progresso)),
    portal_etapa     = COALESCE(p_etapa, portal_etapa),
    portal_fotos     = CASE WHEN p_nova_foto IS NOT NULL THEN portal_fotos || jsonb_build_array(p_nova_foto) ELSE portal_fotos END,
    portal_mensagens = CASE WHEN p_mensagem IS NOT NULL THEN portal_mensagens || jsonb_build_array(jsonb_build_object('de','pintor','texto',p_mensagem,'em',now()::text)) ELSE portal_mensagens END
  WHERE id = p_orc_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.responder_mensagem_portal(p_orc_id text, p_mensagem text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := app.current_user_id();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orcamentos WHERE id = p_orc_id AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão');
  END IF;
  UPDATE orcamentos SET
    portal_mensagens = portal_mensagens || jsonb_build_array(jsonb_build_object('de','pintor','texto',p_mensagem,'em',now()::text))
  WHERE id = p_orc_id AND user_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;
