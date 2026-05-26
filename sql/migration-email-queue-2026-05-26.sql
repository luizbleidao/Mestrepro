-- ============================================================
-- MestrePro — Migration: Email Queue confiável (sem pg_net)
-- Data: 2026-05-26
--
-- PROBLEMA: A função _enviar_email_automatico usava pg_net para
-- chamar a Edge Function diretamente, o que depende de:
--   1. pg_net habilitado
--   2. app.edge_function_url configurado no banco
--   3. app.service_role_key configurado no banco
-- Qualquer um desses faltando = emails não saem.
--
-- SOLUÇÃO: Triggers inserem na tabela email_queue.
-- A Edge Function email-sender processa a fila via pg_cron.
-- Zero dependências de pg_net ou variáveis de banco.
-- ============================================================

-- ── 1. Criar/atualizar tabela email_queue ────────────────────
CREATE TABLE IF NOT EXISTS public.email_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL,
  email       text NOT NULL,
  nome        text,
  dados       jsonb DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','processando','enviado','erro')),
  tentativas  int  NOT NULL DEFAULT 0,
  resend_id   text,
  erro_msg    text,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  enviado_em  timestamptz
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_email_queue_status    ON public.email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_criado_em ON public.email_queue(criado_em);
CREATE INDEX IF NOT EXISTS idx_email_queue_email     ON public.email_queue(email, tipo);

-- RLS: apenas service_role gerencia
ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_email_queue" ON public.email_queue;
CREATE POLICY "service_role_email_queue"
  ON public.email_queue FOR ALL
  USING (auth.role() = 'service_role');

