-- ============================================================
-- Migration: Brindes/cortesias não contam no faturamento (MRR)
-- Data: 2026-05-29
-- Contexto: assinaturas marcadas como brinde estavam sendo
--           contabilizadas como receita. Fonte da verdade do
--           flag é assinaturas.brinde.
-- ============================================================

-- 1. View de usuários passa a expor brinde (LEFT JOIN assinaturas)
CREATE OR REPLACE VIEW v_usuarios_completos AS
SELECT p.id,
    p.nome,
    u.email,
    p.plano,
    p.perfil,
    p.tel,
    COALESCE(p.tel, p.whatsapp) AS telefone,
    p.cidade,
    p.ativo,
    p.is_admin,
    p.criado_em,
    p.atualizado_em,
    p.trial_fim,
    p.obs_admin,
    p.orcamentos_total,
    p.laudos_mes,
    COALESCE(a.brinde, false) AS brinde
FROM profiles p
LEFT JOIN auth.users u ON u.id = p.id
LEFT JOIN assinaturas a ON a.user_id = p.id;

-- 2. MRR/ARR exclui assinaturas brinde/cortesia
CREATE OR REPLACE FUNCTION public.admin_get_mrr_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mrr numeric := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND (perfil = 'admin' OR is_admin = true)
  ) THEN RAISE EXCEPTION 'Acesso negado'; END IF;

  SELECT SUM(CASE p.plano
    WHEN 'basico'      THEN 49
    WHEN 'pro'         THEN 99
    WHEN 'equipe'      THEN 179
    WHEN 'ia-pro'      THEN 249
    WHEN 'pintor-std'  THEN 69
    WHEN 'pintor-pro'  THEN 99
    WHEN 'lojista'     THEN 99
    ELSE 0 END)
  INTO v_mrr
  FROM profiles p
  LEFT JOIN assinaturas a ON a.user_id = p.id
  WHERE p.plano NOT IN ('gratuito', 'trial')
    AND p.ativo = true
    AND (p.perfil IS DISTINCT FROM 'admin')
    AND (p.is_admin IS NULL OR p.is_admin = false)
    AND (a.brinde IS NULL OR a.brinde = false); -- exclui brindes/cortesias

  RETURN jsonb_build_object(
    'mrr', COALESCE(v_mrr, 0),
    'arr', COALESCE(v_mrr, 0) * 12
  );
END;
$function$;

-- ROLLBACK (referência):
--   Reverter a view removendo a coluna brinde e a RPC removendo
--   o LEFT JOIN assinaturas + filtro a.brinde.
