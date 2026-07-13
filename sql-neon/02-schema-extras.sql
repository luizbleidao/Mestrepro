-- =============================================================
-- schema-neon-step2-extras.sql — tabelas secundárias (mestrepro / Neon)
-- Complementa schema-neon-step1.sql com as tabelas que só existiam em
-- migrations posteriores ao schema-base.sql: ia_uso_log, ia_followup_agendados,
-- audit_log, indicacoes, email_log, assinaturas, contato_mensagens.
-- (otp_verificacoes NÃO recriada — confirmado sem uso em produção, ver auditoria)
-- =============================================================

-- 1. assinaturas (tabela usada no admin, separada de subscriptions)
CREATE TABLE IF NOT EXISTS public.assinaturas (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plano         text        NOT NULL DEFAULT 'gratuito',
  status        text        NOT NULL DEFAULT 'ativo',
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinaturas_user_unique UNIQUE (user_id)
);
ALTER TABLE public.assinaturas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assinaturas_owner_read" ON public.assinaturas FOR SELECT USING (app.current_user_id() = user_id);
CREATE POLICY "assinaturas_admin_all"  ON public.assinaturas FOR ALL    USING (is_admin()) WITH CHECK (is_admin());

-- 2. ia_uso_log
CREATE TABLE IF NOT EXISTS ia_uso_log (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  feature       text        NOT NULL,
  tokens_usados int         DEFAULT 0,
  sucesso       boolean     DEFAULT true,
  erro          text,
  criado_em     timestamptz DEFAULT now()
);
ALTER TABLE ia_uso_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_read_log" ON ia_uso_log FOR SELECT USING (app.current_user_id() = user_id);
CREATE POLICY "admin_all_log"  ON ia_uso_log FOR ALL    USING (EXISTS (SELECT 1 FROM profiles WHERE id = app.current_user_id() AND perfil = 'admin'));
CREATE INDEX IF NOT EXISTS idx_ia_uso_log_user_feature ON ia_uso_log(user_id, feature, criado_em DESC);

-- 3. ia_followup_agendados
CREATE TABLE IF NOT EXISTS ia_followup_agendados (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  orcamento_id        uuid,
  nome_cliente        text        NOT NULL,
  mensagem_gerada     text        NOT NULL,
  dias_apos_envio     int         DEFAULT 2,
  data_envio_agendada timestamptz NOT NULL,
  enviado_em          timestamptz,
  status              text        DEFAULT 'pendente',
  criado_em           timestamptz DEFAULT now()
);
ALTER TABLE ia_followup_agendados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_followup" ON ia_followup_agendados FOR ALL USING (app.current_user_id() = user_id);
CREATE INDEX IF NOT EXISTS idx_followup_user_status ON ia_followup_agendados(user_id, status, data_envio_agendada);

-- 4. audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  tabela       text        NOT NULL,
  registro_id  text        NOT NULL,
  operacao     text        NOT NULL CHECK (operacao IN ('INSERT','UPDATE','DELETE')),
  dados_antes  jsonb,
  dados_depois jsonb,
  criado_em    timestamptz DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_admin_read" ON audit_log FOR SELECT USING (is_admin());
CREATE POLICY "audit_log_no_direct_write" ON audit_log AS RESTRICTIVE FOR INSERT WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_audit_log_tabela_reg ON audit_log(tabela, registro_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_ts    ON audit_log(user_id, criado_em DESC);

-- 5. indicacoes
CREATE TABLE IF NOT EXISTS public.indicacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  indicado_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  indicado_email   text,
  ref_code         text NOT NULL,
  status           text NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','cadastrado','ativo','pago','expirado')),
  plano_contratado text,
  comissao_pct     numeric(5,2) DEFAULT 20.00,
  comissao_brl     numeric(10,2) DEFAULT 0.00,
  valor_pago_brl   numeric(10,2),
  pago_em          timestamptz,
  expira_em        timestamptz DEFAULT (now() + interval '90 days'),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_indicacoes_referrer ON public.indicacoes(referrer_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_indicado ON public.indicacoes(indicado_id);
CREATE INDEX IF NOT EXISTS idx_indicacoes_ref_code ON public.indicacoes(ref_code);
CREATE INDEX IF NOT EXISTS idx_indicacoes_status   ON public.indicacoes(status);
ALTER TABLE public.indicacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referrer_ve_suas_indicacoes" ON public.indicacoes FOR SELECT USING (app.current_user_id() = referrer_id);
CREATE POLICY "indicado_ve_seu_registro"    ON public.indicacoes FOR SELECT USING (app.current_user_id() = indicado_id);
-- INSERT/UPDATE apenas pela API (role de aplicação) — sem policy de escrita para usuários finais.

-- 6. email_log
CREATE TABLE IF NOT EXISTS public.email_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        text NOT NULL,
  email       text NOT NULL,
  nome        text,
  resend_id   text,
  enviado_em  timestamptz NOT NULL DEFAULT now(),
  erro        text
);
CREATE INDEX IF NOT EXISTS idx_email_log_tipo_email ON public.email_log(tipo, email);
CREATE INDEX IF NOT EXISTS idx_email_log_enviado_em ON public.email_log(enviado_em);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- Sem policy de leitura para usuários finais: só a API (role de aplicação, que faz
-- bypass de RLS por ser owner da tabela) grava/lê este log operacional.

-- 7. contato_mensagens
CREATE TABLE IF NOT EXISTS contato_mensagens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  email       text NOT NULL,
  telefone    text,
  mensagem    text NOT NULL,
  ip          text,
  user_agent  text,
  respondido  boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contato_mensagens ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só a API (rota /api/contato) grava.
CREATE INDEX IF NOT EXISTS idx_contato_mensagens_ip_criado ON contato_mensagens (ip, criado_em DESC);
