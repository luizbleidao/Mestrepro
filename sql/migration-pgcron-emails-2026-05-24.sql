-- ============================================================
-- MestrePro — Migration: Ativar pg_cron para emails automáticos
-- Data: 2026-05-24
-- ============================================================
-- PRÉ-REQUISITOS (faça isso antes de rodar este arquivo):
--
--  1. Habilite pg_cron no Supabase:
--     Supabase Dashboard → Database → Extensions → pg_cron → Enable
--
--  2. Configure as settings de banco (substitua pelos valores reais):
--     Execute no SQL Editor do Supabase:
--
--       ALTER DATABASE postgres
--         SET app.edge_function_url = 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1';
--
--       ALTER DATABASE postgres
--         SET app.service_role_key = '<SUA_SERVICE_ROLE_KEY>';
--
--  3. Certifique-se de que a Edge Function emails-automaticos está ACTIVE:
--     supabase functions deploy emails-automaticos --no-verify-jwt
--
-- ============================================================

-- ── 1. Função auxiliar para chamada HTTP via pg_net ──────────
-- (necessária para _enviar_email_automatico funcionar via cron)
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
  v_url         text;
  v_service_key text;
BEGIN
  -- Evita reenvio duplicado nas últimas 24h
  IF EXISTS (
    SELECT 1 FROM public.email_log
    WHERE tipo = p_tipo AND email = p_email
      AND enviado_em > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  v_url         := current_setting('app.edge_function_url', true) || '/emails-automaticos';
  v_service_key := current_setting('app.service_role_key', true);

  -- Chama via pg_net (assíncrono — não bloqueia a transação)
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := jsonb_build_object(
      'tipo',  p_tipo,
      'email', p_email,
      'nome',  p_nome,
      'dados', p_dados
    )::text
  );

EXCEPTION WHEN OTHERS THEN
  -- Registra falha sem bloquear o cron
  INSERT INTO public.email_log (tipo, email, nome, erro)
  VALUES (p_tipo, p_email, p_nome, SQLERRM);
END;
$$;

-- ── 2. Trigger: email de boas-vindas ao cadastrar ────────────
CREATE OR REPLACE FUNCTION public.trg_email_boas_vindas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_nome text;
BEGIN
  v_nome := COALESCE(
    (SELECT nome FROM public.profiles WHERE id = NEW.id LIMIT 1),
    split_part(NEW.email, '@', 1)
  );
  PERFORM public._enviar_email_automatico('boas_vindas', NEW.email, v_nome);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- Nunca bloquear o cadastro
END;
$$;

DROP TRIGGER IF EXISTS trg_boas_vindas_email ON auth.users;
CREATE TRIGGER trg_boas_vindas_email
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_boas_vindas();

-- ── 3. Trigger: confirmação quando plano é ativado ───────────
CREATE OR REPLACE FUNCTION public.trg_email_confirmacao_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email text; v_nome text; v_plano_nome text;
BEGIN
  IF NEW.plano = OLD.plano THEN RETURN NEW; END IF;
  IF NEW.plano NOT IN ('pro','equipe','ia-pro','ia_pro') THEN RETURN NEW; END IF;

  SELECT u.email, COALESCE(p.nome, split_part(u.email,'@',1))
  INTO v_email, v_nome
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = NEW.user_id;

  v_plano_nome := CASE NEW.plano
    WHEN 'pro'    THEN 'Pintor Pro'
    WHEN 'equipe' THEN 'Equipe'
    ELSE 'IA Pro'
  END;

  PERFORM public._enviar_email_automatico(
    'confirmacao_assinatura', v_email, v_nome,
    jsonb_build_object('plano_nome', v_plano_nome)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_confirmacao_assinatura_email ON public.subscriptions;
CREATE TRIGGER trg_confirmacao_assinatura_email
  AFTER UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_confirmacao_assinatura();

-- ── 4. Agendar cron job: todo dia às 9h ──────────────────────
-- Remove job anterior se existir (seguro re-executar)
SELECT cron.unschedule('mestrepro-emails-ciclo-vida')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mestrepro-emails-ciclo-vida');

SELECT cron.schedule(
  'mestrepro-emails-ciclo-vida',
  '0 9 * * *',   -- Todo dia às 09:00 UTC (06:00 horário de Brasília)
  $$ SELECT public.cron_emails_ciclo_vida(); $$
);

-- ── 5. Verificação ───────────────────────────────────────────
-- Após executar este arquivo, confirme que o job está ativo:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mestrepro-emails-ciclo-vida';
--
-- Para testar manualmente:
--   SELECT public.cron_emails_ciclo_vida();
--
-- Para ver o histórico de execuções:
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'mestrepro-emails-ciclo-vida') ORDER BY start_time DESC LIMIT 10;

-- ── ROLLBACK ─────────────────────────────────────────────────
-- SELECT cron.unschedule('mestrepro-emails-ciclo-vida');
-- DROP TRIGGER IF EXISTS trg_boas_vindas_email ON auth.users;
-- DROP TRIGGER IF EXISTS trg_confirmacao_assinatura_email ON public.subscriptions;
-- DROP FUNCTION IF EXISTS public._enviar_email_automatico(text,text,text,jsonb);
-- DROP FUNCTION IF EXISTS public.trg_email_boas_vindas();
-- DROP FUNCTION IF EXISTS public.trg_email_confirmacao_assinatura();
