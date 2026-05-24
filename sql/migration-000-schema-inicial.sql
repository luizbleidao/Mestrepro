-- ============================================================
-- MestrePro — Migration 000: Schema Inicial Completo
-- ============================================================
-- EXECUTE ESTE ARQUIVO EM AMBIENTE NOVO (banco vazio).
-- Substitui a necessidade de rodar schema-base.sql + migrations-v2.sql
-- separadamente. Usa IF NOT EXISTS em todas as instruções — seguro
-- re-executar em banco existente sem destruir dados.
--
-- Ordem de arquivos que ESTE SCRIPT consolida:
--   1. schema-base.sql           (tabelas base + funções)
--   2. migrations-v2.sql         (subscriptions, pagamentos, ativar_plano)
--   3. migration-security-2026-05-21.sql  (segurança, RLS granular)
--   4. migration-orcamentos-novos-campos-2026-05-23.sql
--   5. migration-indicacoes-2026-05-23.sql
--   6. migration-emails-automaticos-2026-05-23.sql
--   7. migration-payout-pix-2026-05-24.sql
--
-- Após rodar este arquivo em um ambiente novo, NÃO é necessário
-- rodar os arquivos listados acima — eles são idempotentes e podem
-- ser rodados depois sem danos, mas são redundantes com este script.
-- ============================================================

-- ── EXTENSÕES ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pg_net e pg_cron: habilitar via Supabase dashboard → Database → Extensions

-- ============================================================
-- TABELAS (ordem de dependência FK)
-- ============================================================

-- 1. planos_config
CREATE TABLE IF NOT EXISTS public.planos_config (
  id                text    PRIMARY KEY,
  nome              text,
  preco_mensal      numeric,
  preco_anual       numeric,
  mp_link_mensal    text,
  mp_link_anual     text,
  ativo             boolean DEFAULT true,
  limite_laudos_mes integer,
  limite_orcamentos integer
);

-- 2. profiles (extensão de auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome                text,
  plano               text        NOT NULL DEFAULT 'trial',
  role                text        NOT NULL DEFAULT 'user',
  platform            text        NOT NULL DEFAULT 'pin',
  trial_inicio        date,
  trial_fim           timestamptz,
  whatsapp            text,
  empresa             text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  perfil              text        NOT NULL DEFAULT 'pintor',
  cidade              text,
  tel                 text,
  is_admin            boolean     NOT NULL DEFAULT false,
  ativo               boolean     NOT NULL DEFAULT true,
  obs_admin           text,
  sig_profissional    text,
  empresa_data        jsonb,
  preferencias        jsonb,
  lgpd_aceito         boolean     NOT NULL DEFAULT false,
  lgpd_aceito_em      timestamptz,
  lgpd_versao         text        DEFAULT '1.0',
  termos_aceitos_em   timestamptz,
  conta_excluir_em    timestamptz,
  equipe_owner_id     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  laudos_mes          integer     NOT NULL DEFAULT 0,
  laudos_mes_reset_em date        NOT NULL DEFAULT (date_trunc('month', now()))::date,
  orcamentos_total    integer     NOT NULL DEFAULT 0,
  laudos_mes_inicio   date        DEFAULT (date_trunc('month', now()))::date
);

-- 3. subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plano                text        NOT NULL DEFAULT 'gratuito',
  status               text        NOT NULL DEFAULT 'ativa',
  mp_subscription_id   text,
  mp_payment_id_ultimo text,
  periodo_inicio       timestamptz,
  periodo_fim          timestamptz,
  criado_em            timestamptz DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

-- 4. pagamentos
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id            text        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  plano         text        NOT NULL,
  valor         numeric,
  status        text        NOT NULL DEFAULT 'pendente',
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  aprovado_em   timestamptz,
  mp_payment_id text        UNIQUE,
  metodo        text
);

-- 5. afiliados
CREATE TABLE IF NOT EXISTS public.afiliados (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid    REFERENCES public.profiles(id) ON DELETE CASCADE,
  codigo          text    NOT NULL UNIQUE,
  comissao_pct    numeric DEFAULT 30.00,
  total_ganho     numeric DEFAULT 0,
  total_indicados integer DEFAULT 0,
  ativo           boolean DEFAULT true,
  criado_em       timestamptz DEFAULT now()
);

