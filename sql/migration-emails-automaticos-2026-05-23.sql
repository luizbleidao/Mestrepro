-- ============================================================
-- MestrePro — Migration: Emails Automáticos (ciclo de vida)
-- Data: 2026-05-23
-- Rollback: ver seção ROLLBACK ao final
-- ============================================================
-- Pré-requisito: Edge Function emails-automaticos deployada
-- Variável de ambiente SUPABASE_EDGE_FUNCTION_URL deve estar configurada
-- ============================================================

-- ── 1. TABELA DE LOG DE EMAILS ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL,
  email       text NOT NULL,
  nome        text,
  resend_id   text,
  enviado_em  timestamptz NOT NULL DEFAULT now(),
  erro        text
);

-- Índices para evitar reenvios duplicados e para relatórios
CREATE INDEX IF NOT EXISTS idx_email_log_tipo_email   ON public.email_log(tipo, email);
CREATE INDEX IF NOT EXISTS idx_email_log_enviado_em   ON public.email_log(enviado_em);

-- RLS: apenas service_role gerencia, owner do e-mail vê os seus
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_gerencia_email_log"
  ON public.email_log FOR ALL
  USING (auth.role() = 'service_role');

-- ── 2. COLUNAS EXTRAS EM OUTRAS TABELAS ──────────────────────
-- Adiciona colunas para rastrear emails de ciclo de vida enviados
-- (seguro re-executar — IF NOT EXISTS implícito via DO $$)

DO $$ BEGIN
  -- Em usuarios/profiles
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='email_boas_vindas_em') THEN
    ALTER TABLE public.usuarios ADD COLUMN email_boas_vindas_em timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='email_engajamento_d3_em') THEN
    ALTER TABLE public.usuarios ADD COLUMN email_engajamento_d3_em timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='email_trial_aviso_em') THEN
    ALTER TABLE public.usuarios ADD COLUMN email_trial_aviso_em timestamptz;
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- Tabela usuarios pode ter nome diferente; silencioso
  NULL;
END $$;

-- ── 3. FUNÇÃO AUXILIAR — chamar Edge Function ────────────────
-- Usa pg_net (extensão do Supabase) para fazer HTTP call assíncrono
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
  v_url text;
  v_service_key text;
BEGIN
  -- Verifica se já enviou esse tipo para esse e-mail nas últimas 24h
  IF EXISTS (
    SELECT 1 FROM email_log
    WHERE tipo = p_tipo AND email = p_email
      AND enviado_em > now() - interval '24 hours'
  ) THEN
    RETURN; -- Evita reenvio duplicado
  END IF;

  -- URL da Edge Function
  v_url := current_setting('app.edge_function_url', true)
           || '/emails-automaticos';

  -- Chama via net.http_post (pg_net) de forma assíncrona
  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := jsonb_build_object(
      'tipo',  p_tipo,
      'email', p_email,
      'nome',  p_nome,
      'dados', p_dados
    )::text
  );

EXCEPTION WHEN OTHERS THEN
  -- Não bloquear a transação principal se o email falhar
  INSERT INTO email_log (tipo, email, nome, erro)
  VALUES (p_tipo, p_email, p_nome, SQLERRM);
END;
$$;

-- ── 4. TRIGGER — Boas-vindas ao criar conta ──────────────────
CREATE OR REPLACE FUNCTION public.trg_email_boas_vindas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_nome text;
BEGIN
  -- Tenta obter o nome do novo usuário
  v_nome := COALESCE(
    (SELECT nome FROM public.usuarios WHERE id = NEW.id LIMIT 1),
    split_part(NEW.email, '@', 1)
  );

  -- Dispara email de boas-vindas de forma assíncrona
  PERFORM public._enviar_email_automatico(
    'boas_vindas', NEW.email, v_nome
  );

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

-- ── 5. TRIGGER — Confirmação de assinatura ───────────────────
CREATE OR REPLACE FUNCTION public.trg_email_confirmacao_assinatura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email text;
  v_nome  text;
  v_plano_nome text;
