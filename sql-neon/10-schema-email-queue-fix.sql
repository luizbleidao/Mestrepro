-- Neon email_queue nasceu (01-schema-core.sql) sem as colunas dados/resend_id
-- que a versão real em produção no Supabase já tem (confirmado via
-- information_schema.columns). Portando aqui para permitir passar dados
-- variáveis ao template (ex: plano_nome na confirmação de assinatura).
ALTER TABLE email_queue
  ADD COLUMN IF NOT EXISTS dados jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resend_id text;
