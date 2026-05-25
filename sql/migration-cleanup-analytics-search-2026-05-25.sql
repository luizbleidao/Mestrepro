-- ─────────────────────────────────────────────────────────────
-- Migration: fix_mrr_exclude_admins_drop_orphan_tables_2026_05_25
-- Aplicado em: 2026-05-25 via Supabase MCP
-- ─────────────────────────────────────────────────────────────

-- 1. admin_get_mrr_stats() — excluir contas admin do cálculo de MRR/ARR
CREATE OR REPLACE FUNCTION admin_get_mrr_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_mrr numeric := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND (perfil = 'admin' OR is_admin = true)
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  SELECT SUM(CASE plano
    WHEN 'basico'      THEN 49
    WHEN 'pro'         THEN 99
    WHEN 'equipe'      THEN 179
    WHEN 'ia-pro'      THEN 249
    WHEN 'pintor-std'  THEN 69
    WHEN 'pintor-pro'  THEN 99
    WHEN 'lojista'     THEN 99
    ELSE 0 END)
  INTO v_mrr
  FROM profiles
  WHERE plano NOT IN ('gratuito', 'trial')
    AND ativo = true
    AND (perfil IS DISTINCT FROM 'admin')        -- excluir perfil admin
    AND (is_admin IS NULL OR is_admin = false);  -- excluir is_admin=true

  RETURN jsonb_build_object(
    'mrr', COALESCE(v_mrr, 0),
    'arr', COALESCE(v_mrr, 0) * 12
  );
END;
$$;

-- 2. Remover tabelas órfãs do sistema antigo de afiliados
--    (nunca referenciadas no código — substituídas por 'indicacoes')
DROP TABLE IF EXISTS comissoes CASCADE;
DROP TABLE IF EXISTS afiliados  CASCADE;
DROP TABLE IF EXISTS eventos    CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Mudanças em arquivos (não SQL):
--
-- pintopro-orcamentos.html:
--   + Barra de busca + filtros por status e tipo
--   + Funções: filtrarOrcamentos(), limparFiltros(), renderListFiltrada(), _orcaCardHtml()
--
-- pintopro-login.html:
--   + _track(event, params) — helper Analytics
--   + Evento 'Login' após login com senha
--   + Evento 'CompleteRegistration' após cadastro
--   + Evento 'InitiateCheckout' em irMP()
--
-- pintopro-planos.html:
--   + _track(event, params) — helper Analytics
--   + Evento 'InitiateCheckout' em handleCheckoutClick()
--
-- pintopro-app.html:
--   + Evento 'purchase' / 'Purchase' ao detectar upgrade de plano
--
-- Para ativar analytics: configurar no Vercel Dashboard:
--   GA4_MEASUREMENT_ID = G-XXXXXXXXXX
--   META_PIXEL_ID      = 1234567890123
-- ─────────────────────────────────────────────────────────────
-- ROLLBACK:
-- DROP TABLE afiliados / comissoes / eventos: irreversível (sem dados úteis)
-- Para reverter MRR: remover as 2 linhas de filtro de admin no SELECT
-- ─────────────────────────────────────────────────────────────