-- 6. comissoes
CREATE TABLE IF NOT EXISTS public.comissoes (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  afiliado_id  uuid    REFERENCES public.afiliados(id) ON DELETE CASCADE,
  pagamento_id text    REFERENCES public.pagamentos(id) ON DELETE SET NULL,
  valor        numeric,
  status       text    DEFAULT 'pendente',
  criado_em    timestamptz DEFAULT now()
);

-- 7. orcamentos
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id                   text        PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform             text        NOT NULL DEFAULT 'pin',
  dados                jsonb       DEFAULT '{}',
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  numero               text,
  cliente              text,
  endereco             text,
  status               text        DEFAULT 'rascunho',
  total                numeric     DEFAULT 0,
  mode                 text        DEFAULT 'prod',
  data                 date,
  criado_em            timestamptz DEFAULT now(),
  data_completa        jsonb,
  sig_token            text        UNIQUE,
  sig_cliente          text,
  sig_cliente_at       timestamptz,
  sig_cliente_nome     text,
  sig_cliente_ip       text        DEFAULT 'indisponível',
  contrato_gerado_em   timestamptz,
  contrato_dados       jsonb,
  sig_token_expires_at timestamptz,
  -- Aprovação de orçamento (2026-05-23)
  aprov_token          text        UNIQUE,
  aprov_status         text        DEFAULT 'pendente'
                       CHECK (aprov_status IN ('pendente','aprovado','recusado')),
  aprov_at             timestamptz,
  aprov_motivo         text,
  -- Portal do cliente (2026-05-23)
  portal_token         text        UNIQUE,
  portal_progresso     smallint    DEFAULT 0 CHECK (portal_progresso BETWEEN 0 AND 100),
  portal_etapa         smallint    DEFAULT 0 CHECK (portal_etapa BETWEEN 0 AND 5),
  portal_fotos         jsonb       DEFAULT '[]'::jsonb,
  portal_mensagens     jsonb       DEFAULT '[]'::jsonb
);

-- 8. contratos
CREATE TABLE IF NOT EXISTS public.contratos (
  id                   text        PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  orcamento_id         text,
  numero               text,
  cliente              text,
  endereco             text,
  valor                numeric     DEFAULT 0,
  status               text        DEFAULT 'rascunho',
  dados                jsonb       DEFAULT '{}',
  assinado_prof        boolean     DEFAULT false,
  assinado_cli         boolean     DEFAULT false,
  sig_token            text,
  sig_cli_base64       text,
  sig_cli_at           timestamptz,
  sig_cli_nome         text,
  criado_em            timestamptz DEFAULT now(),
  atualizado_em        timestamptz DEFAULT now(),
  data_inicio          date,
  data_fim             date,
  sig_prof             text,
  sig_cli_ip           text        DEFAULT 'indisponível',
  sig_token_expires_at timestamptz
);

-- 9. laudos
CREATE TABLE IF NOT EXISTS public.laudos (
  id                   text        PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  numero               text,
  cliente              text,
  obra                 text,
  cidade               text,
  data                 date,
  status               text        DEFAULT 'rascunho',
  criticidade          text,
  dados                jsonb       DEFAULT '{}',
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  pat_count            integer     DEFAULT 0,
  criado_em            timestamptz DEFAULT now(),
  sig_token            text,
  sig_cliente          text,
  sig_cliente_at       timestamptz,
  sig_cliente_nome     text,
  sig_cliente_ip       text        DEFAULT 'indisponível',
  sig_token_expires_at timestamptz
);

-- 10. recibos
CREATE TABLE IF NOT EXISTS public.recibos (
  id          text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  orc_id      text,
  numero      text,
  cliente     text,
  valor       numeric,
  descricao   text,
  forma_pgto  text,
  data        date,
  dados       jsonb,
  criado_em   timestamptz DEFAULT now(),
  contrato_id text,
  observacao  text,
  parcela     text,
  cli_doc     text,
  data_pgto   date
);

