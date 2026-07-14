-- Portado do Supabase (produção, via pg_get_functiondef) em 2026-07-14
-- para dar suporte ao painel pintopro-admin.html. auth.uid() -> app.current_user_id(),
-- checagem de admin usa a função is_admin() já existente (01-schema-core.sql).
-- Diferença de schema: Neon não tem auth.users — email já está em profiles.email,
-- então os joins com auth.users viram leitura direta de profiles.email.
-- Tabela "assinaturas" (separada de "subscriptions") já existe em 02-schema-extras.sql.

-- Colunas que faltavam para bater com o admin_get_indicacoes do Supabase.
ALTER TABLE indicacoes
  ADD COLUMN IF NOT EXISTS payout_status text,
  ADD COLUMN IF NOT EXISTS payout_mp_id  text,
  ADD COLUMN IF NOT EXISTS payout_erro   text;

-- assinaturas em 02-schema-extras.sql nasceu sem brinde/motivo (usados por
-- admin_alterar_plano/admin_get_mrr_stats, portados do Supabase).
ALTER TABLE assinaturas
  ADD COLUMN IF NOT EXISTS brinde boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo text;

-- Colunas que faltavam para admin_atualizar_plano_config.
ALTER TABLE planos_config
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE OR REPLACE VIEW v_usuarios_completos AS
SELECT
  p.id, p.nome, p.email, p.plano, p.perfil, p.tel,
  COALESCE(p.tel, p.whatsapp) AS telefone,
  p.cidade, p.ativo, p.is_admin, p.criado_em, p.atualizado_em, p.trial_fim,
  p.obs_admin, p.orcamentos_total, p.laudos_mes,
  COALESCE(a.brinde, false) AS brinde
FROM profiles p
LEFT JOIN assinaturas a ON a.user_id = p.id;

CREATE OR REPLACE FUNCTION get_usuarios_completos()
RETURNS SETOF v_usuarios_completos LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;
  RETURN QUERY SELECT * FROM v_usuarios_completos;
END;
$$;

