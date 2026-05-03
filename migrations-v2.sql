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

-- ── 5. Coluna sig_profissional em profiles (se não existir) ─
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sig_profissional text;

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

-- Inserir planos padrão (ajuste os links do Mercado Pago)
INSERT INTO planos_config (id, nome, preco_mensal, preco_anual, mp_link_mensal, mp_link_anual)
VALUES
  ('basico',  'Básico',  49.00,  490.00, '', ''),
  ('pro',     'Pro',     97.00,  970.00, '', ''),
  ('equipe',  'Equipe', 197.00, 1970.00, '', ''),
  ('ia-pro',  'IA Pro', 297.00, 2970.00, '', '')
ON CONFLICT (id) DO NOTHING;

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

-- ── 9. Trigger: expirar trial após 7 dias ─────────────────
-- Rode manualmente via cron ou pg_cron (Supabase Pro):
-- SELECT cron.schedule('expirar-trials', '0 6 * * *', $$
--   UPDATE profiles SET plano = 'gratuito'
--   WHERE plano = 'trial'
--   AND criado_em < now() - interval '7 days'
--   AND id NOT IN (SELECT user_id FROM subscriptions WHERE status = 'ativa');
-- $$);

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
REVOKE ALL ON v_usuarios_completos FROM anon, authenticated;
GRANT SELECT ON v_usuarios_completos TO authenticated;
-- (adicionar policy no admin panel)
