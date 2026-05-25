-- ─────────────────────────────────────────────────────────────
-- Migration: migration-admin-recursos-2026-05-25
-- RPCs para painel admin expandido + pg_cron email queue
-- Aplicado em: 2026-05-25 via Supabase MCP
-- ─────────────────────────────────────────────────────────────

-- 1. admin_get_indicacoes() — listagem completa de indicações para admin
CREATE OR REPLACE FUNCTION admin_get_indicacoes()
RETURNS TABLE (
  id uuid, referrer_id uuid, referrer_nome text, referrer_email text,
  indicado_email text, status text, plano_contratado text,
  comissao_pct numeric, comissao_brl numeric, valor_pago_brl numeric,
  pago_em timestamptz, payout_status text, payout_mp_id text,
  payout_erro text, criado_em timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT i.id, i.referrer_id, p.nome, au.email,
    i.indicado_email, i.status, i.plano_contratado,
    i.comissao_pct, i.comissao_brl, i.valor_pago_brl, i.pago_em,
    i.payout_status, i.payout_mp_id, i.payout_erro, i.criado_em
  FROM indicacoes i
  LEFT JOIN profiles p ON p.id=i.referrer_id
  LEFT JOIN auth.users au ON au.id=i.referrer_id
  ORDER BY i.criado_em DESC;
END;
$$;

-- 2. admin_get_email_queue() — fila de emails para admin
CREATE OR REPLACE FUNCTION admin_get_email_queue()
RETURNS TABLE (
  id uuid, user_id uuid, email text, nome text, template text,
  agendado_para timestamptz, enviado_em timestamptz, status text,
  tentativas int, erro_msg text, criado_em timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT eq.id, eq.user_id, eq.email, eq.nome, eq.template,
    eq.agendado_para, eq.enviado_em, eq.status,
    eq.tentativas, eq.erro_msg, eq.criado_em
  FROM email_queue eq ORDER BY eq.criado_em DESC LIMIT 500;
END;
$$;

-- 3. admin_get_ia_uso() — uso de IA por usuário e feature
CREATE OR REPLACE FUNCTION admin_get_ia_uso()
RETURNS TABLE (
  user_id uuid, nome text, email text, plano text, feature text,
  total_usos bigint, total_tokens bigint, erros bigint, ultimo_uso timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT il.user_id, p.nome, au.email, p.plano, il.feature,
    COUNT(*)::bigint,
    SUM(COALESCE(il.tokens_usados,0))::bigint,
    COUNT(*) FILTER (WHERE il.sucesso=false)::bigint,
    MAX(il.criado_em)
  FROM ia_uso_log il
  LEFT JOIN profiles p ON p.id=il.user_id
  LEFT JOIN auth.users au ON au.id=il.user_id
  GROUP BY il.user_id, il.feature, p.nome, au.email, p.plano
  ORDER BY COUNT(*) DESC;
END;
$$;

-- 4. admin_get_audit_log() — audit log completo
CREATE OR REPLACE FUNCTION admin_get_audit_log()
RETURNS TABLE (
  id bigint, user_id uuid, actor_nome text, action text,
  tabela text, record_id text, old_data jsonb, new_data jsonb, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
  SELECT al.id, al.user_id, p.nome,
    al.action, al.tabela, al.record_id,
    al.old_data, al.new_data, al.created_at
  FROM audit_log al
  LEFT JOIN profiles p ON p.id=al.actor_id
  ORDER BY al.created_at DESC LIMIT 500;
END;
$$;

-- 5. admin_get_mrr_stats() — MRR e ARR estimados
CREATE OR REPLACE FUNCTION admin_get_mrr_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_mrr numeric:=0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  SELECT SUM(CASE plano
    WHEN 'basico'     THEN 49  WHEN 'pro'        THEN 99
    WHEN 'equipe'     THEN 179 WHEN 'ia-pro'      THEN 249
    WHEN 'pintor-std' THEN 69  WHEN 'pintor-pro'  THEN 99
    WHEN 'lojista'    THEN 99  ELSE 0 END)
  INTO v_mrr FROM profiles WHERE plano NOT IN ('gratuito','trial') AND ativo=true;
  RETURN jsonb_build_object('mrr',COALESCE(v_mrr,0),'arr',COALESCE(v_mrr,0)*12);
END;
$$;

-- 6. admin_reenviar_email(uuid) — recoloca email na fila
CREATE OR REPLACE FUNCTION admin_reenviar_email(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true))
  THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  UPDATE email_queue
  SET status='pendente', tentativas=0, erro_msg=null, agendado_para=now()
  WHERE id=p_queue_id;
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- 7. pg_cron: email-sender 2x/dia (09h e 12h UTC)
-- Requer extensões pg_cron e pg_net habilitadas no projeto Supabase
DO $$
BEGIN
  PERFORM cron.unschedule('mestrepro-email-sender');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'mestrepro-email-sender',
  '0 9,12 * * *',
  $$
  SELECT net.http_post(
    url:='https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/email-sender',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{"source":"cron"}'::jsonb
  );
  $$
);

-- ─────────────────────────────────────────────────────────────
-- ROLLBACK (se necessário):
-- DROP FUNCTION IF EXISTS admin_get_indicacoes();
-- DROP FUNCTION IF EXISTS admin_get_email_queue();
-- DROP FUNCTION IF EXISTS admin_get_ia_uso();
-- DROP FUNCTION IF EXISTS admin_get_audit_log();
-- DROP FUNCTION IF EXISTS admin_get_mrr_stats();
-- DROP FUNCTION IF EXISTS admin_reenviar_email(uuid);
-- SELECT cron.unschedule('mestrepro-email-sender');
-- ─────────────────────────────────────────────────────────────