CREATE OR REPLACE FUNCTION admin_alterar_plano(p_user_id uuid, p_plano text, p_brinde boolean DEFAULT false, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;

  IF p_plano NOT IN ('gratuito','trial','pro','equipe','ia-pro','ia_pro') THEN
    RAISE EXCEPTION 'Plano inválido: %', p_plano;
  END IF;

  UPDATE profiles SET plano = p_plano, atualizado_em = now() WHERE id = p_user_id;

  IF p_motivo IS NOT NULL THEN
    UPDATE profiles
       SET obs_admin = COALESCE(obs_admin || E'\n', '') ||
                       '[' || now()::date || '] Plano → ' || p_plano ||
                       CASE WHEN p_brinde THEN ' (brinde)' ELSE '' END ||
                       ': ' || p_motivo
     WHERE id = p_user_id;
  END IF;

  INSERT INTO assinaturas (user_id, plano, status, brinde, motivo, atualizado_em)
  VALUES (
    p_user_id, p_plano,
    CASE WHEN p_plano IN ('pro','equipe','ia-pro','ia_pro') THEN
      CASE WHEN p_brinde THEN 'brinde' ELSE 'ativo' END
    ELSE 'inativo' END,
    p_brinde, p_motivo, now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET plano = EXCLUDED.plano, status = EXCLUDED.status,
        brinde = EXCLUDED.brinde, motivo = EXCLUDED.motivo, atualizado_em = now();

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'plano', p_plano, 'brinde', p_brinde);
END;
$$;

CREATE OR REPLACE FUNCTION admin_atualizar_plano_config(
  p_id text, p_nome text, p_descricao text, p_preco_mensal numeric, p_preco_anual numeric,
  p_desconto_pct numeric DEFAULT 0, p_promo_inicio timestamptz DEFAULT NULL,
  p_promo_validade timestamptz DEFAULT NULL, p_promo_label text DEFAULT NULL, p_ativo boolean DEFAULT true
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  UPDATE planos_config SET
    nome = p_nome, descricao = p_descricao, preco_mensal = p_preco_mensal, preco_anual = p_preco_anual,
    desconto_pct = COALESCE(p_desconto_pct, 0), promo_inicio = p_promo_inicio,
    promo_validade = p_promo_validade, promo_label = p_promo_label, ativo = p_ativo,
    updated_at = now(), updated_by = app.current_user_id()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano não encontrado: %', p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_audit_log()
RETURNS TABLE(id uuid, user_id uuid, actor_nome text, action text, tabela text, record_id text, old_data jsonb, new_data jsonb, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT al.id, al.user_id, p.nome,
    al.operacao, al.tabela, al.registro_id,
    al.dados_antes, al.dados_depois, al.criado_em
  FROM audit_log al
  LEFT JOIN profiles p ON p.id = al.user_id
  ORDER BY al.criado_em DESC LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_email_queue()
RETURNS TABLE(id uuid, user_id uuid, email text, nome text, template text, agendado_para timestamptz, enviado_em timestamptz, status text, tentativas integer, erro_msg text, criado_em timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT eq.id, eq.user_id, eq.email, eq.nome, eq.template,
    eq.agendado_para, eq.enviado_em, eq.status, eq.tentativas, eq.erro_msg, eq.criado_em
  FROM email_queue eq ORDER BY eq.criado_em DESC LIMIT 500;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_ia_uso()
RETURNS TABLE(user_id uuid, nome text, email text, plano text, feature text, total_usos bigint, total_tokens bigint, erros bigint, ultimo_uso timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT il.user_id, p.nome::text, p.email::text, p.plano::text, il.feature::text,
    COUNT(*)::bigint,
    SUM(COALESCE(il.tokens_usados,0))::bigint,
    COUNT(*) FILTER (WHERE il.sucesso = false)::bigint,
    MAX(il.criado_em)
  FROM ia_uso_log il
  LEFT JOIN profiles p ON p.id = il.user_id
  GROUP BY il.user_id, il.feature, p.nome, p.email, p.plano
  ORDER BY COUNT(*) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_indicacoes()
RETURNS TABLE(id uuid, referrer_id uuid, referrer_nome text, referrer_email text, indicado_email text, status text, plano_contratado text, comissao_pct numeric, comissao_brl numeric, valor_pago_brl numeric, pago_em timestamptz, payout_status text, payout_mp_id text, payout_erro text, criado_em timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT i.id, i.referrer_id, p.nome, p.email::text,
    i.indicado_email, i.status, i.plano_contratado,
    i.comissao_pct, i.comissao_brl, i.valor_pago_brl, i.pago_em,
    i.payout_status, i.payout_mp_id, i.payout_erro, i.criado_em
  FROM indicacoes i
  LEFT JOIN profiles p ON p.id = i.referrer_id
  ORDER BY i.criado_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_mrr_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_mrr numeric := 0;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  SELECT SUM(CASE p.plano
    WHEN 'basico'      THEN 49
    WHEN 'pro'         THEN 99
    WHEN 'equipe'      THEN 179
    WHEN 'ia-pro'      THEN 249
    WHEN 'pintor-std'  THEN 69
    WHEN 'pintor-pro'  THEN 99
    WHEN 'lojista'     THEN 99
    ELSE 0 END)
  INTO v_mrr
  FROM profiles p
  LEFT JOIN assinaturas a ON a.user_id = p.id
  WHERE p.plano NOT IN ('gratuito', 'trial')
    AND p.ativo = true
    AND (p.perfil IS DISTINCT FROM 'admin')
    AND (p.is_admin IS NULL OR p.is_admin = false)
    AND (a.brinde IS NULL OR a.brinde = false);

  RETURN jsonb_build_object('mrr', COALESCE(v_mrr, 0), 'arr', COALESCE(v_mrr, 0) * 12);
END;
$$;

CREATE OR REPLACE FUNCTION admin_reenviar_email(p_queue_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE email_queue
  SET status = 'pendente', tentativas = 0, erro_msg = null, agendado_para = now()
  WHERE id = p_queue_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_producao_por_usuario(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_desde date DEFAULT NULL)
RETURNS TABLE(user_id uuid, nome text, email text, plano text, total_orcamentos bigint, total_laudos bigint, ultimo_orcamento timestamptz, ultimo_laudo timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.nome, p.email, p.plano,
    COUNT(DISTINCT o.id)::bigint,
    COUNT(DISTINCT l.id)::bigint,
    MAX(o.criado_em),
    MAX(l.criado_em)
  FROM profiles p
  LEFT JOIN orcamentos o ON o.user_id = p.id AND (p_desde IS NULL OR o.criado_em >= p_desde)
  LEFT JOIN laudos l ON l.user_id = p.id AND (p_desde IS NULL OR l.criado_em >= p_desde)
  GROUP BY p.id, p.nome, p.email, p.plano
  ORDER BY (COUNT(DISTINCT o.id) + COUNT(DISTINCT l.id)) DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
