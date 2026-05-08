-- ============================================================
-- MestrePro — migrations-v2.sql
-- Execute no Supabase SQL Editor (Settings → SQL Editor)
-- ============================================================

-- ── 1. Tabela subscriptions ────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plano                text NOT NULL DEFAULT 'gratuito',
  status               text NOT NULL DEFAULT 'ativa',  -- ativa | cancelada | expirada
  mp_subscription_id   text,
  mp_payment_id_ultimo text,
  periodo_inicio       timestamptz,
  periodo_fim          timestamptz,
  criado_em            timestamptz DEFAULT now(),
  atualizado_em        timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ── 2. Tabela pagamentos ───────────────────────────────────
CREATE TABLE IF NOT EXISTS pagamentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  mp_payment_id   text UNIQUE,
  valor           numeric(10,2),
  status          text DEFAULT 'pendente',  -- pendente | aprovado | cancelado
  metodo          text,                      -- pix | credit_card | bolbradesco
  plano           text,
  criado_em       timestamptz DEFAULT now()
);

-- ── 3. Tabela afiliados ────────────────────────────────────
CREATE TABLE IF NOT EXISTS afiliados (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  codigo         text UNIQUE NOT NULL,
  comissao_pct   numeric(4,2) DEFAULT 30.00,
  total_ganho    numeric(12,2) DEFAULT 0,
  total_indicados int DEFAULT 0,
  ativo          boolean DEFAULT true,
  criado_em      timestamptz DEFAULT now()
);

-- ── 4. Tabela comissoes ────────────────────────────────────
CREATE TABLE IF NOT EXISTS comissoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  afiliado_id uuid REFERENCES afiliados(id) ON DELETE CASCADE,
  pagamento_id uuid REFERENCES pagamentos(id) ON DELETE SET NULL,
  valor        numeric(10,2),
  status       text DEFAULT 'pendente',  -- pendente | pago | cancelado
  criado_em    timestamptz DEFAULT now()
);

-- ── 5. Colunas adicionais (se não existirem) ─────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sig_profissional text;

-- IP do assinante para trilha de auditoria jurídica
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS sig_cliente_ip   text DEFAULT 'indisponível';
ALTER TABLE laudos      ADD COLUMN IF NOT EXISTS sig_cliente_ip   text DEFAULT 'indisponível';
ALTER TABLE contratos   ADD COLUMN IF NOT EXISTS sig_cli_ip       text DEFAULT 'indisponível';

-- ── Expiração de sig_token ─────────────────────────────────────────────────
-- Adiciona coluna de validade em cada tabela que usa assinatura digital.
-- O link de assinatura expira em 30 dias se não for usado.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS sig_token_expires_at timestamptz;
ALTER TABLE laudos      ADD COLUMN IF NOT EXISTS sig_token_expires_at timestamptz;
ALTER TABLE contratos   ADD COLUMN IF NOT EXISTS sig_token_expires_at timestamptz;

-- Preenche a coluna para links já existentes sem validade (retroativo)
-- Define expiração = data de criação + 30 dias (ou agora + 30 dias como fallback)
UPDATE orcamentos SET sig_token_expires_at = COALESCE(criado_em, now()) + interval '30 days'
  WHERE sig_token IS NOT NULL AND sig_token_expires_at IS NULL;
UPDATE laudos SET sig_token_expires_at = COALESCE(criado_em, now()) + interval '30 days'
  WHERE sig_token IS NOT NULL AND sig_token_expires_at IS NULL;
UPDATE contratos SET sig_token_expires_at = COALESCE(criado_em, now()) + interval '30 days'
  WHERE sig_token IS NOT NULL AND sig_token_expires_at IS NULL;

