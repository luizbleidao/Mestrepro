-- migration-fix-admin-2026-05-23.sql
-- Corrige 3 bugs que impediam acesso ao painel admin:
--   1. get_usuarios_completos() verificava só perfil='admin', ignorando is_admin=true
--   2. admin_deletar_usuario RPC não existia (chamado no pintopro-admin.html)
--   3. Políticas RLS de subscriptions/pagamentos usavam perfil='admin' em vez de is_admin()

-- ══════════════════════════════════════════════════════════════════
-- FIX 1: get_usuarios_completos() — aceitar is_admin=true OU perfil='admin'
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_usuarios_completos()
RETURNS SETOF v_usuarios_completos
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Aceita AMBOS os mecanismos de admin do sistema:
  --   perfil = 'admin' (legado, migrations-v2.sql)
  --   is_admin = true  (padrão atual, schema-base.sql + todas as RLS policies)
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND (perfil = 'admin' OR is_admin = true)
  ) THEN
    RAISE EXCEPTION 'Acesso negado: permissão de admin necessária.';
  END IF;
  RETURN QUERY SELECT * FROM v_usuarios_completos;
END;
$$;

REVOKE ALL ON FUNCTION get_usuarios_completos() FROM anon;
GRANT EXECUTE ON FUNCTION get_usuarios_completos() TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- FIX 2: admin_deletar_usuario — RPC que o frontend chama mas não existia
-- Faz soft-delete: marca ativo=false e anonimiza os dados do perfil.
-- Deleção real de auth.users requer service_role key (via Edge Function).
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_deletar_usuario(target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Verificar que quem chama é admin
  SELECT (perfil = 'admin' OR is_admin = true)
    INTO v_is_admin
    FROM profiles
   WHERE id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Acesso negado.';
  END IF;

  -- Impedir auto-deleção
  IF target_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode deletar sua própria conta de admin.';
  END IF;

  -- Impedir deleção de outro admin
  IF EXISTS (
    SELECT 1 FROM profiles
     WHERE id = target_id AND (perfil = 'admin' OR is_admin = true)
  ) THEN
    RAISE EXCEPTION 'Não é possível deletar outra conta de administrador.';
  END IF;

  -- Soft-delete: desativa e anonimiza
  UPDATE profiles
     SET ativo       = false,
         nome        = 'Conta Removida',
         telefone    = NULL,
         cidade      = NULL,
         empresa_data = '{}'::jsonb,
         preferencias = '{}'::jsonb,
         atualizado_em = now()
   WHERE id = target_id;

  RETURN jsonb_build_object('ok', true, 'message', 'Usuário desativado com sucesso.');
END;
$$;

REVOKE ALL ON FUNCTION admin_deletar_usuario(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_deletar_usuario(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- FIX 3: Políticas RLS inconsistentes — usar is_admin() em vez de perfil='admin'
-- ══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin_all_subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "admin_all_pagamentos"    ON pagamentos;

CREATE POLICY "admin_all_subscriptions" ON subscriptions FOR ALL
  USING (is_admin());

CREATE POLICY "admin_all_pagamentos" ON pagamentos FOR ALL
  USING (is_admin());

-- ══════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO
-- ══════════════════════════════════════════════════════════════════
-- Execute para confirmar que as funções existem:
-- SELECT routine_name FROM information_schema.routines
--  WHERE routine_schema = 'public'
--    AND routine_name IN ('get_usuarios_completos', 'admin_deletar_usuario', 'get_producao_por_usuario');
