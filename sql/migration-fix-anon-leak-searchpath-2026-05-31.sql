-- ============================================================
-- MestrePro — FIX SEGURANÇA 2026-05-31
-- Auditoria completa. Aplicada em produção via MCP em 2026-05-31.
--
-- 1) Fecha vazamento anon: as policies "USING (aprov_token IS NOT NULL)" /
--    "(portal_token IS NOT NULL)" / "(sig_token IS NOT NULL)" liberavam leitura
--    de TODAS as linhas para qualquer anônimo (bastava remover o filtro .eq()).
-- 2) Cria RPCs SECURITY DEFINER que filtram pelo token EXATO (única leitura pública).
-- 3) Restringe propostas_publicas (tinha USING (true) — tabela inteira pública).
-- 4) Seta search_path nas 7 funções SECURITY DEFINER faltantes (hijacking).
--
-- ROLLBACK: ver bloco comentado no fim.
-- ============================================================

-- ---------- 2) RPCs de leitura pública por token ----------

CREATE OR REPLACE FUNCTION public.pub_orcamento_aprovacao(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(o) FROM (
    SELECT id, numero, cliente, endereco, status, total, data_completa,
           aprov_token, aprov_status, aprov_at, aprov_motivo, user_id, mode, sig_token
    FROM orcamentos
    WHERE (aprov_token = p_token OR sig_token = p_token) AND p_token IS NOT NULL
    LIMIT 1
  ) o;
$$;

CREATE OR REPLACE FUNCTION public.pub_orcamento_portal(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(o) FROM (
    SELECT id, numero, cliente, endereco, status, total, data_completa, sig_token,
           aprov_status, user_id, mode, portal_token, portal_progresso,
           portal_fotos, portal_mensagens, portal_etapa
    FROM orcamentos
    WHERE (portal_token = p_token OR aprov_token = p_token) AND p_token IS NOT NULL
    LIMIT 1
  ) o;
$$;

CREATE OR REPLACE FUNCTION public.pub_documento_assinatura(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','orcamento') INTO r FROM (
    SELECT id,numero,cliente,endereco,total,status,sig_token,sig_token_expires_at,
           sig_cliente,sig_cliente_at,sig_cliente_nome,data_completa
    FROM orcamentos WHERE sig_token = p_token LIMIT 1) x;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','laudo') INTO r FROM (
    SELECT id,numero,cliente,obra,criticidade,sig_token,sig_token_expires_at,
           sig_cliente,sig_cliente_at,sig_cliente_nome,dados
    FROM laudos WHERE sig_token = p_token LIMIT 1) x;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','contrato') INTO r FROM (
    SELECT id,numero,cliente,endereco,valor,status,sig_token,sig_token_expires_at,
           assinado_cli,sig_cli_at,sig_cli_nome,dados
    FROM contratos WHERE sig_token = p_token LIMIT 1) x;
  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pub_orcamento_aprovacao(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pub_orcamento_portal(text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pub_documento_assinatura(text) TO anon, authenticated;

-- ---------- 1) Remove policies anon abertas (vazamento) ----------
DROP POLICY IF EXISTS "orcamentos: public read by aprov_token"  ON public.orcamentos;
DROP POLICY IF EXISTS "orcamentos: public read by portal_token" ON public.orcamentos;
DROP POLICY IF EXISTS "orcamentos: public read by token"        ON public.orcamentos;
DROP POLICY IF EXISTS "contratos_public_read"                   ON public.contratos;
DROP POLICY IF EXISTS "laudos: public read by token"            ON public.laudos;

-- ---------- 3) propostas_publicas: remove leitura pública ampla ----------
DROP POLICY IF EXISTS "propostas_leitura_publica" ON public.propostas_publicas;

-- ---------- 4) search_path nas funções SECURITY DEFINER faltantes ----------
ALTER FUNCTION public.admin_atualizar_plano_config(text,text,text,numeric,numeric,numeric,timestamptz,timestamptz,text,boolean) SET search_path = public;
ALTER FUNCTION public.get_planos_config()                SET search_path = public;
ALTER FUNCTION public.get_usuarios_completos()           SET search_path = public;
ALTER FUNCTION public.limpar_otps_expirados()            SET search_path = public;
ALTER FUNCTION public.sync_assinatura_on_plano_change()  SET search_path = public;
ALTER FUNCTION public.trg_email_boas_vindas()            SET search_path = public;
ALTER FUNCTION public.trg_email_confirmacao_assinatura() SET search_path = public;

-- ============================================================
-- ROLLBACK (reabre o vazamento — usar só em emergência):
--   DROP FUNCTION IF EXISTS public.pub_orcamento_aprovacao(text);
--   DROP FUNCTION IF EXISTS public.pub_orcamento_portal(text);
--   DROP FUNCTION IF EXISTS public.pub_documento_assinatura(text);
--   CREATE POLICY "orcamentos: public read by aprov_token" ON public.orcamentos FOR SELECT TO public USING (aprov_token IS NOT NULL);
--   CREATE POLICY "orcamentos: public read by portal_token" ON public.orcamentos FOR SELECT TO public USING (portal_token IS NOT NULL);
--   CREATE POLICY "orcamentos: public read by token" ON public.orcamentos FOR SELECT TO public USING (sig_token IS NOT NULL AND (sig_token_expires_at IS NULL OR sig_token_expires_at > now()));
--   CREATE POLICY "contratos_public_read" ON public.contratos FOR SELECT TO public USING (sig_token IS NOT NULL AND (sig_token_expires_at IS NULL OR sig_token_expires_at > now()));
--   CREATE POLICY "laudos: public read by token" ON public.laudos FOR SELECT TO public USING (sig_token IS NOT NULL AND (sig_token_expires_at IS NULL OR sig_token_expires_at > now()));
--   CREATE POLICY "propostas_leitura_publica" ON public.propostas_publicas FOR SELECT TO public USING (true);
-- ============================================================
