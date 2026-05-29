-- =============================================================
-- Migration: migration-fix-bugs-2026-05-29
-- Corrige: tabela assinaturas para admin + colunas recibos
-- =============================================================

-- 1. Tabela assinaturas (usada no admin panel para gerenciar planos)
--    Criada como tabela de controle de assinaturas por usuário.
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plano        text        NOT NULL DEFAULT 'gratuito',
  status       text        NOT NULL DEFAULT 'ativo',
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_user_unique UNIQUE (user_id)
);

ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;

-- Usuário lê sua própria assinatura
DROP POLICY IF EXISTS "assinaturas_owner_read" ON public.assinaturas;
CREATE POLICY "assinaturas_owner_read"
  ON public.assinaturas FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin tem acesso total
DROP POLICY IF EXISTS "assinaturas_admin_all" ON public.assinaturas;
CREATE POLICY "assinaturas_admin_all"
  ON public.assinaturas FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Sincronizar assinaturas com os planos atuais de profiles
-- (popula a tabela para os usuários já existentes)
INSERT INTO public.assinaturas (user_id, plano, status)
SELECT p.id, p.plano, CASE WHEN p.plano = 'gratuito' THEN 'inativo' ELSE 'ativo' END
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.assinaturas a WHERE a.user_id = p.id
)
ON CONFLICT (user_id) DO NOTHING;

-- Trigger para manter assinaturas sincronizadas quando profiles.plano muda
CREATE OR REPLACE FUNCTION sync_assinatura_on_plano_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.plano IS DISTINCT FROM OLD.plano THEN
    INSERT INTO public.assinaturas (user_id, plano, status, atualizado_em)
    VALUES (NEW.id, NEW.plano, CASE WHEN NEW.plano = 'gratuito' THEN 'inativo' ELSE 'ativo' END, now())
    ON CONFLICT (user_id) DO UPDATE
      SET plano = EXCLUDED.plano,
          status = EXCLUDED.status,
          atualizado_em = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_assinatura ON public.profiles;
CREATE TRIGGER trg_sync_assinatura
  AFTER UPDATE OF plano ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION sync_assinatura_on_plano_change();

-- 2. Colunas faltantes em recibos (existem em migration-000 mas podem faltar em produção)
ALTER TABLE public.recibos ADD COLUMN IF NOT EXISTS cli_doc   text;
ALTER TABLE public.recibos ADD COLUMN IF NOT EXISTS data_pgto date;
