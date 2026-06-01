-- ============================================================
-- MestrePro — FIX RPCs públicas 2026-06-01
--
-- Remove user_id das RPCs de leitura pública:
--   pub_orcamento_aprovacao -> user_id não é necessário na
--     página de aprovação e expõe UUID do pintor a anônimos.
--   pub_orcamento_portal -> idem.
--
-- ROLLBACK: ver bloco comentado no fim.
-- ============================================================

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

GRANT EXECUTE ON FUNCTION public.pub_orcamento_aprovacao(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pub_orcamento_portal(text)     TO anon, authenticated;

-- Índices para as colunas de token (evita full scan em acessos públicos)
CREATE INDEX IF NOT EXISTS idx_orc_aprov_token
  ON public.orcamentos(aprov_token)
  WHERE aprov_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orc_portal_token
  ON public.orcamentos(portal_token)
  WHERE portal_token IS NOT NULL;

-- ============================================================
-- ROLLBACK (restaura user_id e remove índices):
--   CREATE OR REPLACE FUNCTION public.pub_orcamento_aprovacao(p_token text)
--   RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--     SELECT to_jsonb(o) FROM (
--       SELECT id, numero, cliente, endereco, status, total, data_completa,
--              aprov_token, aprov_status, aprov_at, aprov_motivo, user_id, mode, sig_token
--       FROM orcamentos
--       WHERE (aprov_token = p_token OR sig_token = p_token) AND p_token IS NOT NULL
--       LIMIT 1
--     ) o;
--   $$;
--   CREATE OR REPLACE FUNCTION public.pub_orcamento_portal(p_token text)
--   RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--     SELECT to_jsonb(o) FROM (
--       SELECT id, numero, cliente, endereco, status, total, data_completa, sig_token,
--              aprov_status, user_id, mode, portal_token, portal_progresso,
--              portal_fotos, portal_mensagens, portal_etapa
--       FROM orcamentos
--       WHERE (portal_token = p_token OR aprov_token = p_token) AND p_token IS NOT NULL
--       LIMIT 1
--     ) o;
--   $$;
--   DROP INDEX IF EXISTS idx_orc_aprov_token;
--   DROP INDEX IF EXISTS idx_orc_portal_token;
-- ============================================================