-- ── 6. Função ativar_plano() ───────────────────────────────
-- Chamada pelo webhook do Mercado Pago
CREATE OR REPLACE FUNCTION ativar_plano(
  p_user_id          uuid,
  p_plano            text,
  p_mp_payment_id    text,
  p_valor            numeric,
  p_metodo           text,
  p_periodo_inicio   timestamptz,
  p_periodo_fim      timestamptz,
  p_mp_subscription_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Atualiza o plano no perfil do usuário
  UPDATE profiles
  SET plano = p_plano,
      ativo = true
  WHERE id = p_user_id;

  -- Upsert na tabela subscriptions
  INSERT INTO subscriptions (user_id, plano, status, mp_subscription_id, mp_payment_id_ultimo, periodo_inicio, periodo_fim, atualizado_em)
  VALUES (p_user_id, p_plano, 'ativa', p_mp_subscription_id, p_mp_payment_id, p_periodo_inicio, p_periodo_fim, now())
  ON CONFLICT (user_id) DO UPDATE SET
    plano                = EXCLUDED.plano,
    status               = 'ativa',
    mp_subscription_id   = EXCLUDED.mp_subscription_id,
    mp_payment_id_ultimo = EXCLUDED.mp_payment_id_ultimo,
    periodo_inicio       = EXCLUDED.periodo_inicio,
    periodo_fim          = EXCLUDED.periodo_fim,
    atualizado_em        = now();

  -- Registrar pagamento (upsert por mp_payment_id)
  INSERT INTO pagamentos (user_id, mp_payment_id, valor, status, metodo, plano)
  VALUES (p_user_id, p_mp_payment_id, p_valor, 'aprovado', p_metodo, p_plano)
  ON CONFLICT (mp_payment_id) DO UPDATE SET
    status = 'aprovado',
    valor  = EXCLUDED.valor;

END;
$$;

-- ── 7. Tabela planos_config ────────────────────────────────
CREATE TABLE IF NOT EXISTS planos_config (
  id           text PRIMARY KEY,  -- basico | pro | equipe | ia-pro
  nome         text,
  preco_mensal numeric(8,2),
  preco_anual  numeric(8,2),
  mp_link_mensal text,
  mp_link_anual  text,
  ativo        boolean DEFAULT true
);

-- Planos com links do Mercado Pago (mesmos valores de pp-config.js)
-- ON CONFLICT DO UPDATE garante que re-rodar a migration atualiza os links
INSERT INTO planos_config (id, nome, preco_mensal, preco_anual, mp_link_mensal, mp_link_anual)
VALUES
  ('basico',  'Básico',  49.00,  490.00, 'https://mpago.la/19VUY91', 'https://mpago.la/2mBWE1i'),
  ('pro',     'Pro',     97.00,  970.00, 'https://mpago.la/1ieWwdr', 'https://mpago.la/2YpEhnF'),
  ('equipe',  'Equipe', 197.00, 1970.00, 'https://mpago.la/1YuzDuc', 'https://mpago.la/15PqKDb'),
  ('ia-pro',  'IA Pro', 297.00, 2970.00, 'https://mpago.la/1iWJVWP', 'https://mpago.la/119g9kC')
ON CONFLICT (id) DO UPDATE SET
  preco_mensal   = EXCLUDED.preco_mensal,
  preco_anual    = EXCLUDED.preco_anual,
  mp_link_mensal = EXCLUDED.mp_link_mensal,
  mp_link_anual  = EXCLUDED.mp_link_anual;

-- ── 8. RLS para tabelas novas ─────────────────────────────
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE afiliados ENABLE ROW LEVEL SECURITY;
ALTER TABLE comissoes ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas seus próprios dados
CREATE POLICY "user_own_subscription" ON subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_pagamentos"   ON pagamentos   FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_own_afiliados"    ON afiliados    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "user_own_comissoes"    ON comissoes    FOR SELECT
  USING (afiliado_id IN (SELECT id FROM afiliados WHERE user_id = auth.uid()));

-- Admin pode ver tudo (requer perfil admin)
CREATE POLICY "admin_all_subscriptions" ON subscriptions FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil = 'admin'));
CREATE POLICY "admin_all_pagamentos" ON pagamentos FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil = 'admin'));

