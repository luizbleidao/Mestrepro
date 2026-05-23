-- ============================================================
-- MestrePro — Migration: Sistema de Indicações / Afiliados
-- Data: 2026-05-23
-- Rollback: ver seção ROLLBACK ao final do arquivo
-- ============================================================

-- ── 1. TABELA PRINCIPAL ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.indicacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  indicado_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  indicado_email   text,                         -- guardado no momento do cadastro
  ref_code         text NOT NULL,                -- código curto de 8 chars (UID slice)
  status           text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','cadastrado','ativo','pago','expirado')),
  plano_contratado text,                         -- slug do plano que o indicado assinou
  comissao_pct     numeric(5,2) DEFAULT 20.00,   -- % de comissão
  comissao_brl     numeric(10,2) DEFAULT 0.00,   -- valor calculado em R$
  valor_pago_brl   numeric(10,2),                -- valor do pagamento do indicado
  pago_em          timestamptz,                  -- data do crédito da comissão
  expira_em        timestamptz DEFAULT (now() + interval '90 days'),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. ÍNDICES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_indicacoes_referrer  ON public.indicacoes(referrer_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_indicado  ON public.indicacoes(indicado_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_ref_code  ON public.indicacoes(ref_code);
CREATE INDEX IF NOT EXISTS idx_indicacoes_status    ON public.indicacoes(status);

-- ── 3. ROW LEVEL SECURITY ────────────────────────────────────
ALTER TABLE public.indicacoes ENABLE ROW LEVEL SECURITY;

-- Referrer vê apenas suas próprias indicações
CREATE POLICY "referrer_ve_suas_indicacoes"
  ON public.indicacoes FOR SELECT
  USING (auth.uid() = referrer_id);

-- Indicado vê o próprio registro
CREATE POLICY "indicado_ve_seu_registro"
  ON public.indicacoes FOR SELECT
  USING (auth.uid() = indicado_id);

-- Apenas service role faz INSERT/UPDATE (via Edge Function / webhook)
CREATE POLICY "service_role_gerencia_indicacoes"
  ON public.indicacoes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 4. TRIGGER — atualizar atualizado_em automaticamente ────
CREATE OR REPLACE FUNCTION public.trg_set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_indicacoes_atualizado_em ON public.indicacoes;
CREATE TRIGGER trg_indicacoes_atualizado_em
  BEFORE UPDATE ON public.indicacoes
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_atualizado_em();

-- ── 5. RPC: registrar_indicacao ──────────────────────────────
-- Chamada pelo Edge Function quando um usuário se cadastra via ref_code
CREATE OR REPLACE FUNCTION public.registrar_indicacao(
  p_ref_code      text,
  p_indicado_id   uuid,
  p_indicado_email text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_plano       text;
  v_pct         numeric;
  v_result      json;
BEGIN
  -- Localiza referrer pelo código
  SELECT referrer_id INTO v_referrer_id
  FROM indicacoes
  WHERE ref_code = p_ref_code
    AND status = 'pendente'
    AND expira_em > now()
  LIMIT 1;

  -- Se não encontrou pendente, busca o referrer pelo código sem filtro de status
  -- (para criar um novo registro caso o código seja válido)
  IF v_referrer_id IS NULL THEN
    -- O ref_code é os 8 primeiros chars sem hífen do UID do referrer
    SELECT id INTO v_referrer_id
    FROM auth.users
    WHERE replace(id::text, '-', '') ILIKE (p_ref_code || '%')
    LIMIT 1;
  END IF;

  IF v_referrer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Código de indicação inválido ou expirado');
  END IF;

  -- Não permite auto-indicação
  IF v_referrer_id = p_indicado_id THEN
    RETURN json_build_object('ok', false, 'erro', 'Auto-indicação não permitida');
  END IF;

  -- Verifica se o indicado já tem registro
  IF EXISTS (SELECT 1 FROM indicacoes WHERE indicado_id = p_indicado_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Usuário já possui indicação registrada');
  END IF;

  -- Calcula % de comissão conforme plano do referrer
  SELECT COALESCE(a.plano, 'gratuito') INTO v_plano
  FROM assinaturas a WHERE a.usuario_id = v_referrer_id;

  v_pct := CASE
    WHEN v_plano IN ('equipe', 'ia-pro', 'ia_pro') THEN 30.00
    WHEN v_plano IN ('pro') THEN 25.00
    ELSE 20.00
  END;

  -- Insere o registro
  INSERT INTO indicacoes (
    referrer_id, indicado_id, indicado_email,
    ref_code, status, comissao_pct,
    expira_em
  ) VALUES (
    v_referrer_id, p_indicado_id, p_indicado_email,
    p_ref_code, 'cadastrado', v_pct,
    now() + interval '90 days'
  );

  RETURN json_build_object('ok', true, 'referrer_id', v_referrer_id, 'comissao_pct', v_pct);
END;
$$;

-- ── 6. RPC: creditar_comissao ────────────────────────────────
-- Chamada pelo webhook do Mercado Pago quando pagamento confirmado
CREATE OR REPLACE FUNCTION public.creditar_comissao(
  p_indicado_id   uuid,
  p_valor_pago    numeric,
  p_plano         text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row indicacoes%ROWTYPE;
  v_comissao numeric;
BEGIN
  SELECT * INTO v_row
  FROM indicacoes
  WHERE indicado_id = p_indicado_id
    AND status IN ('cadastrado', 'ativo')
  ORDER BY criado_em DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'msg', 'Sem indicação ativa para este usuário');
  END IF;

  v_comissao := round((p_valor_pago * v_row.comissao_pct / 100)::numeric, 2);

  UPDATE indicacoes SET
    status = 'pago',
    plano_contratado = p_plano,
    comissao_brl = v_comissao,
    valor_pago_brl = p_valor_pago,
    pago_em = now()
  WHERE id = v_row.id;

  RETURN json_build_object('ok', true, 'comissao_brl', v_comissao, 'referrer_id', v_row.referrer_id);
END;
$$;

-- ── 7. RPC: meu_programa_indicacao ───────────────────────────
-- Chamada pelo frontend para mostrar stats do painel de indicação
CREATE OR REPLACE FUNCTION public.meu_programa_indicacao()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_ref   text;
  v_total int;
  v_ativos int;
  v_comissao numeric;
BEGIN
  -- Código de referral = primeiros 8 chars do UID sem hífens, maiúsculo
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

-- ── ROLLBACK ─────────────────────────────────────────────────
-- Para reverter esta migration execute:
-- DROP TABLE IF EXISTS public.indicacoes CASCADE;
-- DROP FUNCTION IF EXISTS public.registrar_indicacao(text, uuid, text);
-- DROP FUNCTION IF EXISTS public.creditar_comissao(uuid, numeric, text);
-- DROP FUNCTION IF EXISTS public.meu_programa_indicacao();
-- (trg_set_atualizado_em pode ser usado por outras tabelas, verifique antes de dropar)
