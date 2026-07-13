-- Colunas e RPCs necessárias pro fluxo de cadastro (CPF anti-abuso + LGPD + indicação)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS cpf                        text,
  ADD COLUMN IF NOT EXISTS cpf_verificado              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consentimento_termos_em     timestamptz,
  ADD COLUMN IF NOT EXISTS consentimento_termos_ip     text,
  ADD COLUMN IF NOT EXISTS consentimento_marketing     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consentimento_marketing_em  timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_cpf_unico ON profiles(cpf) WHERE cpf IS NOT NULL;

CREATE OR REPLACE FUNCTION verificar_cpf_disponivel(p_cpf text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN NOT EXISTS (SELECT 1 FROM profiles WHERE cpf = p_cpf);
END;
$$;

-- Adaptado de migration-indicacoes-2026-05-23.sql: auth.users -> profiles,
-- assinaturas.usuario_id -> assinaturas.user_id (nome real da coluna).
CREATE OR REPLACE FUNCTION public.registrar_indicacao(
  p_ref_code text, p_indicado_id uuid, p_indicado_email text
)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer_id uuid;
  v_plano       text;
  v_pct         numeric;
BEGIN
  SELECT referrer_id INTO v_referrer_id FROM indicacoes
  WHERE ref_code = p_ref_code AND status = 'pendente' AND expira_em > now() LIMIT 1;

  IF v_referrer_id IS NULL THEN
    SELECT id INTO v_referrer_id FROM profiles
    WHERE replace(id::text, '-', '') ILIKE (p_ref_code || '%') LIMIT 1;
  END IF;

  IF v_referrer_id IS NULL THEN
    RETURN json_build_object('ok', false, 'erro', 'Código de indicação inválido ou expirado');
  END IF;
  IF v_referrer_id = p_indicado_id THEN
    RETURN json_build_object('ok', false, 'erro', 'Auto-indicação não permitida');
  END IF;
  IF EXISTS (SELECT 1 FROM indicacoes WHERE indicado_id = p_indicado_id) THEN
    RETURN json_build_object('ok', false, 'erro', 'Usuário já possui indicação registrada');
  END IF;

  SELECT COALESCE(a.plano, 'gratuito') INTO v_plano FROM assinaturas a WHERE a.user_id = v_referrer_id;
  v_pct := CASE
    WHEN v_plano IN ('equipe', 'ia-pro', 'ia_pro') THEN 30.00
    WHEN v_plano IN ('pro') THEN 25.00
    ELSE 20.00
  END;

  INSERT INTO indicacoes (referrer_id, indicado_id, indicado_email, ref_code, status, comissao_pct, expira_em)
  VALUES (v_referrer_id, p_indicado_id, p_indicado_email, p_ref_code, 'cadastrado', v_pct, now() + interval '90 days');

  RETURN json_build_object('ok', true, 'referrer_id', v_referrer_id, 'comissao_pct', v_pct);
END;
$$;
