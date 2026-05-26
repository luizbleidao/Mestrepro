-- ============================================================
-- MestrePro — Migration: Comissão de indicações fixada em 20%
-- Data: 2026-05-26
-- Motivo: Unificar comissão para 20% em todos os planos
-- ============================================================

-- ── 1. Atualizar a função registrar_indicacao ─────────────────
-- Remove a lógica de comissão diferenciada por plano (era 30% para equipe/ia_pro)
-- Todos os indicadores recebem 20%

CREATE OR REPLACE FUNCTION public.registrar_indicacao(p_ref_code text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id uuid;
  v_referrer_email text;
BEGIN
  -- Busca o dono do ref_code
  SELECT id INTO v_referrer_id
  FROM public.profiles
  WHERE ref_code = p_ref_code
  LIMIT 1;

  IF v_referrer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'ref_code inválido');
  END IF;

  -- Evita auto-indicação
  IF v_referrer_id = auth.uid() THEN
    RETURN json_build_object('ok', false, 'erro', 'Você não pode usar seu próprio link de indicação');
  END IF;

  -- Evita duplicata (mesmo indicado, mesmo referrer)
  IF EXISTS (
    SELECT 1 FROM public.indicacoes
    WHERE indicado_id = auth.uid() AND referrer_id = v_referrer_id
  ) THEN
    RETURN json_build_object('ok', false, 'erro', 'Indicação já registrada');
  END IF;

  -- Registra com 20% fixo para todos os planos
  INSERT INTO public.indicacoes (
    ref_code, status, comissao_pct,
    referrer_id, indicado_id, criado_em
  ) VALUES (
    p_ref_code, 'cadastrado', 20.00,
    v_referrer_id, auth.uid(), now()
  );

  RETURN json_build_object('ok', true, 'referrer_id', v_referrer_id, 'comissao_pct', 20.00);
END;
$$;

-- ── 2. Corrigir registros existentes com 30% → 20% ────────────
-- Apenas indicações ainda não pagas (status diferente de 'pago')
UPDATE public.indicacoes
SET comissao_pct = 20.00
WHERE comissao_pct = 30.00
  AND status != 'pago';

-- ── ROLLBACK ─────────────────────────────────────────────────
-- Para reverter: basta alterar a função acima de volta para o CASE
-- e restaurar registros se necessário via backup.