BEGIN
  -- Só dispara quando o plano muda para algo pago
  IF NEW.plano = OLD.plano THEN RETURN NEW; END IF;
  IF NEW.plano NOT IN ('pro','equipe','ia-pro','ia_pro') THEN RETURN NEW; END IF;

  SELECT u.email, COALESCE(p.nome, split_part(u.email,'@',1))
  INTO v_email, v_nome
  FROM auth.users u
  LEFT JOIN public.usuarios p ON p.id = u.id
  WHERE u.id = NEW.usuario_id;

  v_plano_nome := CASE NEW.plano
    WHEN 'pro'    THEN 'Pintor Pro'
    WHEN 'equipe' THEN 'Equipe'
    WHEN 'ia-pro','ia_pro' THEN 'IA Pro'
    ELSE NEW.plano
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

DROP TRIGGER IF EXISTS trg_confirmacao_assinatura_email ON public.assinaturas;
CREATE TRIGGER trg_confirmacao_assinatura_email
  AFTER UPDATE ON public.assinaturas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_email_confirmacao_assinatura();

-- ── 6. FUNÇÃO CRON — D+3 engajamento e D+6 aviso trial ──────
-- Agendar com pg_cron: SELECT cron.schedule('email-ciclo-vida', '0 9 * * *', 'SELECT public.cron_emails_ciclo_vida()');
CREATE OR REPLACE FUNCTION public.cron_emails_ciclo_vida()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN

  -- D+3: engajamento para quem não criou orçamento ainda
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.usuarios p ON p.id = u.id
    WHERE u.created_at::date = (now() - interval '3 days')::date
      AND NOT EXISTS (SELECT 1 FROM public.email_log WHERE tipo='engajamento_d3' AND email=u.email)
      AND NOT EXISTS (SELECT 1 FROM public.orcamentos WHERE user_id=u.id LIMIT 1)
  LOOP
    PERFORM public._enviar_email_automatico('engajamento_d3', r.email, r.nome);
  END LOOP;

  -- D+6: aviso de trial expirando para usuários com plano gratuito
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.usuarios p ON p.id = u.id
    LEFT JOIN public.assinaturas a ON a.usuario_id = u.id
    WHERE u.created_at::date = (now() - interval '6 days')::date
      AND COALESCE(a.plano, 'gratuito') = 'gratuito'
      AND NOT EXISTS (SELECT 1 FROM public.email_log WHERE tipo='trial_expirando' AND email=u.email)
  LOOP
    PERFORM public._enviar_email_automatico('trial_expirando', r.email, r.nome);
  END LOOP;

END;
$$;

-- ── 7. AGENDAR O CRON (executar manualmente no Supabase SQL Editor) ──
-- Habilite a extensão pg_cron no painel Supabase → Database → Extensions → pg_cron
-- Depois execute:
--
-- SELECT cron.schedule(
--   'mestrepro-emails-ciclo-vida',
--   '0 9 * * *',   -- todo dia às 9h
--   $$ SELECT public.cron_emails_ciclo_vida(); $$
-- );
--
-- Para verificar:
-- SELECT * FROM cron.job;
--
-- Para remover:
-- SELECT cron.unschedule('mestrepro-emails-ciclo-vida');

-- ── 8. CONFIGURAÇÃO DO APP_URL (necessário para pg_net funcionar) ──
-- Execute no Supabase SQL Editor, substituindo pelos valores reais:
--
-- ALTER DATABASE postgres SET app.edge_function_url = 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1';
-- ALTER DATABASE postgres SET app.service_role_key  = 'SUA_SERVICE_ROLE_KEY';

-- ── ROLLBACK ─────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.email_log CASCADE;
-- DROP FUNCTION IF EXISTS public._enviar_email_automatico(text,text,text,jsonb);
-- DROP FUNCTION IF EXISTS public.trg_email_boas_vindas();
-- DROP FUNCTION IF EXISTS public.trg_email_confirmacao_assinatura();
-- DROP FUNCTION IF EXISTS public.cron_emails_ciclo_vida();
-- DROP TRIGGER IF EXISTS trg_boas_vindas_email ON auth.users;
-- DROP TRIGGER IF EXISTS trg_confirmacao_assinatura_email ON public.assinaturas;
-- SELECT cron.unschedule('mestrepro-emails-ciclo-vida');
