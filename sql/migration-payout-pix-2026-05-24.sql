-- ============================================================
-- MestrePro — Migration: Payout PIX automático para referrers
-- Data: 2026-05-24
-- Rollback: ver seção ROLLBACK ao final
-- ============================================================

-- ── 1. NOVAS COLUNAS NA TABELA indicacoes ───────────────────
ALTER TABLE public.indicacoes
  ADD COLUMN IF NOT EXISTS payout_status   text DEFAULT 'pendente'
    CHECK (payout_status IN ('pendente','processando','enviado','falhou','nao_aplicavel')),
  ADD COLUMN IF NOT EXISTS payout_mp_id    text,          -- ID do pagamento MP de saída
  ADD COLUMN IF NOT EXISTS payout_erro     text,          -- motivo de falha (se falhou)
  ADD COLUMN IF NOT EXISTS payout_tentativas int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_em       timestamptz;   -- data do envio bem-sucedido

-- Índice para facilitar busca de payouts pendentes
CREATE INDEX IF NOT EXISTS idx_indicacoes_payout_status
  ON public.indicacoes(payout_status)
  WHERE payout_status IN ('pendente','falhou');

-- ── 2. Atualizar creditar_comissao para retornar indicacao_id ───────────
-- O webhook precisa do ID da indicação para chamar pagar-comissao
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
    status         = 'pago',
    plano_contratado = p_plano,
    comissao_brl   = v_comissao,
    valor_pago_brl = p_valor_pago,
    pago_em        = now()
  WHERE id = v_row.id;

  -- ⬇ indicacao_id adicionado para o webhook poder chamar pagar-comissao
  RETURN json_build_object(
    'ok',           true,
    'indicacao_id', v_row.id,
    'comissao_brl', v_comissao,
    'referrer_id',  v_row.referrer_id
  );
END;
$$;

-- ── 3. RPC: marcar_payout ────────────────────────────────────
-- Chamada pela Edge Function pagar-comissao após tentar o PIX
CREATE OR REPLACE FUNCTION public.marcar_payout(
  p_indicacao_id  uuid,
  p_status        text,   -- 'enviado' | 'falhou' | 'nao_aplicavel'
  p_mp_id         text DEFAULT NULL,
  p_erro          text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE indicacoes SET
    payout_status     = p_status,
    payout_mp_id      = COALESCE(p_mp_id, payout_mp_id),
    payout_erro       = p_erro,
    payout_tentativas = payout_tentativas + 1,
    payout_em         = CASE WHEN p_status = 'enviado' THEN now() ELSE payout_em END,
    atualizado_em     = now()
  WHERE id = p_indicacao_id;
END;
$$;

-- ── 4. RPC: listar_payouts_pendentes ─────────────────────────
-- Chamada pelo painel admin para reprocessar falhas manualmente
CREATE OR REPLACE FUNCTION public.listar_payouts_pendentes()
RETURNS TABLE (
  id              uuid,
  referrer_id     uuid,
  referrer_email  text,
  referrer_pix    text,
  comissao_brl    numeric,
  payout_status   text,
  payout_tentativas int,
  payout_erro     text,
  pago_em         timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Apenas service_role (admin) pode chamar
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
    SELECT
      i.id,
      i.referrer_id,
      u.email::text,
      (p.empresa_data->>'pixChave')::text,
      i.comissao_brl,
      i.payout_status,
      i.payout_tentativas,
      i.payout_erro,
      i.pago_em
    FROM indicacoes i
    JOIN auth.users u ON u.id = i.referrer_id
    LEFT JOIN profiles p ON p.id = i.referrer_id
    WHERE i.payout_status IN ('pendente', 'falhou')
      AND i.status = 'pago'
      AND i.comissao_brl > 0
    ORDER BY i.pago_em DESC;
END;
$$;

-- ── ROLLBACK ─────────────────────────────────────────────────
-- ALTER TABLE public.indicacoes
--   DROP COLUMN IF EXISTS payout_status,
--   DROP COLUMN IF EXISTS payout_mp_id,
--   DROP COLUMN IF EXISTS payout_erro,
--   DROP COLUMN IF EXISTS payout_tentativas,
--   DROP COLUMN IF EXISTS payout_em;
-- DROP FUNCTION IF EXISTS public.marcar_payout(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.listar_payouts_pendentes();
