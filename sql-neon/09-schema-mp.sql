-- Portado do Supabase (produção, via pg_get_functiondef) em 2026-07-14.
-- Usado pelo webhook do Mercado Pago (api/webhooks/mercadopago.js) para
-- creditar comissão de indicação quando o indicado paga um plano.
-- Sem dependência de auth.uid()/auth.users — portável sem alterações.
CREATE OR REPLACE FUNCTION public.creditar_comissao(p_indicado_id uuid, p_valor_pago numeric, p_plano text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_row indicacoes%ROWTYPE; v_comissao numeric;
BEGIN
  SELECT * INTO v_row FROM indicacoes
  WHERE indicado_id = p_indicado_id AND status IN ('cadastrado','ativo')
  ORDER BY criado_em DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok',false,'msg','Sem indicacao ativa'); END IF;
  v_comissao := round((p_valor_pago * v_row.comissao_pct / 100)::numeric, 2);
  UPDATE indicacoes SET status='pago', plano_contratado=p_plano, comissao_brl=v_comissao,
    valor_pago_brl=p_valor_pago, pago_em=now() WHERE id=v_row.id;
  RETURN json_build_object('ok',true,'indicacao_id',v_row.id,'comissao_brl',v_comissao,'referrer_id',v_row.referrer_id);
END; $function$;
