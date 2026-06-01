-- ============================================================
-- MestrePro — A-02: filtrar campos sensíveis em pub_orcamento_aprovacao
-- Data: 2026-06-01
--
-- O campo data_completa contém o objeto JSON completo do orçamento,
-- incluindo empDoc (CPF/CNPJ do pintor, top-level) e, em orçamentos
-- mais antigos, um objeto 'empresa' aninhado com doc/pixChave/pixWpp.
--
-- Esta migration substitui a versão anterior da função (que já removeu
-- user_id em migration-fix-public-rpcs-2026-06-01.sql) adicionando
-- filtragem de campos sensíveis no retorno de data_completa.
--
-- Campos removidos:
--   top-level: empDoc, pixChave, pixWpp
--   nested empresa{}: doc, pixChave, pixWpp
--
-- Campos preservados (usados pela página de aprovação):
--   servicos, materiais/produtos, relacao, desconto, validade,
--   empNome, empTel, empEmail, empCidade, obs, condPag, etc.
--
-- ROLLBACK: ver bloco comentado no fim.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pub_orcamento_aprovacao(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(o) FROM (
    SELECT
      id, numero, cliente, endereco, status, total,
      aprov_token, aprov_status, aprov_at, aprov_motivo, mode, sig_token,
      -- Remove campos sensíveis do pintor em data_completa:
      --   empDoc  = CPF/CNPJ (top-level, gerado pelo wizard)
      --   pixChave, pixWpp = chaves PIX (precaução para dados migrados)
      --   empresa.doc, empresa.pixChave, empresa.pixWpp = idem, em obj aninhado
      (
        data_completa
        - 'empDoc'
        - 'pixChave'
        - 'pixWpp'
        ||
        CASE
          WHEN (data_completa ? 'empresa')
               AND jsonb_typeof(data_completa -> 'empresa') = 'object'
          THEN jsonb_build_object(
                 'empresa',
                 (data_completa -> 'empresa') - 'doc' - 'pixChave' - 'pixWpp'
               )
          ELSE '{}'::jsonb
        END
      ) AS data_completa
    FROM orcamentos
    WHERE (aprov_token = p_token OR sig_token = p_token)
      AND p_token IS NOT NULL
    LIMIT 1
  ) o;
$$;

GRANT EXECUTE ON FUNCTION public.pub_orcamento_aprovacao(text) TO anon, authenticated;

-- ============================================================
-- ROLLBACK (restaura data_completa sem filtragem):
--
-- CREATE OR REPLACE FUNCTION public.pub_orcamento_aprovacao(p_token text)
-- RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
--   SELECT to_jsonb(o) FROM (
--     SELECT id, numero, cliente, endereco, status, total, data_completa,
--            aprov_token, aprov_status, aprov_at, aprov_motivo, mode, sig_token
--     FROM orcamentos
--     WHERE (aprov_token = p_token OR sig_token = p_token) AND p_token IS NOT NULL
--     LIMIT 1
--   ) o;
-- $$;
-- GRANT EXECUTE ON FUNCTION public.pub_orcamento_aprovacao(text) TO anon, authenticated;
--
-- ============================================================
