-- ============================================================
-- MestrePro Migration — 2026-05-21 — Tabelas IA Pro
-- Supabase Project: ufdrxucvyukgzvenfuhj
-- Execute no: Supabase Dashboard → SQL Editor
-- ============================================================

BEGIN;

-- ── 1. Log de uso das features IA ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ia_uso_log (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature       text        NOT NULL,  -- 'ia_orcamento' | 'ia_mensagem' | 'ia_diagnostico' | etc.
  tokens_usados int         DEFAULT 0,
  sucesso       boolean     DEFAULT true,
  erro          text,
  criado_em     timestamptz DEFAULT now()
);

ALTER TABLE ia_uso_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_read_log" ON ia_uso_log;
CREATE POLICY "owner_read_log" ON ia_uso_log
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_all_log" ON ia_uso_log;
CREATE POLICY "admin_all_log" ON ia_uso_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_ia_uso_log_user_feature
  ON ia_uso_log(user_id, feature, criado_em DESC);

-- ── 2. Follow-ups automáticos agendados ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ia_followup_agendados (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  orcamento_id          uuid,       -- referência ao orçamento (pode ser null se excluído)
  nome_cliente          text        NOT NULL,
  mensagem_gerada       text        NOT NULL,
  dias_apos_envio       int         DEFAULT 2,
  data_envio_agendada   timestamptz NOT NULL,
  enviado_em            timestamptz,
  status                text        DEFAULT 'pendente',  -- 'pendente' | 'enviado' | 'cancelado'
  criado_em             timestamptz DEFAULT now()
);

ALTER TABLE ia_followup_agendados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all_followup" ON ia_followup_agendados;
CREATE POLICY "owner_all_followup" ON ia_followup_agendados
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_followup_user_status
  ON ia_followup_agendados(user_id, status, data_envio_agendada);

-- ── 3. RPC: Estatísticas de uso IA do usuário ─────────────────────────────
CREATE OR REPLACE FUNCTION obter_stats_ia(p_periodo_dias int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_inicio   timestamptz := now() - (p_periodo_dias || ' days')::interval;
  v_stats    jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT jsonb_build_object(
    'total_usos', COUNT(*),
    'total_tokens', COALESCE(SUM(tokens_usados), 0),
    'por_feature', jsonb_object_agg(feature, cnt)
  ) INTO v_stats
  FROM (
    SELECT feature, COUNT(*) AS cnt
    FROM ia_uso_log
    WHERE user_id = v_user_id
      AND criado_em >= v_inicio
      AND sucesso = true
    GROUP BY feature
  ) sub;

  RETURN COALESCE(v_stats, '{"total_usos":0,"total_tokens":0,"por_feature":{}}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION obter_stats_ia TO authenticated;

-- ── 4. RPC: Verificar quota de IA (limite mensal por plano) ───────────────
CREATE OR REPLACE FUNCTION verificar_quota_ia(p_feature text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_plano    text;
  v_usos_mes int;
  v_limite   int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT plano INTO v_plano FROM profiles WHERE id = v_user_id;

  -- Limite mensal por plano
  v_limite := CASE v_plano
    WHEN 'ia-pro'  THEN 500   -- 500 usos/mês
    WHEN 'equipe'  THEN 100   -- 100 usos/mês (acesso parcial)
    ELSE 0
  END;

  SELECT COUNT(*) INTO v_usos_mes
  FROM ia_uso_log
  WHERE user_id = v_user_id
    AND feature = p_feature
    AND sucesso = true
    AND criado_em >= date_trunc('month', now());

  RETURN jsonb_build_object(
    'permitido',     v_usos_mes < v_limite,
    'usos_mes',      v_usos_mes,
    'limite_mes',    v_limite,
    'restante',      GREATEST(0, v_limite - v_usos_mes),
    'plano',         v_plano
  );
END;
$$;

GRANT EXECUTE ON FUNCTION verificar_quota_ia TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK — executar APENAS para reverter
-- ============================================================
-- BEGIN;
-- DROP TABLE IF EXISTS ia_followup_agendados CASCADE;
-- DROP TABLE IF EXISTS ia_uso_log CASCADE;
-- DROP FUNCTION IF EXISTS obter_stats_ia;
-- DROP FUNCTION IF EXISTS verificar_quota_ia;
-- COMMIT;

-- ============================================================
-- Verificação pós-aplicação:
-- ============================================================
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' AND tablename IN ('ia_uso_log', 'ia_followup_agendados');
--
-- SELECT policyname FROM pg_policies
--   WHERE tablename IN ('ia_uso_log', 'ia_followup_agendados');
--
-- SELECT routine_name FROM information_schema.routines
--   WHERE routine_schema = 'public' AND routine_name IN ('obter_stats_ia', 'verificar_quota_ia');
