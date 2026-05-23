-- ================================================================
-- Migration: Verificação anti-abuso por CPF
-- Data: 2026-05-23
-- Objetivo: Impedir criação de múltiplas contas trial por pessoa
--           usando CPF como identificador único (sem WhatsApp OTP)
-- ================================================================

-- 1. Colunas em profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cpf              text,
  ADD COLUMN IF NOT EXISTS cpf_verificado   boolean NOT NULL DEFAULT false;

-- 2. Índice único: 1 CPF por conta ativa
--    (impede múltiplos trials com o mesmo CPF)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_cpf_unico
  ON profiles(cpf)
  WHERE cpf IS NOT NULL;

-- 3. RPC pública: verifica se CPF já tem conta (chamada antes do signup)
CREATE OR REPLACE FUNCTION verificar_cpf_disponivel(p_cpf text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Retorna TRUE se CPF está disponível, FALSE se já cadastrado
  RETURN NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE cpf = p_cpf
  );
END;
$$;

-- Permite chamada pela chave anon (necessário para verificar antes de criar conta)
GRANT EXECUTE ON FUNCTION verificar_cpf_disponivel TO anon;
GRANT EXECUTE ON FUNCTION verificar_cpf_disponivel TO authenticated;