-- 11. documentos_assinados
CREATE TABLE IF NOT EXISTS public.documentos_assinados (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  documento_tipo   text        NOT NULL,
  documento_id     uuid        NOT NULL,
  cliente_nome     text        NOT NULL,
  cliente_email    text,
  cliente_cpf      text,
  ip_assinatura    text,
  user_agent       text,
  hash_documento   text        NOT NULL,
  dados_assinatura jsonb       NOT NULL DEFAULT '{}',
  assinado_em      timestamptz DEFAULT now(),
  criado_em        timestamptz DEFAULT now()
);

-- 12. equipe_convites
CREATE TABLE IF NOT EXISTS public.equipe_convites (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo    text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  usado_por uuid        REFERENCES auth.users(id) ON DELETE NO ACTION,
  usado_em  timestamptz,
  criado_em timestamptz DEFAULT now(),
  ativo     boolean     NOT NULL DEFAULT true
);

-- 13. equipe_membros
CREATE TABLE IF NOT EXISTS public.equipe_membros (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membro_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now()
);

-- 14. agenda
CREATE TABLE IF NOT EXISTS public.agenda (
  id            text    PRIMARY KEY,
  user_id       uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo        text    NOT NULL,
  cliente       text,
  endereco      text,
  data_inicio   date    NOT NULL,
  data_fim      date,
  hora_inicio   text,
  hora_fim      text,
  cor           text    DEFAULT '#5b7fff',
  tipo          text    DEFAULT 'servico',
  orc_id        text,
  orcamento_id  text,
  contrato_id   text,
  status        text    DEFAULT 'agendado',
  obs           text,
  notas         text,
  dia_todo      boolean DEFAULT false,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- 15. rate_limits
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text        NOT NULL,
  janela_ini timestamptz NOT NULL DEFAULT now(),
  contador   integer     NOT NULL DEFAULT 1,
  UNIQUE (user_id, endpoint, janela_ini)
);

-- 16. email_queue
CREATE TABLE IF NOT EXISTS public.email_queue (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text        NOT NULL,
  nome          text,
  template      text        NOT NULL,
  agendado_para timestamptz NOT NULL,
  enviado_em    timestamptz,
  status        text        NOT NULL DEFAULT 'pendente',
  tentativas    integer     NOT NULL DEFAULT 0,
  erro_msg      text,
  criado_em     timestamptz DEFAULT now()
);

-- 17. email_log (2026-05-23)
CREATE TABLE IF NOT EXISTS public.email_log (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo       text        NOT NULL,
  email      text        NOT NULL,
  nome       text,
  resend_id  text,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  erro       text
);

-- 18. indicacoes (2026-05-23)
CREATE TABLE IF NOT EXISTS public.indicacoes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  indicado_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  indicado_email   text,
  ref_code         text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','cadastrado','ativo','pago','expirado')),
  plano_contratado text,
  comissao_pct     numeric(5,2) DEFAULT 20.00,
  comissao_brl     numeric(10,2) DEFAULT 0.00,
  valor_pago_brl   numeric(10,2),
  pago_em          timestamptz,
  expira_em        timestamptz DEFAULT (now() + interval '90 days'),
  -- Payout PIX automático (2026-05-24)
  payout_status    text        DEFAULT 'pendente'
                   CHECK (payout_status IN ('pendente','processando','enviado','falhou','nao_aplicavel')),
  payout_mp_id     text,
  payout_erro      text,
  payout_tentativas int        DEFAULT 0,
  payout_em        timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- 19. planos_config dados iniciais
