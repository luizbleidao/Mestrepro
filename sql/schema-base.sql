-- =============================================================
-- schema-base.sql — MestrePro Schema Completo
-- Versão: 1.0.0 | Gerado em: 2026-05-20
-- Projeto Supabase: ufdrxucvyukgzvenfuhj (sa-east-1)
--
-- EXECUTE ESTE ARQUIVO APENAS EM BANCO POSTGRESQL VAZIO.
-- Ordem de execução: extensions → tables → RLS → indexes
--                   → functions → triggers
-- =============================================================

-- =============================================================
-- EXTENSIONS
-- =============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- pg_net é habilitado via Supabase dashboard (usada em run_manutencao_diaria)


-- =============================================================
-- TABLES (ordem de dependência FK)
-- =============================================================

-- 1. planos_config — sem dependências externas
CREATE TABLE IF NOT EXISTS planos_config (
  id                text PRIMARY KEY,
  nome              text,
  preco_mensal      numeric,
  preco_anual       numeric,
  mp_link_mensal    text,
  mp_link_anual     text,
  ativo             boolean DEFAULT true,
  limite_laudos_mes integer,
  limite_orcamentos integer
);

-- 2. profiles — extensão de auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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
  equipe_owner_id     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  laudos_mes          integer     NOT NULL DEFAULT 0,
  laudos_mes_reset_em date        NOT NULL DEFAULT (date_trunc('month', now()))::date,
  orcamentos_total    integer     NOT NULL DEFAULT 0,
  laudos_mes_inicio   date        DEFAULT (date_trunc('month', now()))::date
);

-- 3. subscriptions — referenciada por ativar_plano, run_manutencao_diaria, etc.
--    (não aparece na listagem inicial; reconstruída via análise das RPCs)
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plano                text        NOT NULL,
  status               text        NOT NULL DEFAULT 'ativa', -- 'ativa' | 'expirada' | 'cancelada'
  mp_subscription_id   text,
  mp_payment_id_ultimo text,
  periodo_inicio       timestamptz,
  periodo_fim          timestamptz,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

-- 4. afiliados — depende de profiles
CREATE TABLE IF NOT EXISTS afiliados (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid    REFERENCES profiles(id) ON DELETE CASCADE,
  codigo          text    NOT NULL UNIQUE,
  comissao_pct    numeric DEFAULT 30.00,
  total_ganho     numeric DEFAULT 0,
  total_indicados integer DEFAULT 0,
  ativo           boolean DEFAULT true,
  criado_em       timestamptz DEFAULT now()
);

