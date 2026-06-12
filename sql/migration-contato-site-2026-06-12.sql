-- Migration: formulário de contato do site (2026-06-12)
-- Tabela que registra as mensagens recebidas pela Edge Function contato-site.
-- Acesso apenas via service_role (a função): RLS habilitado sem políticas públicas.

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
-- Sem políticas: anon/authenticated não acessam; service_role (Edge Function) bypassa RLS.

-- Índice para o rate limit por IP na última hora
CREATE INDEX IF NOT EXISTS idx_contato_mensagens_ip_criado
  ON contato_mensagens (ip, criado_em DESC);

-- Rollback:
-- DROP TABLE IF EXISTS contato_mensagens;
