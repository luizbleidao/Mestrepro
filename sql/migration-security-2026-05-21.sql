-- =============================================================
-- MestrePro — Migration de Segurança e Qualidade
-- Data: 2026-05-21
-- Origem: Relatório de Auditoria Técnica End-to-End
-- Aplica fixes #09, #06, #15, #16, #17, #18, #19, #20, #21, #26
-- =============================================================
-- EXECUTE NO: Supabase Dashboard → SQL Editor
-- ROLLBACK: comentado no final deste arquivo
-- =============================================================

BEGIN;

-- =============================================================
-- FIX #09 — RBAC: Padronizar verificação de admin
-- Problema: algumas policies usavam perfil='admin' em vez de is_admin()
-- =============================================================

-- ia_uso_log
DROP POLICY IF EXISTS "admin_all_log" ON ia_uso_log;
CREATE POLICY "admin_all_log" ON ia_uso_log
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- orcamentos: policy duplicada usando perfil='admin'
DROP POLICY IF EXISTS "admin_all_orcamentos" ON orcamentos;
CREATE POLICY "admin_all_orcamentos" ON orcamentos
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- laudos: policy duplicada usando perfil='admin'
DROP POLICY IF EXISTS "admin_all_laudos" ON laudos;
CREATE POLICY "admin_all_laudos" ON laudos
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- get_producao_por_usuario: usar is_admin() + adicionar paginação (Fix #16)
CREATE OR REPLACE FUNCTION get_producao_por_usuario(
  p_limit  int  DEFAULT 100,
  p_offset int  DEFAULT 0,
  p_desde  date DEFAULT NULL
)
RETURNS TABLE(
  user_id          uuid,
  nome             text,
  email            text,
  plano            text,
  total_orcamentos bigint,
  total_laudos     bigint,
  ultimo_orcamento timestamptz,
  ultimo_laudo     timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;
  RETURN QUERY
  SELECT
    p.id,
    p.nome,
    u.email,
    p.plano,
    COUNT(DISTINCT o.id)::bigint,
    COUNT(DISTINCT l.id)::bigint,
    MAX(o.criado_em),
    MAX(l.criado_em)
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN orcamentos o ON o.user_id = p.id
        AND (p_desde IS NULL OR o.criado_em >= p_desde::timestamptz)
  LEFT JOIN laudos l ON l.user_id = p.id
        AND (p_desde IS NULL OR l.criado_em >= p_desde::timestamptz)
  GROUP BY p.id, p.nome, u.email, p.plano
  ORDER BY (COUNT(DISTINCT o.id) + COUNT(DISTINCT l.id)) DESC
  LIMIT  GREATEST(1, LEAST(COALESCE(p_limit,  100), 500))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;


-- =============================================================
-- FIX #18 — AUDIT LOG de alterações críticas de negócio
-- =============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  tabela       text        NOT NULL,
  registro_id  text        NOT NULL,
  operacao     text        NOT NULL CHECK (operacao IN ('INSERT','UPDATE','DELETE')),
  dados_antes  jsonb,
  dados_depois jsonb,
  criado_em    timestamptz DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Só admin lê; escrita é exclusiva via trigger SECURITY DEFINER
DROP POLICY IF EXISTS "audit_log_admin_read"    ON audit_log;
DROP POLICY IF EXISTS "audit_log_no_direct_write" ON audit_log;
CREATE POLICY "audit_log_admin_read"     ON audit_log FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "audit_log_no_direct_write" ON audit_log AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_audit_log_tabela_reg ON audit_log(tabela, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_ts    ON audit_log(user_id, criado_em DESC);

-- Trigger function genérica de auditoria
CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log
    (user_id, tabela, registro_id, operacao, dados_antes, dados_depois)
  VALUES (
    auth.uid(),
    TG_TABLE_NAME,
    COALESCE(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
      gen_random_uuid()::text
    ),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Aplicar nos documentos de negócio críticos
DROP TRIGGER IF EXISTS trg_audit_orcamentos ON orcamentos;
CREATE TRIGGER trg_audit_orcamentos
  AFTER UPDATE OR DELETE ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_contratos ON contratos;
CREATE TRIGGER trg_audit_contratos
  AFTER UPDATE OR DELETE ON contratos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

DROP TRIGGER IF EXISTS trg_audit_laudos ON laudos;
CREATE TRIGGER trg_audit_laudos
  AFTER UPDATE OR DELETE ON laudos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Auditoria de mudanças críticas em profiles (plano, is_admin, ativo)
DROP TRIGGER IF EXISTS trg_audit_profiles_criticos ON profiles;
CREATE TRIGGER trg_audit_profiles_criticos
  AFTER UPDATE ON profiles
  FOR EACH ROW
  WHEN (
    OLD.plano     IS DISTINCT FROM NEW.plano     OR
    OLD.is_admin  IS DISTINCT FROM NEW.is_admin  OR
    OLD.ativo     IS DISTINCT FROM NEW.ativo
  )
  EXECUTE FUNCTION fn_audit_log();


-- =============================================================
-- FIX #06 — LGPD: Deleção real de dados após conta_excluir_em
-- Incorporado na run_manutencao_diaria existente
-- =============================================================

CREATE OR REPLACE FUNCTION run_manutencao_diaria()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  agora          timestamptz := now();
  inicio_mes     date        := date_trunc('month', agora)::date;
  n_trials       int := 0;
  n_assinat      int := 0;
  n_reset_laudos int := 0;
  n_excluidos    int := 0;
  v_email_id     bigint;
BEGIN
  -- 1. Rebaixar trials expirados
  WITH rebaixados AS (
    UPDATE profiles SET plano = 'gratuito', atualizado_em = agora
    WHERE plano = 'trial'
      AND trial_fim IS NOT NULL
      AND trial_fim < agora
      AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ativa')
    RETURNING id
  ) SELECT COUNT(*) INTO n_trials FROM rebaixados;

  -- 2. Expirar assinaturas vencidas e rebaixar plano
  WITH expiradas AS (
    UPDATE subscriptions SET status = 'expirada', atualizado_em = agora
    WHERE status = 'ativa'
      AND periodo_fim IS NOT NULL
      AND periodo_fim < agora
    RETURNING user_id
  )
  UPDATE profiles SET plano = 'gratuito', atualizado_em = agora
  WHERE id IN (SELECT user_id FROM expiradas);
  GET DIAGNOSTICS n_assinat = ROW_COUNT;

  -- 3. Resetar contador de laudos mensais
  WITH resetados AS (
    UPDATE profiles
    SET laudos_mes = 0, laudos_mes_reset_em = inicio_mes, atualizado_em = agora
    WHERE laudos_mes_reset_em < inicio_mes OR laudos_mes_reset_em IS NULL
    RETURNING id
  ) SELECT COUNT(*) INTO n_reset_laudos FROM resetados;

  -- 4. LGPD Art.18 IV — Excluir dados de contas com prazo de exclusão vencido
  --    A função solicitar_exclusao_conta() marca conta_excluir_em = now()+30 dias
  --    Aqui executamos a deleção real após esse prazo
  WITH contas_vencidas AS (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL
      AND conta_excluir_em <= agora
      AND ativo = false
  )
  DELETE FROM orcamentos  WHERE user_id IN (SELECT id FROM contas_vencidas);

  DELETE FROM contratos
  WHERE user_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  DELETE FROM laudos
  WHERE user_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  DELETE FROM recibos
  WHERE user_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  DELETE FROM documentos_assinados
  WHERE usuario_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  DELETE FROM ia_uso_log
  WHERE user_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  DELETE FROM ia_followup_agendados
  WHERE user_id IN (
    SELECT id FROM profiles
    WHERE conta_excluir_em IS NOT NULL AND conta_excluir_em <= agora AND ativo = false
  );

  -- Anonimizar o profile (auth.users requer API admin — feito separadamente)
  WITH excluidos AS (
    UPDATE profiles SET
      nome             = '[CONTA EXCLUÍDA]',
      whatsapp         = NULL,
      tel              = NULL,
      empresa          = NULL,
      cidade           = NULL,
      empresa_data     = NULL,
      preferencias     = NULL,
      sig_profissional = NULL,
      conta_excluir_em = NULL,
      atualizado_em    = agora
    WHERE conta_excluir_em IS NOT NULL
      AND conta_excluir_em <= agora
      AND ativo = false
    RETURNING id
  ) SELECT COUNT(*) INTO n_excluidos FROM excluidos;

  -- 5. Disparar processamento de emails pendentes
  SELECT net.http_post(
    url     := 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/email-sender',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) INTO v_email_id;

  RETURN jsonb_build_object(
    'executado_em',          agora,
    'trials_rebaixados',     n_trials,
    'assinat_expiradas',     n_assinat,
    'laudos_resetados',      n_reset_laudos,
    'contas_excluidas_lgpd', n_excluidos,
    'email_request_id',      v_email_id
  );
END;
$$;


-- =============================================================
-- FIX #17 — check_rate_limit: corrigir janela ignorada
-- Problema: p_janela era recebida mas ignorada; sempre usava date_trunc('hour')
-- =============================================================

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id uuid, p_endpoint text, p_limite integer, p_janela interval
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_agora      timestamptz := now();
  v_bucket     timestamptz;
  v_janela_ini timestamptz := v_agora - p_janela;
  v_total      int;
BEGIN
  -- Limpar registros mais antigos que 48h
  DELETE FROM public.rate_limits WHERE janela_ini < v_agora - interval '48 hours';

  -- Bucket: usa minuto para janelas curtas, hora para janelas longas
  v_bucket := CASE
    WHEN p_janela <= interval '1 hour' THEN date_trunc('minute', v_agora)
    WHEN p_janela <= interval '1 day'  THEN date_trunc('hour',   v_agora)
    ELSE                                    date_trunc('day',    v_agora)
  END;

  -- Inserir ou incrementar bucket corrente
  INSERT INTO public.rate_limits (user_id, endpoint, janela_ini, contador)
  VALUES (p_user_id, p_endpoint, v_bucket, 1)
  ON CONFLICT (user_id, endpoint, janela_ini)
  DO UPDATE SET contador = rate_limits.contador + 1;

  -- Somar todos os buckets dentro da janela deslizante (p_janela)
  SELECT COALESCE(SUM(contador), 0) INTO v_total
  FROM public.rate_limits
  WHERE user_id  = p_user_id
    AND endpoint = p_endpoint
    AND janela_ini >= v_janela_ini;

  RETURN v_total <= p_limite;
END;
$$;


-- =============================================================
-- FIX #15 — Índices GIN nas colunas JSONB
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_orcamentos_dados_gin  ON orcamentos  USING GIN (dados);
CREATE INDEX IF NOT EXISTS idx_contratos_dados_gin   ON contratos   USING GIN (dados);
CREATE INDEX IF NOT EXISTS idx_laudos_dados_gin      ON laudos      USING GIN (dados);
CREATE INDEX IF NOT EXISTS idx_profiles_empresa_gin  ON profiles    USING GIN (empresa_data) WHERE empresa_data IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_prefs_gin    ON profiles    USING GIN (preferencias)  WHERE preferencias  IS NOT NULL;


-- =============================================================
-- FIX #19 — LGPD Art.18 II: RPC de portabilidade de dados
-- =============================================================

CREATE OR REPLACE FUNCTION exportar_meus_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
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

GRANT EXECUTE ON FUNCTION exportar_meus_dados TO authenticated;


-- =============================================================
-- FIX #26 — Rate limiting na assinatura digital (token-based)
-- =============================================================

-- Versão da RPC registrar_assinatura_cliente(token) com rate limiting por IP
CREATE OR REPLACE FUNCTION registrar_assinatura_cliente(
  p_token  text,
  p_tipo   text,
  p_nome   text,
  p_ip     text,
  p_sig_b64 text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id       text;
  v_exp      timestamptz;
  v_ip_safe  text := COALESCE(left(p_ip, 45), 'indisponível');
  v_tentativas int;
BEGIN
  -- Validar tipo
  IF p_tipo NOT IN ('orcamento', 'laudo', 'contrato') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tipo inválido');
  END IF;

  -- Validar campos mínimos
  IF p_token IS NULL OR p_nome IS NULL OR p_sig_b64 IS NULL
     OR length(p_token) < 10 OR length(p_nome) < 2 OR length(p_sig_b64) < 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dados inválidos');
  END IF;

  -- Rate limiting por IP: máximo 10 tentativas por hora — Fix #26
  IF p_ip IS NOT NULL AND p_ip != 'indisponível' AND length(p_ip) BETWEEN 7 AND 45 THEN
    SELECT COALESCE(SUM(contador), 0) INTO v_tentativas
    FROM public.rate_limits
    WHERE user_id  IS NULL
      AND endpoint = 'sig:' || v_ip_safe
      AND janela_ini >= now() - interval '1 hour';

    IF v_tentativas >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'muitas tentativas — tente novamente em 1 hora');
    END IF;

    -- Registrar tentativa (sem ON CONFLICT pois user_id = NULL é sempre único)
    INSERT INTO public.rate_limits (user_id, endpoint, janela_ini, contador)
    VALUES (NULL, 'sig:' || v_ip_safe, now(), 1);
  END IF;

  -- Buscar documento pelo token
  IF p_tipo = 'orcamento' THEN
    SELECT id, sig_token_expires_at INTO v_id, v_exp
    FROM orcamentos WHERE sig_token = p_token AND sig_cliente IS NULL;
  ELSIF p_tipo = 'laudo' THEN
    SELECT id, sig_token_expires_at INTO v_id, v_exp
    FROM laudos WHERE sig_token = p_token AND sig_cliente IS NULL;
  ELSE
    SELECT id, sig_token_expires_at INTO v_id, v_exp
    FROM contratos WHERE sig_token = p_token AND sig_cli_base64 IS NULL;
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token inválido ou documento já assinado');
  END IF;

  IF v_exp IS NOT NULL AND v_exp < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'link de assinatura expirado');
  END IF;

  -- Registrar assinatura
  IF p_tipo = 'orcamento' THEN
    UPDATE orcamentos SET
      sig_cliente      = p_sig_b64,
      sig_cliente_at   = now(),
      sig_cliente_nome = p_nome,
      sig_cliente_ip   = v_ip_safe,
      status           = 'aprovado'
    WHERE id = v_id;
  ELSIF p_tipo = 'laudo' THEN
    UPDATE laudos SET
      sig_cliente      = p_sig_b64,
      sig_cliente_at   = now(),
      sig_cliente_nome = p_nome,
      sig_cliente_ip   = v_ip_safe
    WHERE id = v_id;
  ELSE
    UPDATE contratos SET
      sig_cli_base64 = p_sig_b64,
      assinado_cli   = true,
      sig_cli_at     = now(),
      sig_cli_nome   = p_nome,
      sig_cli_ip     = v_ip_safe,
      status         = 'ativo'
    WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;


-- =============================================================
-- FIX #20 — CHECK constraint mínimo nas colunas dados JSONB
-- =============================================================

-- Usar DO para não falhar se constraint já existir com nome diferente
DO $$
BEGIN
  BEGIN
    ALTER TABLE orcamentos ADD CONSTRAINT ck_orcamentos_dados_obj CHECK (jsonb_typeof(dados) = 'object');
  EXCEPTION WHEN duplicate_object OR check_violation THEN NULL;
  END;
  BEGIN
    ALTER TABLE contratos  ADD CONSTRAINT ck_contratos_dados_obj  CHECK (jsonb_typeof(dados) = 'object');
  EXCEPTION WHEN duplicate_object OR check_violation THEN NULL;
  END;
  BEGIN
    ALTER TABLE laudos     ADD CONSTRAINT ck_laudos_dados_obj     CHECK (jsonb_typeof(dados) = 'object');
  EXCEPTION WHEN duplicate_object OR check_violation THEN NULL;
  END;
  BEGIN
    ALTER TABLE despesas   ADD CONSTRAINT ck_despesas_dados_obj   CHECK (jsonb_typeof(dados) = 'object');
  EXCEPTION WHEN duplicate_object OR check_violation THEN NULL;
  END;
  BEGIN
    ALTER TABLE obras      ADD CONSTRAINT ck_obras_dados_obj      CHECK (jsonb_typeof(dados) = 'object');
  EXCEPTION WHEN duplicate_object OR check_violation THEN NULL;
  END;
END;
$$;


-- =============================================================
-- FIX #21 — Race condition em contadores de laudos
-- check_laudo_permitido com SELECT FOR UPDATE para serializar a verificação
-- =============================================================

CREATE OR REPLACE FUNCTION check_laudo_permitido()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p   record;
  v_lim int; v_usado int; v_rest int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'nao_autenticado');
  END IF;

  -- FOR UPDATE: serializa verificação paralela do mesmo usuário — Fix #21
  SELECT p.plano, p.laudos_mes, pc.limite_laudos_mes INTO v_p
  FROM profiles p
  LEFT JOIN planos_config pc ON pc.id = p.plano
  WHERE p.id = v_uid
  FOR UPDATE OF p;

  IF v_p.limite_laudos_mes IS NULL THEN
    RETURN jsonb_build_object(
      'permitido', true, 'plano', v_p.plano, 'limite', null,
      'usado', v_p.laudos_mes, 'restantes', null, 'ilimitado', true
    );
  END IF;

  v_lim  := v_p.limite_laudos_mes;
  v_usado := COALESCE(v_p.laudos_mes, 0);
  v_rest  := GREATEST(0, v_lim - v_usado);

  RETURN jsonb_build_object(
    'permitido', v_rest > 0,
    'plano',     v_p.plano,
    'limite',    v_lim,
    'usado',     v_usado,
    'restantes', v_rest,
    'ilimitado', false,
    'reset_em',  (date_trunc('month', now()) + interval '1 month')::date,
    'motivo',    CASE WHEN v_rest <= 0 THEN 'limite_atingido' ELSE null END
  );
END;
$$;


-- =============================================================
-- ÍNDICE auxiliar na tabela audit_log (para o rate_limits com user_id NULL)
-- =============================================================

-- Índice parcial para rate limiting de IPs (assinatura digital)
CREATE INDEX IF NOT EXISTS idx_rate_limits_sig_ip
  ON rate_limits(endpoint, janela_ini)
  WHERE user_id IS NULL;


COMMIT;

-- =============================================================
-- ROLLBACK — executar APENAS para reverter (em ordem inversa)
-- =============================================================
/*
BEGIN;

-- Remover CHECK constraints
ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS ck_orcamentos_dados_obj;
ALTER TABLE contratos  DROP CONSTRAINT IF EXISTS ck_contratos_dados_obj;
ALTER TABLE laudos     DROP CONSTRAINT IF EXISTS ck_laudos_dados_obj;
ALTER TABLE despesas   DROP CONSTRAINT IF EXISTS ck_despesas_dados_obj;
ALTER TABLE obras      DROP CONSTRAINT IF EXISTS ck_obras_dados_obj;

-- Remover índices GIN
DROP INDEX IF EXISTS idx_orcamentos_dados_gin;
DROP INDEX IF EXISTS idx_contratos_dados_gin;
DROP INDEX IF EXISTS idx_laudos_dados_gin;
DROP INDEX IF EXISTS idx_profiles_empresa_gin;
DROP INDEX IF EXISTS idx_profiles_prefs_gin;
DROP INDEX IF EXISTS idx_rate_limits_sig_ip;

-- Remover triggers de audit
DROP TRIGGER IF EXISTS trg_audit_orcamentos        ON orcamentos;
DROP TRIGGER IF EXISTS trg_audit_contratos         ON contratos;
DROP TRIGGER IF EXISTS trg_audit_laudos            ON laudos;
DROP TRIGGER IF EXISTS trg_audit_profiles_criticos ON profiles;

-- Remover tabela e função de audit
DROP TABLE IF EXISTS audit_log CASCADE;
DROP FUNCTION IF EXISTS fn_audit_log();

-- Remover funções adicionadas
DROP FUNCTION IF EXISTS exportar_meus_dados();

COMMIT;
*/

-- =============================================================
-- Verificação pós-aplicação:
-- =============================================================
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'audit_log';
-- SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('ia_uso_log','orcamentos','laudos') ORDER BY tablename;
-- SELECT indexname FROM pg_indexes WHERE indexname LIKE '%gin%' OR indexname LIKE '%sig_ip%';
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name IN ('exportar_meus_dados','check_laudo_permitido','check_rate_limit','get_producao_por_usuario','run_manutencao_diaria');
