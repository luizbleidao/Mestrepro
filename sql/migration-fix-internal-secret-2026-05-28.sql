-- ================================================================
-- Migration: Adicionar x-internal-secret nas chamadas HTTP internas
-- Data: 2026-05-28
-- Contexto:
--   emails-automaticos e email-sender agora exigem x-internal-secret
--   header para autenticação. Esta migration atualiza:
--   1. Configuração de database para armazenar INTERNAL_SECRET
--   2. Função _enviar_email_automatico para passar o header
--   3. Recriar cron job email-sender com o header correto
-- ================================================================

-- ATENÇÃO: substitua <SUA_INTERNAL_SECRET> pelo valor real antes de executar.
-- A mesma string deve estar configurada como secret INTERNAL_SECRET
-- em Supabase → Edge Functions → Secrets.

-- ── 1. Salvar INTERNAL_SECRET como setting de banco ──────────
-- Permite que funções plpgsql acessem via current_setting()
-- ALTER DATABASE postgres SET app.internal_secret = '<SUA_INTERNAL_SECRET>';
-- (Execute manualmente no SQL Editor pois DDL em transaction não suporta SET)

-- ── 2. Atualizar _enviar_email_automatico com x-internal-secret ──
CREATE OR REPLACE FUNCTION public._enviar_email_automatico(
  p_tipo  text,
  p_email text,
  p_nome  text,
  p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url             text;
  v_service_key     text;
  v_internal_secret text;
BEGIN
  -- Evita reenvio duplicado nas últimas 24h
  IF EXISTS (
    SELECT 1 FROM public.email_log
    WHERE tipo = p_tipo AND email = p_email
      AND enviado_em > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  v_url             := current_setting('app.edge_function_url', true) || '/emails-automaticos';
  v_service_key     := current_setting('app.service_role_key', true);
  v_internal_secret := current_setting('app.internal_secret', true);

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'Authorization',     'Bearer ' || v_service_key,
      'x-internal-secret', v_internal_secret
    ),
    body    := jsonb_build_object(
      'tipo',  p_tipo,
      'email', p_email,
      'nome',  p_nome,
      'dados', p_dados
    )::text
  );

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.email_log (tipo, email, nome, erro)
  VALUES (p_tipo, p_email, p_nome, SQLERRM);
END;
$$;

-- ── 3. Recriar cron job email-sender com x-internal-secret ──
-- Remove job atual e recria com header correto.
-- Substitua <SERVICE_ROLE_KEY> e <INTERNAL_SECRET> pelos valores reais.
--
-- SELECT cron.unschedule('mestrepro-email-sender');
-- SELECT cron.schedule(
--   'mestrepro-email-sender',
--   '0 9,12,18 * * *',
--   $$
--     SELECT net.http_post(
--       url := 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/email-sender',
--       headers := jsonb_build_object(
--         'Authorization',     'Bearer <SERVICE_ROLE_KEY>',
--         'Content-Type',      'application/json',
--         'x-internal-secret', current_setting('app.internal_secret', true)
--       ),
--       body := '{}'::jsonb
--     );
--   $$
-- );

-- ================================================================
-- ROLLBACK:
-- ================================================================
-- CREATE OR REPLACE FUNCTION public._enviar_email_automatico(...)
-- (versão anterior sem x-internal-secret — ver migration-pgcron-emails-2026-05-24.sql)
