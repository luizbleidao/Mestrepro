-- Migration: Campos de consentimento LGPD nos perfis de usuário
-- Data: 2026-05-30
-- Finalidade: Registrar prova de aceite dos Termos de Uso e opt-in de marketing
--             para conformidade com LGPD Art. 7 (base legal: consentimento)

-- ── Colunas de consentimento na tabela profiles ────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consentimento_termos_em    timestamptz,
  ADD COLUMN IF NOT EXISTS consentimento_termos_ip    text,
  ADD COLUMN IF NOT EXISTS consentimento_marketing    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consentimento_marketing_em timestamptz;

COMMENT ON COLUMN profiles.consentimento_termos_em    IS 'Data/hora em que o usuário aceitou os Termos de Uso e Política de Privacidade (LGPD Art. 7 I)';
COMMENT ON COLUMN profiles.consentimento_termos_ip    IS 'IP do usuário no momento do aceite — para fins de auditoria';
COMMENT ON COLUMN profiles.consentimento_marketing    IS 'Opt-in para comunicações de marketing por e-mail';
COMMENT ON COLUMN profiles.consentimento_marketing_em IS 'Data/hora do opt-in de marketing';

-- ── Índice para consultas de auditoria ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_consentimento_termos
  ON profiles (consentimento_termos_em)
  WHERE consentimento_termos_em IS NOT NULL;

-- ── RPC: revogar consentimento de marketing (LGPD Art. 18 IX) ─────────────

CREATE OR REPLACE FUNCTION revogar_consentimento_marketing()
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Não autenticado');
  END IF;

  UPDATE profiles
  SET consentimento_marketing    = false,
      consentimento_marketing_em = now()
  WHERE id = auth.uid();

  RETURN json_build_object('ok', true);
END;
$$;

-- ── Backfill: usuários existentes (aceite implícito antes do checkbox) ─────
-- Marca data de criação como data de consentimento para usuários antigos
-- (base legal retroativa: execução de contrato — Art. 7 V)

UPDATE profiles
SET consentimento_termos_em = COALESCE(criado_em, now()),
    consentimento_marketing  = true,
    consentimento_marketing_em = COALESCE(criado_em, now())
WHERE consentimento_termos_em IS NULL;

-- ── ROLLBACK (comentado) ──────────────────────────────────────────────────
-- ALTER TABLE profiles
--   DROP COLUMN IF EXISTS consentimento_termos_em,
--   DROP COLUMN IF EXISTS consentimento_termos_ip,
--   DROP COLUMN IF EXISTS consentimento_marketing,
--   DROP COLUMN IF EXISTS consentimento_marketing_em;
-- DROP FUNCTION IF EXISTS revogar_consentimento_marketing();