-- 5. pagamentos — depende de auth.users
CREATE TABLE IF NOT EXISTS pagamentos (
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

-- 6. comissoes — depende de afiliados e pagamentos
CREATE TABLE IF NOT EXISTS comissoes (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  afiliado_id  uuid    REFERENCES afiliados(id) ON DELETE CASCADE,
  pagamento_id text    REFERENCES pagamentos(id) ON DELETE SET NULL,
  valor        numeric,
  status       text    DEFAULT 'pendente',
  criado_em    timestamptz DEFAULT now()
);

-- 7. orcamentos — depende de auth.users
CREATE TABLE IF NOT EXISTS orcamentos (
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
  sig_cliente_ip       text,
  contrato_gerado_em   timestamptz,
  contrato_dados       jsonb,
  sig_token_expires_at timestamptz
);

-- 8. contratos — depende de auth.users
CREATE TABLE IF NOT EXISTS contratos (
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

-- 9. laudos — depende de auth.users
CREATE TABLE IF NOT EXISTS laudos (
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
  sig_cliente_ip       text,
  sig_token_expires_at timestamptz
);

-- 10. recibos — depende de auth.users
CREATE TABLE IF NOT EXISTS recibos (
  id          text    PRIMARY KEY,
  user_id     uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
  parcela     text
);

-- 11. documentos_assinados — depende de auth.users
CREATE TABLE IF NOT EXISTS documentos_assinados (
  id               uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id       uuid    REFERENCES auth.users(id) ON DELETE CASCADE,
  documento_tipo   text    NOT NULL,
  documento_id     uuid    NOT NULL,
  cliente_nome     text    NOT NULL,
  cliente_email    text,
  cliente_cpf      text,
  ip_assinatura    text,
  user_agent       text,
  hash_documento   text    NOT NULL,
  dados_assinatura jsonb   NOT NULL DEFAULT '{}',
  assinado_em      timestamptz DEFAULT now(),
  criado_em        timestamptz DEFAULT now()
);

-- 12. equipe_convites — depende de auth.users
CREATE TABLE IF NOT EXISTS equipe_convites (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo    text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  usado_por uuid        REFERENCES auth.users(id) ON DELETE NO ACTION,
  usado_em  timestamptz,
  criado_em timestamptz DEFAULT now(),
  ativo     boolean     NOT NULL DEFAULT true
);

-- 13. equipe_membros — depende de auth.users
CREATE TABLE IF NOT EXISTS equipe_membros (
  id        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membro_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em timestamptz DEFAULT now()
);

-- 14. equipes — depende de auth.users
CREATE TABLE IF NOT EXISTS equipes (
  id            text        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text        NOT NULL DEFAULT 'pin',
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 15. email_queue — depende de auth.users
CREATE TABLE IF NOT EXISTS email_queue (
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

-- 16. empresa_config — depende de auth.users (PK = user_id, 1 config por user)
CREATE TABLE IF NOT EXISTS empresa_config (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text        NOT NULL DEFAULT 'pin',
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 17. templates — depende de auth.users (PK = user_id, 1 template por user)
CREATE TABLE IF NOT EXISTS templates (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text        NOT NULL DEFAULT 'pin',
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 18. agenda — depende de auth.users
CREATE TABLE IF NOT EXISTS agenda (
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
  status        text    DEFAULT 'agendado',
  obs           text,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now(),
  orcamento_id  text,
  contrato_id   text,
  notas         text,
  dia_todo      boolean DEFAULT false
);

-- 19. despesas — depende de auth.users
CREATE TABLE IF NOT EXISTS despesas (
  id            text        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text        NOT NULL DEFAULT 'pin',
  data          date,
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 20. obras — depende de auth.users
CREATE TABLE IF NOT EXISTS obras (
  id            text        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform      text        NOT NULL DEFAULT 'pin',
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 21. eventos — depende de auth.users
CREATE TABLE IF NOT EXISTS eventos (
  id            text    PRIMARY KEY,
  user_id       uuid    REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo        text    NOT NULL,
  cliente       text,
  endereco      text,
  data_inicio   timestamptz,
  data_fim      timestamptz,
  cor           text    DEFAULT '#5b7fff',
  tipo          text    DEFAULT 'servico',
  orcamento_id  text,
  obs           text,
  criado_em     timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- 22. propostas_publicas — sem FK obrigatória
CREATE TABLE IF NOT EXISTS propostas_publicas (
  id            text        PRIMARY KEY,
  user_id       uuid,
  platform      text        NOT NULL DEFAULT 'pin',
  dados         jsonb       NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- 23. rate_limits — depende de auth.users
CREATE TABLE IF NOT EXISTS rate_limits (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text        NOT NULL,
  janela_ini timestamptz NOT NULL DEFAULT now(),
  contador   integer     NOT NULL DEFAULT 1,
  UNIQUE (user_id, endpoint, janela_ini)
);


-- =============================================================
-- ROW LEVEL SECURITY — habilitar em todas as tabelas
-- =============================================================
ALTER TABLE planos_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE afiliados           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE comissoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamentos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE laudos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recibos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_assinados ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_convites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipe_membros      ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda              ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras               ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE propostas_publicas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits         ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- FUNCTIONS — is_admin deve vir antes das policies que a usam
-- =============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid() LIMIT 1),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$;

CREATE OR REPLACE FUNCTION set_trial_fim()
RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW.plano = 'trial' AND NEW.trial_fim IS NULL THEN
    NEW.trial_fim := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION proteger_campos_criticos()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true) THEN
    RETURN NEW;
  END IF;
  IF NEW.plano    IS DISTINCT FROM OLD.plano    THEN NEW.plano    := OLD.plano;    END IF;
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN NEW.is_admin := OLD.is_admin; END IF;
  IF NEW.role     IS DISTINCT FROM OLD.role     THEN NEW.role     := OLD.role;     END IF;
  IF NEW.ativo    IS DISTINCT FROM OLD.ativo    THEN NEW.ativo    := OLD.ativo;    END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_cascade_plano_equipe()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_novo_plano text := NEW.plano;
  v_limite     int;
  v_count      int;
BEGIN
  IF OLD.plano = NEW.plano THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM equipe_membros WHERE owner_id = NEW.id) THEN RETURN NEW; END IF;

  IF v_novo_plano NOT IN ('equipe', 'ia-pro') THEN
    UPDATE profiles SET plano = 'gratuito', equipe_owner_id = NULL
    WHERE id IN (SELECT membro_id FROM equipe_membros WHERE owner_id = NEW.id);
    DELETE FROM equipe_membros WHERE owner_id = NEW.id;
    RETURN NEW;
  END IF;

  UPDATE profiles SET plano = v_novo_plano
  WHERE id IN (SELECT membro_id FROM equipe_membros WHERE owner_id = NEW.id);

  IF v_novo_plano = 'equipe' THEN
    v_limite := 5;
    SELECT COUNT(*) INTO v_count FROM equipe_membros WHERE owner_id = NEW.id;
    IF v_count > v_limite THEN
      UPDATE profiles SET plano = 'gratuito', equipe_owner_id = NULL
      WHERE id IN (
        SELECT membro_id FROM equipe_membros WHERE owner_id = NEW.id
        ORDER BY criado_em DESC LIMIT (v_count - v_limite)
      );
      DELETE FROM equipe_membros WHERE owner_id = NEW.id AND membro_id IN (
        SELECT membro_id FROM equipe_membros WHERE owner_id = NEW.id
        ORDER BY criado_em DESC LIMIT (v_count - v_limite)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION _on_plano_change()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF OLD.plano IN ('equipe', 'ia-pro')
     AND NEW.plano NOT IN ('equipe', 'ia-pro')
     AND NEW.equipe_owner_id IS NULL
  THEN
    UPDATE profiles SET plano = 'gratuito', equipe_owner_id = NULL WHERE equipe_owner_id = NEW.id;
    DELETE FROM equipe_membros WHERE owner_id = NEW.id;
  END IF;
  IF OLD.equipe_owner_id IS NOT NULL AND NEW.equipe_owner_id IS NULL THEN
    DELETE FROM equipe_membros WHERE membro_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION incrementar_laudos_mes()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET laudos_mes = laudos_mes + 1, atualizado_em = now() WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION decrementar_laudos_mes()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF date_trunc('month', OLD.criado_em) = date_trunc('month', now()) THEN
    UPDATE profiles SET laudos_mes = GREATEST(0, laudos_mes - 1), atualizado_em = now() WHERE id = OLD.user_id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION incrementar_orcamentos_total()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET orcamentos_total = orcamentos_total + 1, atualizado_em = now() WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION decrementar_orcamentos_total()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET orcamentos_total = GREATEST(0, orcamentos_total - 1), atualizado_em = now() WHERE id = OLD.user_id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
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

-- Trigger de email de boas-vindas — disparado em auth.users INSERT
-- (registrar no Supabase dashboard: Auth > Hooks ou via trigger em auth.users)
CREATE OR REPLACE FUNCTION agendar_sequencia_email()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.email_queue (user_id, email, nome, template, agendado_para)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome', 'boas_vindas',       now() + interval '2 minutes');
  INSERT INTO public.email_queue (user_id, email, nome, template, agendado_para)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome', 'dica_d3',           now() + interval '3 days');
  INSERT INTO public.email_queue (user_id, email, nome, template, agendado_para)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome', 'trial_d10',         now() + interval '10 days');
  INSERT INTO public.email_queue (user_id, email, nome, template, agendado_para)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'nome', 'ultima_chance_d14', now() + interval '13 days 12 hours');
  RETURN NEW;
END;
$$;

-- RPCs de negócio
CREATE OR REPLACE FUNCTION check_rate_limit(
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

CREATE OR REPLACE FUNCTION check_laudo_permitido()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p   record;
  v_lim int; v_usado int; v_rest int;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('permitido', false, 'motivo', 'nao_autenticado'); END IF;
  SELECT p.plano, p.laudos_mes, pc.limite_laudos_mes INTO v_p
  FROM profiles p LEFT JOIN planos_config pc ON pc.id = p.plano WHERE p.id = v_uid;
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

CREATE OR REPLACE FUNCTION meu_uso()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p   record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('erro', 'nao_autenticado'); END IF;
  SELECT p.plano, p.laudos_mes, p.laudos_mes_reset_em, p.orcamentos_total,
         pc.limite_laudos_mes, pc.limite_orcamentos INTO v_p
  FROM profiles p LEFT JOIN planos_config pc ON pc.id = p.plano WHERE p.id = v_uid;
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

CREATE OR REPLACE FUNCTION resetar_laudos_mes()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_inicio_mes date := date_trunc('month', now())::date;
  v_total int;
BEGIN
  UPDATE profiles SET laudos_mes = 0, laudos_mes_inicio = v_inicio_mes, atualizado_em = now()
  WHERE laudos_mes_inicio < v_inicio_mes AND laudos_mes > 0;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION ativar_plano(
  p_user_id uuid, p_plano text, p_mp_payment_id text, p_valor numeric, p_metodo text,
  p_periodo_inicio timestamptz, p_periodo_fim timestamptz, p_mp_subscription_id text
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET plano = p_plano, ativo = true WHERE id = p_user_id;
  INSERT INTO subscriptions (user_id, plano, status, mp_subscription_id, mp_payment_id_ultimo, periodo_inicio, periodo_fim, atualizado_em)
  VALUES (p_user_id, p_plano, 'ativa', p_mp_subscription_id, p_mp_payment_id, p_periodo_inicio, p_periodo_fim, now())
  ON CONFLICT (user_id) DO UPDATE SET
    plano = EXCLUDED.plano, status = 'ativa', mp_subscription_id = EXCLUDED.mp_subscription_id,
    mp_payment_id_ultimo = EXCLUDED.mp_payment_id_ultimo, periodo_inicio = EXCLUDED.periodo_inicio,
    periodo_fim = EXCLUDED.periodo_fim, atualizado_em = now();
  INSERT INTO pagamentos (user_id, mp_payment_id, valor, status, metodo, plano)
  VALUES (p_user_id, p_mp_payment_id, p_valor, 'aprovado', p_metodo, p_plano)
  ON CONFLICT (mp_payment_id) DO UPDATE SET status = 'aprovado', valor = EXCLUDED.valor;
END;
$$;

CREATE OR REPLACE FUNCTION cancelar_emails_trial(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE public.email_queue SET status = 'cancelado'
  WHERE user_id = p_user_id AND template IN ('trial_d10', 'ultima_chance_d14') AND status = 'pendente';
END;
$$;

CREATE OR REPLACE FUNCTION verificar_expiracao_trial(p_user_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Acesso negado: você só pode verificar seu próprio trial.';
  END IF;
  UPDATE profiles SET plano = 'gratuito', atualizado_em = now()
  WHERE id = p_user_id AND plano = 'trial' AND trial_fim IS NOT NULL AND trial_fim < now()
    AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ativa');
END;
$$;

CREATE OR REPLACE FUNCTION solicitar_exclusao_conta()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_exclusao_em timestamptz := now() + interval '30 days';
BEGIN
  UPDATE public.profiles SET conta_excluir_em = v_exclusao_em, ativo = false, atualizado_em = now() WHERE id = auth.uid();
  UPDATE public.subscriptions SET status = 'cancelada', atualizado_em = now() WHERE user_id = auth.uid() AND status = 'ativa';
  RETURN jsonb_build_object(
    'agendado_para', v_exclusao_em,
    'mensagem', 'Conta marcada para exclusão em 30 dias. Você pode cancelar acessando a plataforma antes dessa data.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION cancelar_exclusao_conta()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET conta_excluir_em = NULL, ativo = true, atualizado_em = now()
  WHERE id = auth.uid() AND conta_excluir_em IS NOT NULL AND conta_excluir_em > now();
END;
$$;

CREATE OR REPLACE FUNCTION registrar_consentimento(p_versao text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  UPDATE public.profiles SET lgpd_aceito = true, lgpd_aceito_em = now(), lgpd_versao = p_versao,
    termos_aceitos_em = now(), atualizado_em = now() WHERE id = auth.uid();
END;
$$;

-- RPCs de equipe
CREATE OR REPLACE FUNCTION validar_convite_equipe(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_owner_id  uuid;
  v_dono_nome text;
BEGIN
  SELECT owner_id INTO v_owner_id FROM equipe_convites
  WHERE upper(codigo) = upper(p_codigo) AND ativo = true AND expira_em > now() AND usado_por IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('valido', false, 'dono_nome', null); END IF;
  SELECT nome INTO v_dono_nome FROM profiles WHERE id = v_owner_id;
  RETURN jsonb_build_object('valido', true, 'dono_nome', COALESCE(v_dono_nome, '—'));
END;
$$;

CREATE OR REPLACE FUNCTION entrar_equipe(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_owner_id   uuid;
  v_convite_id uuid;
  v_dono_plano text;
  v_count      int;
  v_lim        int;
BEGIN
  SELECT id, owner_id INTO v_convite_id, v_owner_id FROM equipe_convites
  WHERE upper(codigo) = upper(p_codigo) AND ativo = true AND expira_em > now() AND usado_por IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Convite inválido ou expirado.'); END IF;
  IF v_owner_id = v_uid THEN RETURN jsonb_build_object('ok', false, 'erro', 'Você é o dono desta equipe.'); END IF;
  SELECT plano INTO v_dono_plano FROM profiles WHERE id = v_owner_id;
  v_lim := CASE v_dono_plano WHEN 'ia-pro' THEN 9999 ELSE 5 END;
  SELECT COUNT(*) INTO v_count FROM equipe_membros WHERE owner_id = v_owner_id;
  IF v_count >= v_lim THEN RETURN jsonb_build_object('ok', false, 'erro', 'Equipe já atingiu o limite de membros.'); END IF;
  INSERT INTO equipe_membros (owner_id, membro_id) VALUES (v_owner_id, v_uid) ON CONFLICT (membro_id) DO NOTHING;
  UPDATE profiles SET plano = v_dono_plano, equipe_owner_id = v_owner_id WHERE id = v_uid;
  UPDATE equipe_convites SET usado_por = v_uid, usado_em = now() WHERE id = v_convite_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION aceitar_convite_equipe(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_convite    equipe_convites%ROWTYPE;
  v_owner_plano text; v_owner_nome text; v_limite int; v_count int;
BEGIN
  SELECT * INTO v_convite FROM equipe_convites
  WHERE UPPER(codigo) = UPPER(p_codigo) AND usado_por IS NULL AND expira_em > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Convite inválido ou expirado.'); END IF;
  IF v_convite.owner_id = auth.uid() THEN RETURN jsonb_build_object('ok', false, 'erro', 'Você é o dono desta equipe.'); END IF;
  IF EXISTS (SELECT 1 FROM equipe_membros WHERE membro_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Você já faz parte de uma equipe.');
  END IF;
  SELECT plano, COALESCE(nome, empresa, 'Profissional') INTO v_owner_plano, v_owner_nome FROM profiles WHERE id = v_convite.owner_id;
  IF v_owner_plano NOT IN ('equipe', 'ia-pro') THEN RETURN jsonb_build_object('ok', false, 'erro', 'O dono desta equipe não tem plano ativo.'); END IF;
  v_limite := CASE WHEN v_owner_plano = 'equipe' THEN 5 ELSE 9999 END;
  SELECT COUNT(*) INTO v_count FROM equipe_membros WHERE owner_id = v_convite.owner_id;
  IF v_count >= v_limite THEN RETURN jsonb_build_object('ok', false, 'erro', 'Equipe já está cheia (vagas: 0).'); END IF;
  INSERT INTO equipe_membros (owner_id, membro_id) VALUES (v_convite.owner_id, auth.uid()) ON CONFLICT (membro_id) DO NOTHING;
  UPDATE equipe_convites SET usado_por = auth.uid(), usado_em = now() WHERE id = v_convite.id;
  UPDATE profiles SET plano = v_owner_plano, equipe_owner_id = v_convite.owner_id WHERE id = auth.uid();
  RETURN jsonb_build_object('ok', true, 'owner_nome', v_owner_nome, 'plano', v_owner_plano);
END;
$$;

CREATE OR REPLACE FUNCTION criar_convite_equipe()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_plano  text;
  v_codigo text;
BEGIN
  SELECT plano INTO v_plano FROM profiles WHERE id = v_uid;
  IF v_plano NOT IN ('equipe', 'ia-pro') THEN RAISE EXCEPTION 'Plano Equipe ou IA Pro necessário.'; END IF;
  UPDATE equipe_convites SET ativo = false WHERE owner_id = v_uid;
  v_codigo := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO equipe_convites (owner_id, codigo, ativo, expira_em) VALUES (v_uid, v_codigo, true, now() + interval '30 days');
  RETURN v_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION gerar_convite_equipe()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_plano  text; v_lim int; v_membros int; v_codigo text;
BEGIN
  SELECT plano INTO v_plano FROM profiles WHERE id = auth.uid();
  IF v_plano NOT IN ('equipe', 'ia-pro') THEN RAISE EXCEPTION 'Plano não autorizado: %', v_plano; END IF;
  v_lim := CASE WHEN v_plano = 'equipe' THEN 5 ELSE 9999 END;
  SELECT COUNT(*) INTO v_membros FROM equipe_membros WHERE owner_id = auth.uid();
  IF v_membros >= v_lim THEN RAISE EXCEPTION 'Limite de % membros atingido', v_lim; END IF;
  DELETE FROM equipe_convites WHERE owner_id = auth.uid() AND usado_por IS NULL;
  INSERT INTO equipe_convites (owner_id) VALUES (auth.uid()) RETURNING codigo INTO v_codigo;
  RETURN v_codigo;
END;
$$;

CREATE OR REPLACE FUNCTION revogar_convite_equipe()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND plano IN ('equipe', 'ia-pro')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissão.');
  END IF;
  UPDATE equipe_convites SET usado_por = auth.uid(), usado_em = now() WHERE owner_id = auth.uid() AND usado_por IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION listar_membros_equipe()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid(); v_plano text; v_result jsonb;
BEGIN
  SELECT plano INTO v_plano FROM profiles WHERE id = v_uid;
  IF v_plano NOT IN ('equipe', 'ia-pro') THEN RAISE EXCEPTION 'Permissão negada.'; END IF;
  SELECT jsonb_agg(jsonb_build_object('membro_id', em.membro_id, 'nome', COALESCE(p.nome,'—'),
    'email', COALESCE(u.email,'—'), 'criado_em', em.criado_em) ORDER BY em.criado_em)
  INTO v_result FROM equipe_membros em
  JOIN profiles p ON p.id = em.membro_id LEFT JOIN auth.users u ON u.id = em.membro_id
  WHERE em.owner_id = v_uid;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION remover_membro_equipe(p_membro_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  DELETE FROM equipe_membros WHERE owner_id = v_uid AND membro_id = p_membro_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Membro não encontrado nesta equipe.'); END IF;
  UPDATE profiles SET plano = 'gratuito', equipe_owner_id = NULL WHERE id = p_membro_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION sair_equipe()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  DELETE FROM equipe_membros WHERE membro_id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Você não é membro de nenhuma equipe.'); END IF;
  UPDATE profiles SET plano = 'gratuito', equipe_owner_id = NULL WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_minha_equipe_info()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid(); v_plano text; v_count int; v_codigo text; v_owner_id uuid; v_dono_nome text;
BEGIN
  SELECT plano INTO v_plano FROM profiles WHERE id = v_uid;
  IF v_plano IN ('equipe','ia-pro') AND NOT EXISTS (SELECT 1 FROM equipe_membros WHERE membro_id = v_uid) THEN
    SELECT COUNT(*) INTO v_count FROM equipe_membros WHERE owner_id = v_uid;
    SELECT codigo INTO v_codigo FROM equipe_convites
    WHERE owner_id = v_uid AND ativo = true AND expira_em > now() AND usado_por IS NULL ORDER BY criado_em DESC LIMIT 1;
    RETURN jsonb_build_object('role', 'dono', 'codigo', COALESCE(v_codigo, ''), 'count', v_count);
  END IF;
  SELECT owner_id INTO v_owner_id FROM equipe_membros WHERE membro_id = v_uid LIMIT 1;
  IF FOUND THEN
    SELECT nome INTO v_dono_nome FROM profiles WHERE id = v_owner_id;
    RETURN jsonb_build_object('role', 'membro', 'dono_nome', COALESCE(v_dono_nome, '—'));
  END IF;
  RETURN jsonb_build_object('role', null);
END;
$$;

CREATE OR REPLACE FUNCTION registrar_assinatura_cliente(
  p_documento_tipo text, p_documento_id uuid, p_cliente_nome text,
  p_cliente_email text DEFAULT NULL, p_cliente_cpf text DEFAULT NULL,
  p_hash_documento text DEFAULT NULL, p_dados_assinatura jsonb DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_usuario_id uuid; v_assinatura_id uuid;
BEGIN
  v_usuario_id := auth.uid();
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  INSERT INTO documentos_assinados (usuario_id, documento_tipo, documento_id, cliente_nome, cliente_email, cliente_cpf, hash_documento, dados_assinatura)
  VALUES (v_usuario_id, p_documento_tipo, p_documento_id, p_cliente_nome, p_cliente_email, p_cliente_cpf, p_hash_documento, p_dados_assinatura)
  RETURNING id INTO v_assinatura_id;
  RETURN jsonb_build_object('sucesso', true, 'assinatura_id', v_assinatura_id, 'assinado_em', now());
END;
$$;

CREATE OR REPLACE FUNCTION registrar_assinatura_cliente(
  p_token text, p_tipo text, p_nome text, p_ip text, p_sig_b64 text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE v_id text; v_exp timestamptz;
BEGIN
  IF p_tipo NOT IN ('orcamento', 'laudo', 'contrato') THEN RETURN jsonb_build_object('ok', false, 'error', 'tipo inválido'); END IF;
  IF p_token IS NULL OR p_nome IS NULL OR p_sig_b64 IS NULL OR length(p_token) < 10 OR length(p_nome) < 2 OR length(p_sig_b64) < 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dados inválidos');
  END IF;
  IF p_tipo = 'orcamento' THEN
    SELECT id, sig_token_expires_at INTO v_id, v_exp FROM orcamentos WHERE sig_token = p_token AND sig_cliente IS NULL;
  ELSIF p_tipo = 'laudo' THEN
    SELECT id, sig_token_expires_at INTO v_id, v_exp FROM laudos WHERE sig_token = p_token AND sig_cliente IS NULL;
  ELSE
    SELECT id, sig_token_expires_at INTO v_id, v_exp FROM contratos WHERE sig_token = p_token AND sig_cli_base64 IS NULL;
  END IF;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'token inválido ou documento já assinado'); END IF;
  IF v_exp IS NOT NULL AND v_exp < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'link de assinatura expirado'); END IF;
  IF p_tipo = 'orcamento' THEN
    UPDATE orcamentos SET sig_cliente = p_sig_b64, sig_cliente_at = now(), sig_cliente_nome = p_nome, sig_cliente_ip = coalesce(p_ip, 'indisponível'), status = 'aprovado' WHERE id = v_id;
  ELSIF p_tipo = 'laudo' THEN
    UPDATE laudos SET sig_cliente = p_sig_b64, sig_cliente_at = now(), sig_cliente_nome = p_nome, sig_cliente_ip = coalesce(p_ip, 'indisponível') WHERE id = v_id;
  ELSE
    UPDATE contratos SET sig_cli_base64 = p_sig_b64, assinado_cli = true, sig_cli_at = now(), sig_cli_nome = p_nome, sig_cli_ip = coalesce(p_ip, 'indisponível'), status = 'ativo' WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION run_manutencao_diaria()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  agora      timestamptz := now();
  inicio_mes date        := date_trunc('month', agora)::date;
  n_trials int := 0; n_assinat int := 0; n_reset_laudos int := 0;
  v_email_id bigint;
BEGIN
  WITH rebaixados AS (
    UPDATE profiles SET plano = 'gratuito', atualizado_em = agora
    WHERE plano = 'trial' AND trial_fim IS NOT NULL AND trial_fim < agora
      AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ativa')
    RETURNING id
  ) SELECT COUNT(*) INTO n_trials FROM rebaixados;

  WITH expiradas AS (
    UPDATE subscriptions SET status = 'expirada', atualizado_em = agora
    WHERE status = 'ativa' AND periodo_fim IS NOT NULL AND periodo_fim < agora RETURNING user_id
  ) UPDATE profiles SET plano = 'gratuito', atualizado_em = agora WHERE id IN (SELECT user_id FROM expiradas);
  GET DIAGNOSTICS n_assinat = ROW_COUNT;

  WITH resetados AS (
    UPDATE profiles SET laudos_mes = 0, laudos_mes_reset_em = inicio_mes, atualizado_em = agora
    WHERE laudos_mes_reset_em < inicio_mes OR laudos_mes_reset_em IS NULL RETURNING id
  ) SELECT COUNT(*) INTO n_reset_laudos FROM resetados;

  SELECT net.http_post(
    url     := 'https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/email-sender',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) INTO v_email_id;

  RETURN jsonb_build_object('executado_em', agora, 'trials_rebaixados', n_trials,
    'assinat_expiradas', n_assinat, 'laudos_resetados', n_reset_laudos, 'email_request_id', v_email_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_producao_por_usuario()
RETURNS TABLE(user_id uuid, nome text, email text, plano text, total_orcamentos bigint, total_laudos bigint, ultimo_orcamento timestamptz, ultimo_laudo timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil = 'admin') THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;
  RETURN QUERY
  SELECT p.id, p.nome, u.email, p.plano,
    COUNT(DISTINCT o.id), COUNT(DISTINCT l.id),
    MAX(o.criado_em), MAX(l.criado_em)
  FROM profiles p
  LEFT JOIN auth.users  u ON u.id = p.id
  LEFT JOIN orcamentos  o ON o.user_id = p.id
  LEFT JOIN laudos      l ON l.user_id = p.id
  GROUP BY p.id, p.nome, u.email, p.plano
  ORDER BY (COUNT(DISTINCT o.id) + COUNT(DISTINCT l.id)) DESC;
END;
$$;


-- =============================================================
-- RLS POLICIES
-- =============================================================

-- planos_config
CREATE POLICY "planos_config_leitura_publica" ON planos_config FOR SELECT TO public USING (true);
CREATE POLICY "planos_config_admin_write"     ON planos_config FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- profiles
CREATE POLICY "profiles: leitura"          ON profiles FOR SELECT TO public      USING ((auth.uid() = id) OR is_admin());
CREATE POLICY "profiles: insercao"         ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles: atualizacao usuario" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles: atualizacao admin"   ON profiles FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "profiles: admin ve todos"      ON profiles FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- afiliados
CREATE POLICY "user_own_afiliados" ON afiliados FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- comissoes
CREATE POLICY "user_own_comissoes"        ON comissoes FOR SELECT TO public USING (afiliado_id IN (SELECT id FROM afiliados WHERE user_id = auth.uid()));
CREATE POLICY "comissoes_no_direct_write" ON comissoes FOR INSERT TO authenticated WITH CHECK (false);

-- pagamentos
CREATE POLICY "pagamentos: usuario le proprios" ON pagamentos FOR SELECT TO public      USING (auth.uid() = user_id);
CREATE POLICY "pagamentos: admin total"         ON pagamentos FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- orcamentos
CREATE POLICY "orcamentos_proprio"              ON orcamentos FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "orcamentos: public read by token" ON orcamentos FOR SELECT TO public USING ((sig_token IS NOT NULL) AND ((sig_token_expires_at IS NULL) OR (sig_token_expires_at > now())));
CREATE POLICY "orcamentos: admin ve todos"       ON orcamentos FOR SELECT TO public USING (is_admin());
CREATE POLICY "admin_all_orcamentos"             ON orcamentos FOR ALL    TO public USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.perfil = 'admin'));
CREATE POLICY "equipe_owner_ve_orcamentos"       ON orcamentos FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM equipe_membros WHERE equipe_membros.owner_id = auth.uid() AND equipe_membros.membro_id = orcamentos.user_id));

-- contratos
CREATE POLICY "contratos_owner"              ON contratos FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "contratos_public_read"        ON contratos FOR SELECT TO public USING ((sig_token IS NOT NULL) AND ((sig_token_expires_at IS NULL) OR (sig_token_expires_at > now())));
CREATE POLICY "equipe_owner_ve_contratos"    ON contratos FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM equipe_membros WHERE equipe_membros.owner_id = auth.uid() AND equipe_membros.membro_id = contratos.user_id));

-- laudos
CREATE POLICY "laudos: usuario le os proprios"      ON laudos FOR SELECT TO public USING (auth.uid() = user_id);
CREATE POLICY "laudos: usuario insere os proprios"  ON laudos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "laudos: usuario atualiza os proprios" ON laudos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "laudos: usuario deleta os proprios"  ON laudos FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "laudos: public read by token"        ON laudos FOR SELECT TO public USING ((sig_token IS NOT NULL) AND ((sig_token_expires_at IS NULL) OR (sig_token_expires_at > now())));
CREATE POLICY "laudos: admin ve todos"              ON laudos FOR SELECT TO public USING (is_admin());
CREATE POLICY "admin_all_laudos"                    ON laudos FOR ALL    TO public USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.perfil = 'admin'));
CREATE POLICY "equipe_owner_ve_laudos"              ON laudos FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM equipe_membros WHERE equipe_membros.owner_id = auth.uid() AND equipe_membros.membro_id = laudos.user_id));

-- recibos
CREATE POLICY "recibos_owner"           ON recibos FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "equipe_owner_ve_recibos" ON recibos FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM equipe_membros WHERE equipe_membros.owner_id = auth.uid() AND equipe_membros.membro_id = recibos.user_id));

-- documentos_assinados
CREATE POLICY "pintor_ve_suas_assinaturas" ON documentos_assinados FOR ALL TO public USING (auth.uid() = usuario_id);

-- email_queue
CREATE POLICY "email_queue_user_read"        ON email_queue FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "email_queue_no_direct_insert" ON email_queue FOR INSERT TO authenticated WITH CHECK (false);

-- empresa_config
CREATE POLICY "empresa_config_proprio" ON empresa_config FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- equipe_convites
CREATE POLICY "equipe_convites_owner"   ON equipe_convites FOR ALL    TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "equipe_convites_leitura" ON equipe_convites FOR SELECT TO authenticated USING (true);
CREATE POLICY "convite_pub_v2"          ON equipe_convites FOR SELECT TO public USING ((ativo = true) AND (expira_em > now()) AND (usado_por IS NULL));
CREATE POLICY "owner_convite_v2"        ON equipe_convites FOR ALL    TO public USING (owner_id = auth.uid());

-- equipe_membros
CREATE POLICY "equipe_membros_owner"       ON equipe_membros FOR ALL    TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "equipe_membros_membro_read" ON equipe_membros FOR SELECT TO authenticated USING (membro_id = auth.uid());
CREATE POLICY "ver_membros_v2"             ON equipe_membros FOR SELECT TO public USING ((owner_id = auth.uid()) OR (membro_id = auth.uid()));

-- equipes
CREATE POLICY "equipes_proprio" ON equipes FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- templates
CREATE POLICY "templates_proprio" ON templates FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- agenda
CREATE POLICY "agenda_proprio"          ON agenda FOR ALL    TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "equipe_owner_ve_agenda"  ON agenda FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM equipe_membros WHERE equipe_membros.owner_id = auth.uid() AND equipe_membros.membro_id = agenda.user_id));

-- despesas
CREATE POLICY "despesas_proprio" ON despesas FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- obras
CREATE POLICY "obras_proprio" ON obras FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- eventos
CREATE POLICY "eventos_owner" ON eventos FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- propostas_publicas
CREATE POLICY "propostas_leitura_publica" ON propostas_publicas FOR SELECT TO public      USING (true);
CREATE POLICY "propostas_insert_proprio"  ON propostas_publicas FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "propostas_update_proprio"  ON propostas_publicas FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- rate_limits (RESTRICTIVE — bloqueia acesso direto, só via RPC SECURITY DEFINER)
CREATE POLICY "rate_limits_no_direct_access" ON rate_limits AS RESTRICTIVE FOR ALL TO authenticated USING (false);


-- =============================================================
-- INDEXES (não-PK e não-UNIQUE já criados pelas constraints)
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_afiliados_user_id          ON afiliados(user_id);
CREATE INDEX IF NOT EXISTS idx_agenda_user_id             ON agenda(user_id);
CREATE INDEX IF NOT EXISTS idx_agenda_status              ON agenda(status);
CREATE INDEX IF NOT EXISTS idx_comissoes_afiliado_id      ON comissoes(afiliado_id);
CREATE INDEX IF NOT EXISTS idx_comissoes_pagamento_id     ON comissoes(pagamento_id);
CREATE UNIQUE INDEX IF NOT EXISTS contratos_sig_token_idx ON contratos(sig_token) WHERE sig_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contratos_user_id          ON contratos(user_id);
CREATE INDEX IF NOT EXISTS idx_contratos_status           ON contratos(status);
CREATE INDEX IF NOT EXISTS despesas_user_data_idx         ON despesas(user_id, data);
CREATE INDEX IF NOT EXISTS idx_email_queue_user_id        ON email_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status_agendado ON email_queue(status, agendado_para) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_equipe_convites_codigo     ON equipe_convites(codigo);
CREATE INDEX IF NOT EXISTS idx_equipe_convites_owner      ON equipe_convites(owner_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_owner       ON equipe_membros(owner_id);
CREATE INDEX IF NOT EXISTS idx_equipe_membros_membro      ON equipe_membros(membro_id);
CREATE INDEX IF NOT EXISTS idx_equipes_user_id            ON equipes(user_id);
CREATE INDEX IF NOT EXISTS idx_eventos_user_id            ON eventos(user_id);
CREATE INDEX IF NOT EXISTS idx_laudos_user_id             ON laudos(user_id);
CREATE INDEX IF NOT EXISTS idx_laudos_criado_em           ON laudos(criado_em);
CREATE INDEX IF NOT EXISTS laudos_user_data_idx           ON laudos(user_id, data DESC);
CREATE UNIQUE INDEX IF NOT EXISTS laudos_sig_token_idx    ON laudos(sig_token) WHERE sig_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS obras_user_platform_idx        ON obras(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_orcamentos_user_id         ON orcamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status          ON orcamentos(status);
CREATE INDEX IF NOT EXISTS orcamentos_user_platform_idx   ON orcamentos(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_pagamentos_user_id         ON pagamentos(user_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_status          ON pagamentos(status);
CREATE INDEX IF NOT EXISTS idx_profiles_plano             ON profiles(plano);
CREATE INDEX IF NOT EXISTS idx_profiles_trial_fim         ON profiles(trial_fim) WHERE plano = 'trial';
CREATE INDEX IF NOT EXISTS idx_profiles_equipe_owner      ON profiles(equipe_owner_id) WHERE equipe_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_propostas_user_id          ON propostas_publicas(user_id);
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_endpoint  ON rate_limits(user_id, endpoint, janela_ini);
CREATE INDEX IF NOT EXISTS idx_recibos_user_id            ON recibos(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user_id          ON templates(user_id);


-- =============================================================
-- TRIGGERS em tabelas públicas
-- =============================================================
CREATE TRIGGER trg_profiles_updated        BEFORE UPDATE ON profiles  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_trial_fim           BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_trial_fim();
CREATE TRIGGER trg_proteger_campos_criticos BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION proteger_campos_criticos();
CREATE TRIGGER trg_cascade_plano_equipe    AFTER  UPDATE ON profiles  FOR EACH ROW EXECUTE FUNCTION fn_cascade_plano_equipe();
CREATE TRIGGER trg_plano_change            AFTER  UPDATE ON profiles  FOR EACH ROW EXECUTE FUNCTION _on_plano_change();

CREATE TRIGGER trg_orcamentos_updated      BEFORE UPDATE ON orcamentos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_orcamentos_incrementar  AFTER  INSERT ON orcamentos FOR EACH ROW EXECUTE FUNCTION incrementar_orcamentos_total();
CREATE TRIGGER trg_orcamentos_decrementar  AFTER  DELETE ON orcamentos FOR EACH ROW EXECUTE FUNCTION decrementar_orcamentos_total();

CREATE TRIGGER laudos_updated_at           BEFORE UPDATE ON laudos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_laudos_incrementar_mes  AFTER  INSERT ON laudos FOR EACH ROW EXECUTE FUNCTION incrementar_laudos_mes();
CREATE TRIGGER trg_laudos_decrementar_mes  AFTER  DELETE ON laudos FOR EACH ROW EXECUTE FUNCTION decrementar_laudos_mes();

CREATE TRIGGER trg_despesas_updated        BEFORE UPDATE ON despesas FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_obras_updated           BEFORE UPDATE ON obras    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_equipes_updated         BEFORE UPDATE ON equipes  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- TRIGGERS em auth.users — registrar via Supabase dashboard
-- Auth > Database Webhooks ou via SQL com permissão de superuser:
--
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--
-- CREATE TRIGGER on_auth_user_created_email
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.agendar_sequencia_email();
-- =============================================================


-- =============================================================
-- DADOS INICIAIS — planos_config (sem estes dados, check_laudo_permitido falha)
-- =============================================================
INSERT INTO planos_config (id, nome, preco_mensal, preco_anual, ativo, limite_laudos_mes, limite_orcamentos) VALUES
  ('gratuito', 'Gratuito',  0,    0,    true,  2,    5),
  ('trial',    'Trial',     0,    0,    true,  5,    10),
  ('basico',   'Básico',    49,   490,  true,  NULL, NULL),
  ('pro',      'Pro',       97,   970,  true,  NULL, NULL),
  ('equipe',   'Equipe',    197,  1970, true,  NULL, NULL),
  ('ia-pro',   'IA Pro',    297,  2970, true,  NULL, NULL)
ON CONFLICT (id) DO NOTHING;
