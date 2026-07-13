-- Portado do Supabase (produção, via pg_get_functiondef) em 2026-07-13.
-- Faltava no schema-portal original: cliente enviando mensagem pelo portal
-- público (pintor responde via responder_mensagem_portal, já portada).
CREATE OR REPLACE FUNCTION public.enviar_mensagem_portal_cliente(p_token text, p_texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_orc_id   TEXT;
  v_msgs     JSONB;
  v_nova_msg JSONB;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token inválido');
  END IF;

  IF p_texto IS NULL OR trim(p_texto) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mensagem vazia');
  END IF;

  IF length(p_texto) > 2000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mensagem muito longa');
  END IF;

  SELECT id, COALESCE(portal_mensagens, '[]'::jsonb)
    INTO v_orc_id, v_msgs
    FROM orcamentos
   WHERE portal_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Portal não encontrado ou token inválido');
  END IF;

  v_nova_msg := jsonb_build_object(
    'autor', 'cliente',
    'texto', p_texto,
    'ts',    to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  v_msgs := v_msgs || jsonb_build_array(v_nova_msg);

  UPDATE orcamentos
     SET portal_mensagens = v_msgs
   WHERE id = v_orc_id;

  RETURN jsonb_build_object('success', true, 'mensagem', v_nova_msg);
END;
$function$;