INSERT INTO public.planos_config (id, nome, preco_mensal, preco_anual, mp_link_mensal, mp_link_anual, limite_laudos_mes, limite_orcamentos)
VALUES
  ('gratuito', 'Grátis',   0,      0,       NULL, NULL, 3, 5),
  ('basico',  'Básico',   49.00,  490.00,  'https://mpago.la/19VUY91', 'https://mpago.la/2mBWE1i', 10, NULL),
  ('pro',     'Pro',      97.00,  970.00,  'https://mpago.la/1ieWwdr', 'https://mpago.la/2YpEhnF', NULL, NULL),
  ('equipe',  'Equipe',  197.00, 1970.00,  'https://mpago.la/1YuzDuc', 'https://mpago.la/15PqKDb', NULL, NULL),
  ('ia-pro',  'IA Pro',  297.00, 2970.00,  'https://mpago.la/1iWJVWP', 'https://mpago.la/119g9kC', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  preco_mensal   = EXCLUDED.preco_mensal,
  preco_anual    = EXCLUDED.preco_anual,
  mp_link_mensal = EXCLUDED.mp_link_mensal,
  mp_link_anual  = EXCLUDED.mp_link_anual;

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orcamentos_aprov_token    ON public.orcamentos(aprov_token) WHERE aprov_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orcamentos_portal_token   ON public.orcamentos(portal_token) WHERE portal_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_tipo_email      ON public.email_log(tipo, email);
CREATE INDEX IF NOT EXISTS idx_email_log_enviado_em      ON public.email_log(enviado_em);
CREATE INDEX IF NOT EXISTS idx_indicacoes_referrer       ON public.indicacoes(referrer_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_indicado       ON public.indicacoes(indicado_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_ref_code       ON public.indicacoes(ref_code);
CREATE INDEX IF NOT EXISTS idx_indicacoes_status         ON public.indicacoes(status);
CREATE INDEX IF NOT EXISTS idx_indicacoes_payout_status  ON public.indicacoes(payout_status)
  WHERE payout_status IN ('pendente','falhou');

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.planos_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afiliados             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comissoes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamentos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laudos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recibos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_assinados  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_convites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipe_membros        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_queue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicacoes            ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (DROP antes de recriar — idempotente)
DROP POLICY IF EXISTS "planos_public_read"             ON public.planos_config;
DROP POLICY IF EXISTS "profiles_owner"                 ON public.profiles;
DROP POLICY IF EXISTS "subscriptions_owner"            ON public.subscriptions;
DROP POLICY IF EXISTS "pagamentos_owner"               ON public.pagamentos;
DROP POLICY IF EXISTS "afiliados_owner"                ON public.afiliados;
DROP POLICY IF EXISTS "comissoes_owner"                ON public.comissoes;
DROP POLICY IF EXISTS "orcamentos_owner"               ON public.orcamentos;
DROP POLICY IF EXISTS "contratos_owner"                ON public.contratos;
DROP POLICY IF EXISTS "laudos_owner"                   ON public.laudos;
DROP POLICY IF EXISTS "recibos_owner"                  ON public.recibos;
DROP POLICY IF EXISTS "docs_assinados_owner"           ON public.documentos_assinados;
DROP POLICY IF EXISTS "equipe_convites_owner"          ON public.equipe_convites;
DROP POLICY IF EXISTS "equipe_membros_owner"           ON public.equipe_membros;
DROP POLICY IF EXISTS "equipe_membros_member"          ON public.equipe_membros;
DROP POLICY IF EXISTS "agenda_owner"                   ON public.agenda;
DROP POLICY IF EXISTS "rate_limits_owner"              ON public.rate_limits;
DROP POLICY IF EXISTS "email_queue_owner"              ON public.email_queue;
DROP POLICY IF EXISTS "service_role_gerencia_email_log" ON public.email_log;
DROP POLICY IF EXISTS "referrer_ve_suas_indicacoes"    ON public.indicacoes;
DROP POLICY IF EXISTS "indicado_ve_seu_registro"       ON public.indicacoes;
DROP POLICY IF EXISTS "service_role_gerencia_indicacoes" ON public.indicacoes;

CREATE POLICY "planos_public_read"    ON public.planos_config FOR SELECT USING (true);
CREATE POLICY "profiles_owner"        ON public.profiles        FOR ALL   USING (auth.uid() = id);
CREATE POLICY "subscriptions_owner"   ON public.subscriptions   FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "pagamentos_owner"      ON public.pagamentos       FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "afiliados_owner"       ON public.afiliados        FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "comissoes_owner"       ON public.comissoes        FOR SELECT
  USING (afiliado_id IN (SELECT id FROM public.afiliados WHERE user_id = auth.uid()));
CREATE POLICY "orcamentos_owner"      ON public.orcamentos       FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "contratos_owner"       ON public.contratos        FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "laudos_owner"          ON public.laudos           FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "recibos_owner"         ON public.recibos          FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "docs_assinados_owner"  ON public.documentos_assinados FOR ALL USING (auth.uid() = usuario_id);
CREATE POLICY "equipe_convites_owner" ON public.equipe_convites  FOR ALL   USING (auth.uid() = owner_id);
CREATE POLICY "equipe_membros_owner"  ON public.equipe_membros   FOR ALL   USING (auth.uid() = owner_id);
CREATE POLICY "equipe_membros_member" ON public.equipe_membros   FOR SELECT USING (auth.uid() = membro_id);
CREATE POLICY "agenda_owner"          ON public.agenda           FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "rate_limits_owner"     ON public.rate_limits      FOR ALL   USING (auth.uid() = user_id);
CREATE POLICY "email_queue_owner"     ON public.email_queue      FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service_role_gerencia_email_log" ON public.email_log FOR ALL
  USING (auth.role() = 'service_role');
CREATE POLICY "referrer_ve_suas_indicacoes" ON public.indicacoes FOR SELECT
  USING (auth.uid() = referrer_id);
CREATE POLICY "indicado_ve_seu_registro"    ON public.indicacoes FOR SELECT
  USING (auth.uid() = indicado_id);
CREATE POLICY "service_role_gerencia_indicacoes" ON public.indicacoes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- FUNÇÕES AUXILIARES
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid() LIMIT 1), false);
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.set_trial_fim()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW.plano = 'trial' AND NEW.trial_fim IS NULL THEN
    NEW.trial_fim := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, perfil, tel, cidade, trial_inicio)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'perfil', 'pintor'),
    NEW.raw_user_meta_data->>'tel',
    NEW.raw_user_meta_data->>'cidade',
    now()
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_set_atualizado_em()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid, p_endpoint text, p_limite integer, p_janela interval
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_janela_ini timestamptz := date_trunc('hour', now());
  v_contador   int;