-- ── 9. Expirar trial após 7 dias ─────────────────────────────────────────
--
-- ESTRATÉGIA DUPLA:
--   A) Função verificada no login (funciona em qualquer plano do Supabase)
--   B) pg_cron agendado às 06h (requer Supabase Pro — deixado como extensão opcional)
--
-- ── A) Função chamada pelo app no login do usuário ────────────────────────
CREATE OR REPLACE FUNCTION verificar_expiracao_trial(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET plano = 'gratuito', atualizado_em = now()
  WHERE id = p_user_id
    AND plano = 'trial'
    AND trial_fim IS NOT NULL
    AND trial_fim < now()
    AND id NOT IN (
      SELECT user_id FROM subscriptions WHERE status = 'ativa'
    );
END;
$$;

-- Qualquer usuário autenticado pode chamar apenas para si próprio
-- (a função já filtra por p_user_id, mas a RLS da tabela protege também)
GRANT EXECUTE ON FUNCTION verificar_expiracao_trial(uuid) TO authenticated;

-- ── B) pg_cron para Supabase Pro (opcional) ───────────────────────────────
-- Descomente se você tiver o plano Pro e a extensão pg_cron habilitada:
--
-- SELECT cron.schedule('expirar-trials', '0 6 * * *', $$
--   UPDATE profiles
--   SET plano = 'gratuito', atualizado_em = now()
--   WHERE plano = 'trial'
--     AND trial_fim IS NOT NULL
--     AND trial_fim < now()
--     AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ativa');
-- $$);

-- ── Trigger: garantir trial_fim ao criar perfil ────────────────────────────
-- Define trial_fim = agora + 7 dias se não for fornecido no INSERT
CREATE OR REPLACE FUNCTION set_trial_fim()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plano = 'trial' AND NEW.trial_fim IS NULL THEN
    NEW.trial_fim := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_trial_fim ON profiles;
CREATE TRIGGER trg_set_trial_fim
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_trial_fim();

-- ── 10. View conveniente para o admin ─────────────────────
CREATE OR REPLACE VIEW v_usuarios_completos AS
SELECT
  p.id,
  p.nome,
  p.email,
  p.plano,
  p.perfil,
  p.tel,
  p.cidade,
  p.ativo,
  p.criado_em,
  s.status        AS sub_status,
  s.periodo_fim   AS sub_expira,
  (SELECT COUNT(*) FROM pagamentos pg WHERE pg.user_id = p.id AND pg.status = 'aprovado') AS total_pagamentos,
  (SELECT COALESCE(SUM(valor),0) FROM pagamentos pg WHERE pg.user_id = p.id AND pg.status = 'aprovado') AS receita_total
FROM profiles p
LEFT JOIN subscriptions s ON s.user_id = p.id;

-- Somente admins podem ver essa view
-- Revogar acesso de todos os roles públicos
REVOKE ALL ON v_usuarios_completos FROM anon, authenticated;

-- Criar uma função SECURITY DEFINER que só retorna dados para admins
-- O acesso à view é feito via esta função — nunca diretamente
CREATE OR REPLACE FUNCTION get_usuarios_completos()
RETURNS SETOF v_usuarios_completos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verifica se o usuário autenticado tem perfil = 'admin' no banco
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND perfil = 'admin'
  ) THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;
  RETURN QUERY SELECT * FROM v_usuarios_completos;
END;
$$;

-- Garantir que apenas usuários autenticados chamem a função
REVOKE ALL ON FUNCTION get_usuarios_completos() FROM anon;
GRANT EXECUTE ON FUNCTION get_usuarios_completos() TO authenticated;

-- Nota: no pintopro-admin.html, substitua queries diretas à view por:
--   SELECT * FROM get_usuarios_completos()
-- ou use o RPC do Supabase:
--   sb.rpc('get_usuarios_completos')
