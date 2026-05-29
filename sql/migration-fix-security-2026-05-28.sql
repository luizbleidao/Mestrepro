-- ================================================================
-- Migration: Fix de segurança — auditoria 2026-05-28
-- Objetivo:
--   1. Adicionar SET search_path = public em verificar_cpf_disponivel
--      (previne search_path injection em SECURITY DEFINER functions)
--   2. Remover função duplicada registrar_indicacao (3 parâmetros)
--      mantendo apenas a versão com 1 parâmetro (usa auth.uid())
-- ================================================================

-- ── FIX 1: verificar_cpf_disponivel — adicionar SET search_path ──
CREATE OR REPLACE FUNCTION public.verificar_cpf_disponivel(p_cpf text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM profiles WHERE cpf = p_cpf
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verificar_cpf_disponivel(text) TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_cpf_disponivel(text) TO authenticated;

-- ── FIX 2: remover versão antiga de registrar_indicacao (3 params) ──
-- A versão com 3 parâmetros conflita com a versão atual (1 parâmetro).
-- Verificar se a assinatura abaixo existe antes de dropar:
DROP FUNCTION IF EXISTS public.registrar_indicacao(text, uuid, text);

-- ================================================================
-- ROLLBACK (desfazer se necessário):
-- ================================================================
-- CREATE OR REPLACE FUNCTION public.verificar_cpf_disponivel(p_cpf text)
-- RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   RETURN NOT EXISTS (SELECT 1 FROM profiles WHERE cpf = p_cpf);
-- END; $$;