-- ── 2. Substituir _enviar_email_automatico ───────────────────
-- Agora simplesmente insere na fila — sem pg_net, sem HTTP
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
BEGIN
  -- Evita duplicata do mesmo tipo para o mesmo email nas últimas 24h
  IF EXISTS (
    SELECT 1 FROM public.email_queue
    WHERE tipo = p_tipo
      AND email = p_email
      AND status IN ('pendente','processando','enviado')
      AND criado_em > now() - interval '24 hours'
  ) THEN
    RETURN; -- Já tem na fila ou foi enviado recentemente
  END IF;

  -- Verifica também no email_log (emails já enviados há menos de 24h)
  IF EXISTS (
    SELECT 1 FROM public.email_log
    WHERE tipo = p_tipo AND email = p_email
      AND enviado_em > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.email_queue (tipo, email, nome, dados)
  VALUES (p_tipo, p_email, p_nome, COALESCE(p_dados, '{}'::jsonb));

EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear a transação que chamou
  RAISE WARNING '[MestrePro] _enviar_email_automatico falhou: %', SQLERRM;
END;
$$;

-- ── 3. Trigger: boas-vindas ao cadastrar ─────────────────────
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

-- ── 4. Trigger: confirmação de assinatura ────────────────────
CREATE OR REPLACE FUNCTION public.trg_email_confirmacao_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email      text;
  v_nome       text;
  v_plano_nome text;
BEGIN
  -- Só dispara quando o plano muda para algo pago
  IF NEW.plano = OLD.plano THEN RETURN NEW; END IF;
  IF NEW.plano NOT IN ('pro','equipe','ia-pro','ia_pro') THEN RETURN NEW; END IF;

  -- Tenta buscar email via profiles primeiro, depois auth.users
  SELECT COALESCE(p.nome, split_part(u.email,'@',1)), u.email
  INTO v_nome, v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = COALESCE(NEW.user_id, NEW.usuario_id)
  LIMIT 1;

  IF v_email IS NULL THEN RETURN NEW; END IF;

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

-- Tenta criar trigger em assinaturas (nome da tabela no projeto)
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_confirmacao_assinatura_email ON public.assinaturas;
  CREATE TRIGGER trg_confirmacao_assinatura_email
    AFTER UPDATE ON public.assinaturas
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_email_confirmacao_assinatura();
EXCEPTION WHEN undefined_table THEN
  RAISE NOTICE 'Tabela assinaturas não existe — pulando trigger';
END $$;

-- ── 5. Função cron: D+3 engajamento e D+6 trial expirando ────
CREATE OR REPLACE FUNCTION public.cron_emails_ciclo_vida()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  -- D+3: engajamento para quem não criou orçamento ainda
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.created_at::date = (now() - interval '3 days')::date
      AND NOT EXISTS (SELECT 1 FROM public.email_queue  WHERE tipo='engajamento_d3' AND email=u.email AND status IN ('pendente','enviado'))
      AND NOT EXISTS (SELECT 1 FROM public.email_log    WHERE tipo='engajamento_d3' AND email=u.email)
      AND NOT EXISTS (SELECT 1 FROM public.orcamentos   WHERE user_id=u.id LIMIT 1)
  LOOP
    PERFORM public._enviar_email_automatico('engajamento_d3', r.email, r.nome);
  END LOOP;

  -- D+6: aviso de trial expirando para quem ainda é gratuito
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.created_at::date = (now() - interval '6 days')::date
      AND COALESCE(p.plano, 'gratuito') = 'gratuito'
      AND NOT EXISTS (SELECT 1 FROM public.email_queue WHERE tipo='trial_expirando' AND email=u.email AND status IN ('pendente','enviado'))
      AND NOT EXISTS (SELECT 1 FROM public.email_log   WHERE tipo='trial_expirando' AND email=u.email)
  LOOP
    PERFORM public._enviar_email_automatico('trial_expirando', r.email, r.nome);
  END LOOP;
END;
$$;

-- ── 6. Agendar pg_cron para processar a fila ────────────────
-- ATENÇÃO: pg_cron chama a Edge Function email-sender
-- que processa a email_queue e envia via Resend.
--
-- Para ativar, execute no SQL Editor do Supabase:
--
-- Pré-requisito: pg_cron habilitado (Supabase → Extensions → pg_cron)
--
-- 1) Agendar chamada HTTP à Edge Function email-sender:
-- SELECT cron.schedule(
--   'mestrepro-email-sender',
--   '0 9,12,18 * * *',   -- 9h, 12h e 18h UTC todos os dias
--   $$
--     SELECT net.http_post(
--       url := 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/email-sender',
--       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
--       body := '{}'::jsonb
--     );
--   $$
-- );
--
-- 2) Agendar cron de ciclo de vida (D+3, D+6):
-- SELECT cron.schedule(
--   'mestrepro-emails-ciclo-vida',
--   '30 9 * * *',   -- 9h30 UTC todo dia
--   $$ SELECT public.cron_emails_ciclo_vida(); $$
-- );
--
-- 3) Verificar jobs ativos:
-- SELECT jobid, jobname, schedule, active FROM cron.job;

-- ── 7. Migrar itens presos do email_log para email_queue ─────
-- Se houver emails no email_log sem resend_id (falharam antes),
-- isso é apenas informativo — não há como retentar o log.
-- Use a função abaixo para recriar na fila se necessário:
--
-- INSERT INTO email_queue (tipo, email, nome, criado_em)
-- SELECT tipo, email, nome, enviado_em
-- FROM email_log
-- WHERE resend_id IS NULL AND erro IS NOT NULL;

-- ── ROLLBACK ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.email_queue CASCADE;
-- DROP FUNCTION IF EXISTS public._enviar_email_automatico(text,text,text,jsonb);
-- DROP FUNCTION IF EXISTS public.trg_email_boas_vindas();
-- DROP FUNCTION IF EXISTS public.trg_email_confirmacao_assinatura();
-- DROP FUNCTION IF EXISTS public.cron_emails_ciclo_vida();
-- SELECT cron.unschedule('mestrepro-email-sender');
-- SELECT cron.unschedule('mestrepro-emails-ciclo-vida');
