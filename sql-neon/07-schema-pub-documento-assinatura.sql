-- Portado do Supabase (produção, via pg_get_functiondef) em 2026-07-13.
-- Faltava no schema Neon: leitura pública (por sig_token) do documento a
-- assinar, usada por pintopro-assinar.html antes de registrar a assinatura.
CREATE OR REPLACE FUNCTION public.pub_documento_assinatura(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r jsonb;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','orcamento') INTO r FROM (
    SELECT id,numero,cliente,endereco,total,status,sig_token,sig_token_expires_at,
           sig_cliente,sig_cliente_at,sig_cliente_nome,data_completa
    FROM orcamentos WHERE sig_token = p_token LIMIT 1) x;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','laudo') INTO r FROM (
    SELECT id,numero,cliente,obra,criticidade,sig_token,sig_token_expires_at,
           sig_cliente,sig_cliente_at,sig_cliente_nome,dados
    FROM laudos WHERE sig_token = p_token LIMIT 1) x;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT to_jsonb(x) || jsonb_build_object('_tipo','contrato') INTO r FROM (
    SELECT id,numero,cliente,endereco,valor,status,sig_token,sig_token_expires_at,
           assinado_cli,sig_cli_at,sig_cli_nome,dados
    FROM contratos WHERE sig_token = p_token LIMIT 1) x;
  RETURN r;
END;
$function$;
