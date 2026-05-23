-- ================================================================
-- Migration: Verificação de WhatsApp por OTP
-- Data: 2026-05-22
-- Objetivo: Impedir criação de múltiplos trials por pessoa
--           exigindo verificação de número de celular único
-- ================================================================

-- 1. Tabela de OTPs
CREATE TABLE IF NOT EXISTS otp_verificacoes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  telefone    text        NOT NULL,
  codigo_hash text        NOT NULL,        -- HMAC-SHA256 do código
  tentativas  int         NOT NULL DEFAULT 0,
  expira_em   timestamptz NOT NULL,
  usado       boolean     NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_telefone_expira ON otp_verificacoes(telefone, expira_em);
CREATE INDEX IF NOT EXISTS idx_otp_limpeza ON otp_verificacoes(expira_em) WHERE NOT usado;

-- RLS: apenas funções SECURITY DEFINER acessam essa tabela
ALTER TABLE otp_verificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "otp_sem_acesso_direto" ON otp_verificacoes FOR ALL USING (false);

-- 2. Colunas em profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS whatsapp_verificado    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_verificado_em timestamptz;

-- 3. Índice para garantir unicidade de número verificado por trial ativo
-- (impede múltiplos trials no mesmo número)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_whatsapp_trial_unico
  ON profiles(whatsapp)
  WHERE whatsapp IS NOT NULL
    AND whatsapp_verificado = true
    AND plano IN ('trial', 'gratuito', 'basico', 'pro', 'equipe', 'ia-pro');

-- 4. Limpeza automática de OTPs expirados (rodada pelo run_manutencao_diaria)
CREATE OR REPLACE FUNCTION limpar_otps_expirados()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total int;
BEGIN
  DELETE FROM otp_verificacoes WHERE expira_em < now() - interval '1 hour';
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;
