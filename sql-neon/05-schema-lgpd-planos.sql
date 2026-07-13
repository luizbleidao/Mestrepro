-- Portado do Supabase (produção, via pg_get_functiondef) em 2026-07-13:
-- get_planos_config, exportar_meus_dados, meu_programa_indicacao,
-- revogar_consentimento_marketing. auth.uid() -> app.current_user_id().

-- planos_config no Neon (01-schema-core.sql) só tinha as colunas mínimas —
-- faltam as usadas por get_planos_config() (promoções/preço com desconto).
ALTER TABLE planos_config
  ADD COLUMN IF NOT EXISTS descricao      text,
  ADD COLUMN IF NOT EXISTS desconto_pct   numeric,
  ADD COLUMN IF NOT EXISTS promo_validade timestamptz,
  ADD COLUMN IF NOT EXISTS promo_label    text,
  ADD COLUMN IF NOT EXISTS promo_inicio   timestamptz,
  ADD COLUMN IF NOT EXISTS ordem          integer;

CREATE OR REPLACE FUNCTION get_planos_config()
RETURNS TABLE(id text, nome text, descricao text, preco_mensal numeric, preco_anual numeric,
  desconto_pct numeric, promo_validade timestamptz, promo_label text, ativo boolean, ordem integer,
  preco_mensal_final numeric, preco_anual_final numeric, tem_promo boolean, promo_inicio timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    id, nome, descricao, preco_mensal, preco_anual,
    COALESCE(desconto_pct, 0), promo_validade, promo_label, ativo, COALESCE(ordem, 0),
    CASE
      WHEN COALESCE(desconto_pct,0) > 0
        AND (promo_inicio IS NULL OR promo_inicio <= now())
        AND (promo_validade IS NULL OR promo_validade > now())
      THEN ROUND(preco_mensal * (1 - COALESCE(desconto_pct,0)/100), 2)
      ELSE preco_mensal
    END,
    CASE
      WHEN COALESCE(desconto_pct,0) > 0
        AND (promo_inicio IS NULL OR promo_inicio <= now())
        AND (promo_validade IS NULL OR promo_validade > now())
      THEN ROUND(preco_anual * (1 - COALESCE(desconto_pct,0)/100), 2)
      ELSE preco_anual
    END,
    (
      COALESCE(desconto_pct,0) > 0
      AND (promo_inicio IS NULL OR promo_inicio <= now())
      AND (promo_validade IS NULL OR promo_validade > now())
    ),
    promo_inicio
  FROM planos_config
  ORDER BY COALESCE(ordem, 0);
$$;

CREATE OR REPLACE FUNCTION exportar_meus_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid  uuid := app.current_user_id();
  v_dados jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT jsonb_build_object(
    'exportado_em', now(),
    'aviso', 'Exportação gerada para fins de portabilidade (LGPD Art.18 II). Dados pessoais de seus clientes são de sua responsabilidade como controlador.',
    'perfil', (
      SELECT jsonb_build_object(
        'nome', nome, 'plano', plano, 'cidade', cidade,
        'whatsapp', whatsapp, 'criado_em', criado_em,
        'lgpd_aceito', lgpd_aceito, 'lgpd_aceito_em', lgpd_aceito_em,
        'lgpd_versao', lgpd_versao
      ) FROM profiles WHERE id = v_uid
    ),
    'orcamentos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'numero', numero, 'cliente', cliente, 'status', status,
        'total', total, 'data', data, 'criado_em', criado_em
      ) ORDER BY criado_em DESC), '[]'::jsonb)
      FROM orcamentos WHERE user_id = v_uid
    ),
    'contratos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'numero', numero, 'cliente', cliente, 'status', status,
        'valor', valor, 'data_inicio', data_inicio, 'criado_em', criado_em
      ) ORDER BY criado_em DESC), '[]'::jsonb)
      FROM contratos WHERE user_id = v_uid
    ),
    'laudos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'numero', numero, 'cliente', cliente, 'cidade', cidade,
        'data', data, 'status', status, 'criado_em', criado_em
      ) ORDER BY criado_em DESC), '[]'::jsonb)
      FROM laudos WHERE user_id = v_uid
    ),
    'pagamentos', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'plano', plano, 'valor', valor, 'status', status,
        'metodo', metodo, 'criado_em', criado_em
      ) ORDER BY criado_em DESC), '[]'::jsonb)
      FROM pagamentos WHERE user_id = v_uid
    )
  ) INTO v_dados;

  RETURN v_dados;
END;
$$;

CREATE OR REPLACE FUNCTION meu_programa_indicacao()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid   uuid := app.current_user_id();
  v_ref   text;
  v_total int;
  v_ativos int;
  v_comissao numeric;
BEGIN
  v_ref := upper(left(replace(v_uid::text, '-', ''), 8));

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('ativo','pago')),
    COALESCE(SUM(comissao_brl) FILTER (WHERE status = 'pago'), 0)
  INTO v_total, v_ativos, v_comissao
  FROM indicacoes
  WHERE referrer_id = v_uid;

  RETURN json_build_object(
    'ref_code',   v_ref,
    'total',      v_total,
    'ativos',     v_ativos,
    'comissao',   v_comissao
  );
END;
$$;

-- Seed de planos_config (copiado da tabela real do Supabase em 2026-07-13)
INSERT INTO planos_config (id, nome, descricao, preco_mensal, preco_anual, desconto_pct, promo_validade, promo_label, ativo, ordem, promo_inicio)
VALUES
  ('basico', 'Básico', 'Orçamentos básicos — para começar', 49.00, 490.00, 30.00, '2026-06-01 02:59:59+00', NULL, true, 0, NULL),
  ('pro', 'Pro', 'Tudo ilimitado — contratos, recibos, orçamentos sem limite', 97.00, 970.00, 30.00, '2026-06-01 02:59:59+00', NULL, true, 1, NULL),
  ('equipe', 'Equipe', 'Tudo do Pro + gestão de time com múltiplos usuários', 197.00, 1970.00, 30.00, '2026-06-01 02:59:59+00', NULL, true, 2, NULL),
  ('ia-pro', 'IA Pro', 'Tudo do Equipe + inteligência artificial completa', 297.00, 2970.00, 30.00, '2026-06-01 02:59:59+00', NULL, true, 3, NULL)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, descricao = EXCLUDED.descricao,
  preco_mensal = EXCLUDED.preco_mensal, preco_anual = EXCLUDED.preco_anual,
  desconto_pct = EXCLUDED.desconto_pct, promo_validade = EXCLUDED.promo_validade,
  ativo = EXCLUDED.ativo, ordem = EXCLUDED.ordem;

CREATE OR REPLACE FUNCTION revogar_consentimento_marketing()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF app.current_user_id() IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Não autenticado');
  END IF;
  UPDATE profiles
  SET consentimento_marketing    = false,
      consentimento_marketing_em = now()
  WHERE id = app.current_user_id();
  RETURN json_build_object('ok', true);
END;
$$;