BEGIN
  DELETE FROM public.rate_limits WHERE janela_ini < now() - interval '24 hours';
  INSERT INTO public.rate_limits (user_id, endpoint, janela_ini, contador)
  VALUES (p_user_id, p_endpoint, v_janela_ini, 1)
  ON CONFLICT (user_id, endpoint, janela_ini)
  DO UPDATE SET contador = rate_limits.contador + 1
  RETURNING contador INTO v_contador;
  RETURN v_contador <= p_limite;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_laudo_permitido()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p   record;
  v_lim int; v_usado int; v_rest int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('permitido', false, 'motivo', 'nao_autenticado'); END IF;
  SELECT p.plano, p.laudos_mes, pc.limite_laudos_mes INTO v_p
  FROM public.profiles p LEFT JOIN public.planos_config pc ON pc.id = p.plano WHERE p.id = v_uid
  FOR UPDATE OF p;
  IF v_p.limite_laudos_mes IS NULL THEN
    RETURN jsonb_build_object('permitido', true, 'plano', v_p.plano, 'limite', null,
      'usado', v_p.laudos_mes, 'restantes', null, 'ilimitado', true);
  END IF;
  v_lim := v_p.limite_laudos_mes; v_usado := COALESCE(v_p.laudos_mes, 0); v_rest := GREATEST(0, v_lim - v_usado);
  RETURN jsonb_build_object(
    'permitido', v_rest > 0, 'plano', v_p.plano, 'limite', v_lim,
    'usado', v_usado, 'restantes', v_rest, 'ilimitado', false,
    'reset_em', (date_trunc('month', now()) + interval '1 month')::date,
    'motivo', CASE WHEN v_rest <= 0 THEN 'limite_atingido' ELSE null END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.meu_uso()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p   record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('erro', 'nao_autenticado'); END IF;
  SELECT p.plano, p.laudos_mes, p.laudos_mes_reset_em, p.orcamentos_total,
         pc.limite_laudos_mes, pc.limite_orcamentos INTO v_p
  FROM public.profiles p LEFT JOIN public.planos_config pc ON pc.id = p.plano WHERE p.id = v_uid;
  RETURN jsonb_build_object(
    'laudos_mes',           COALESCE(v_p.laudos_mes, 0),
    'laudos_limite_mes',    v_p.limite_laudos_mes,
    'laudos_restantes',     CASE WHEN v_p.limite_laudos_mes IS NULL THEN null ELSE GREATEST(0, v_p.limite_laudos_mes - COALESCE(v_p.laudos_mes, 0)) END,
    'laudos_ilimitado',     v_p.limite_laudos_mes IS NULL,
    'laudos_reset_em',      (date_trunc('month', now()) + interval '1 month')::date,
    'orcamentos_total',     COALESCE(v_p.orcamentos_total, 0),
    'orcamentos_limite',    v_p.limite_orcamentos,
    'orcamentos_restantes', CASE WHEN v_p.limite_orcamentos IS NULL THEN null ELSE GREATEST(0, v_p.limite_orcamentos - COALESCE(v_p.orcamentos_total, 0)) END,
    'orcamentos_ilimitado', v_p.limite_orcamentos IS NULL,
    'plano',                v_p.plano,
    'calculado_em',         now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ativar_plano(
  p_user_id            uuid,
  p_plano              text,
  p_mp_payment_id      text,
  p_valor              numeric,
  p_metodo             text,
  p_periodo_inicio     timestamptz,
  p_periodo_fim        timestamptz,
  p_mp_subscription_id text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET plano = p_plano, ativo = true WHERE id = p_user_id;
  INSERT INTO public.subscriptions
    (user_id, plano, status, mp_subscription_id, mp_payment_id_ultimo, periodo_inicio, periodo_fim, atualizado_em)
  VALUES (p_user_id, p_plano, 'ativa', p_mp_subscription_id, p_mp_payment_id, p_periodo_inicio, p_periodo_fim, now())
  ON CONFLICT (user_id) DO UPDATE SET
    plano                = EXCLUDED.plano,
    status               = 'ativa',
    mp_subscription_id   = EXCLUDED.mp_subscription_id,
    mp_payment_id_ultimo = EXCLUDED.mp_payment_id_ultimo,
    periodo_inicio       = EXCLUDED.periodo_inicio,
    periodo_fim          = EXCLUDED.periodo_fim,
    atualizado_em        = now();
  INSERT INTO public.pagamentos (user_id, mp_payment_id, valor, status, metodo, plano)
  VALUES (p_user_id, p_mp_payment_id, p_valor, 'aprovado', p_metodo, p_plano)
  ON CONFLICT (mp_payment_id) DO UPDATE SET status = 'aprovado', valor = EXCLUDED.valor;
END;
$$;

CREATE OR REPLACE FUNCTION public.verificar_expiracao_trial(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Acesso negado: você só pode verificar seu próprio trial.';
  END IF;
  UPDATE public.profiles SET plano = 'gratuito', atualizado_em = now()
  WHERE id = p_user_id AND plano = 'trial' AND trial_fim IS NOT NULL AND trial_fim < now()
    AND id NOT IN (SELECT user_id FROM public.subscriptions WHERE status = 'ativa');
END;
$$;
GRANT EXECUTE ON FUNCTION public.verificar_expiracao_trial(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.creditar_comissao(
  p_indicado_id  uuid,
  p_valor_pago   numeric,
  p_plano        text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row indicacoes%ROWTYPE;
  v_comissao numeric;
BEGIN
  SELECT * INTO v_row
  FROM indicacoes
  WHERE indicado_id = p_indicado_id AND status IN ('cadastrado', 'ativo')
  ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'msg', 'Sem indicação ativa para este usuário');
  END IF;
  v_comissao := round((p_valor_pago * v_row.comissao_pct / 100)::numeric, 2);
  UPDATE indicacoes SET
    status           = 'pago',
    plano_contratado = p_plano,
    comissao_brl     = v_comissao,
    valor_pago_brl   = p_valor_pago,
    pago_em          = now()
  WHERE id = v_row.id;
  RETURN json_build_object(
    'ok',           true,
    'indicacao_id', v_row.id,
    'comissao_brl', v_comissao,
    'referrer_id',  v_row.referrer_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_payout(
  p_indicacao_id uuid,
  p_status       text,
  p_mp_id        text DEFAULT NULL,
  p_erro         text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE indicacoes SET
    payout_status     = p_status,
    payout_mp_id      = COALESCE(p_mp_id, payout_mp_id),
    payout_erro       = p_erro,
    payout_tentativas = payout_tentativas + 1,
    payout_em         = CASE WHEN p_status = 'enviado' THEN now() ELSE payout_em END,
    atualizado_em     = now()
  WHERE id = p_indicacao_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_payouts_pendentes()
RETURNS TABLE (
  id               uuid,
  referrer_id      uuid,
  referrer_email   text,
  referrer_pix     text,
  comissao_brl     numeric,
  payout_status    text,
  payout_tentativas int,
  payout_erro      text,
  pago_em          timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() != 'service_role' THEN RAISE EXCEPTION 'Acesso negado'; END IF;
  RETURN QUERY
    SELECT i.id, i.referrer_id, u.email::text,
           (p.empresa_data->>'pixChave')::text,
           i.comissao_brl, i.payout_status, i.payout_tentativas, i.payout_erro, i.pago_em
    FROM indicacoes i
    JOIN auth.users u ON u.id = i.referrer_id
    LEFT JOIN profiles p ON p.id = i.referrer_id
    WHERE i.payout_status IN ('pendente', 'falhou')
      AND i.status = 'pago' AND i.comissao_brl > 0
    ORDER BY i.pago_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.meu_programa_indicacao()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ref      text;
  v_total    int;
  v_ativos   int;
  v_comissao numeric;
BEGIN
  v_ref := upper(left(replace(v_uid::text, '-', ''), 8));
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('ativo','pago')),
         COALESCE(SUM(comissao_brl) FILTER (WHERE status = 'pago'), 0)
  INTO v_total, v_ativos, v_comissao
  FROM indicacoes WHERE referrer_id = v_uid;
  RETURN json_build_object('ref_code', v_ref, 'total', v_total, 'ativos', v_ativos, 'comissao', v_comissao);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_assinatura_cliente(
  p_documento_id   uuid,
  p_dados_assinatura jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_ip   text := p_dados_assinatura->>'ip';
  v_hash text;
BEGIN
  -- Rate limit: 10 assinaturas por IP por hora
  IF (SELECT COUNT(*) FROM public.documentos_assinados
      WHERE dados_assinatura->>'ip' = v_ip
        AND assinado_em > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Limite de tentativas atingido. Tente novamente em 1 hora.');
  END IF;
  -- Hash do documento para trilha de auditoria
  v_hash := encode(digest(p_documento_id::text || v_ip || now()::text, 'sha256'), 'hex');
  INSERT INTO public.documentos_assinados
    (documento_tipo, documento_id, cliente_nome, cliente_cpf, ip_assinatura, hash_documento, dados_assinatura)
  VALUES (
    COALESCE(p_dados_assinatura->>'tipo', 'contrato'),
    p_documento_id,
    COALESCE(p_dados_assinatura->>'nome', 'Não informado'),
    p_dados_assinatura->>'cpf',
    v_ip,
    v_hash,
    p_dados_assinatura
  );
  RETURN jsonb_build_object('ok', true, 'hash', v_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.atualizar_progresso_portal(
  p_orc_id    uuid,
  p_progresso int,
  p_etapa     int  DEFAULT NULL,
  p_nova_foto text DEFAULT NULL,
  p_mensagem  text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM orcamentos WHERE id = p_orc_id AND user_id = v_uid) THEN
    RETURN json_build_object('ok', false, 'erro', 'Orçamento não encontrado ou sem permissão');
  END IF;
  UPDATE orcamentos SET
    portal_progresso = GREATEST(0, LEAST(100, p_progresso)),
    portal_etapa     = COALESCE(p_etapa, portal_etapa),
    portal_fotos     = CASE WHEN p_nova_foto IS NOT NULL
                       THEN portal_fotos || jsonb_build_array(p_nova_foto) ELSE portal_fotos END,
    portal_mensagens = CASE WHEN p_mensagem IS NOT NULL
                       THEN portal_mensagens || jsonb_build_array(jsonb_build_object(
                         'de', 'pintor', 'texto', p_mensagem, 'em', now()::text
                       )) ELSE portal_mensagens END
  WHERE id = p_orc_id AND user_id = v_uid;
  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.exportar_meus_dados()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'perfil',       (SELECT row_to_json(p) FROM public.profiles p WHERE p.id = v_uid),
    'orcamentos',   (SELECT json_agg(o) FROM public.orcamentos o WHERE o.user_id = v_uid),
    'contratos',    (SELECT json_agg(c) FROM public.contratos c WHERE c.user_id = v_uid),
    'laudos',       (SELECT json_agg(l) FROM public.laudos l WHERE l.user_id = v_uid),
    'recibos',      (SELECT json_agg(r) FROM public.recibos r WHERE r.user_id = v_uid),
    'agenda',       (SELECT json_agg(a) FROM public.agenda a WHERE a.user_id = v_uid),
    'indicacoes',   (SELECT json_agg(i) FROM public.indicacoes i WHERE i.referrer_id = v_uid),
    'exportado_em', now()
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Funções de equipe
CREATE OR REPLACE FUNCTION public.criar_convite_equipe()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid(); v_plano text; v_codigo text;
BEGIN
  SELECT plano INTO v_plano FROM public.profiles WHERE id = v_uid;
  IF v_plano NOT IN ('equipe', 'ia-pro') THEN RAISE EXCEPTION 'Plano Equipe ou IA Pro necessário.'; END IF;
  UPDATE public.equipe_convites SET ativo = false WHERE owner_id = v_uid;
  v_codigo := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.equipe_convites (owner_id, codigo, ativo, expira_em) VALUES (v_uid, v_codigo, true, now() + interval '30 days');
  RETURN v_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_membros_equipe()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid(); v_plano text; v_result jsonb;
BEGIN
  SELECT plano INTO v_plano FROM public.profiles WHERE id = v_uid;
  IF v_plano NOT IN ('equipe', 'ia-pro') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('membro_id', em.membro_id, 'nome', COALESCE(p.nome,'—'),
    'email', COALESCE(u.email,'—'), 'criado_em', em.criado_em) ORDER BY em.criado_em)
  INTO v_result FROM public.equipe_membros em
  JOIN public.profiles p ON p.id = em.membro_id LEFT JOIN auth.users u ON u.id = em.membro_id
  WHERE em.owner_id = v_uid;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.remover_membro_equipe(p_membro_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  DELETE FROM public.equipe_membros WHERE owner_id = v_uid AND membro_id = p_membro_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Membro não encontrado.'); END IF;
  UPDATE public.profiles SET plano = 'gratuito', equipe_owner_id = NULL WHERE id = p_membro_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Função de cron para emails (2026-05-23)
CREATE OR REPLACE FUNCTION public.cron_emails_ciclo_vida()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  -- D+3: engajamento para quem não criou orçamento ainda
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.created_at::date = (now() - interval '3 days')::date
      AND NOT EXISTS (SELECT 1 FROM public.email_log WHERE tipo='engajamento_d3' AND email=u.email)
      AND NOT EXISTS (SELECT 1 FROM public.orcamentos WHERE user_id=u.id LIMIT 1)
  LOOP
    PERFORM public._enviar_email_automatico('engajamento_d3', r.email, r.nome);
  END LOOP;

  -- D+6: aviso trial expirando
  FOR r IN
    SELECT u.id, u.email, COALESCE(p.nome, split_part(u.email,'@',1)) AS nome
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.subscriptions s ON s.user_id = u.id
    WHERE u.created_at::date = (now() - interval '6 days')::date
      AND COALESCE(s.plano, 'gratuito') = 'gratuito'
      AND NOT EXISTS (SELECT 1 FROM public.email_log WHERE tipo='trial_expirando' AND email=u.email)
  LOOP
    PERFORM public._enviar_email_automatico('trial_expirando', r.email, r.nome);
  END LOOP;
END;
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================
DROP TRIGGER IF EXISTS trg_set_trial_fim         ON public.profiles;
DROP TRIGGER IF EXISTS trg_handle_new_user        ON auth.users;
DROP TRIGGER IF EXISTS trg_indicacoes_atualizado_em ON public.indicacoes;

CREATE TRIGGER trg_set_trial_fim
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_trial_fim();

CREATE TRIGGER trg_handle_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_indicacoes_atualizado_em
  BEFORE UPDATE ON public.indicacoes
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_atualizado_em();

-- ============================================================
-- GRANTS
-- ============================================================
GRANT EXECUTE ON FUNCTION public.verificar_expiracao_trial(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_uso()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_laudo_permitido()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.exportar_meus_dados()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_programa_indicacao()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_assinatura_cliente(uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atualizar_progresso_portal(uuid, int, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_convite_equipe()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_membros_equipe()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_membro_equipe(uuid)      TO authenticated;
