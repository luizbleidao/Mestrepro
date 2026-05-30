-- ============================================================
-- Blindagem server-side: conta suspensa (profiles.ativo = false)
-- não consegue escrever em nenhuma tabela de conteúdo/negócio.
-- LEITURA (SELECT) permanece liberada — o usuário vê a plataforma.
-- Data: 2026-05-29
--
-- Estratégia: cada policy ALL de dono foi separada em:
--   SELECT  -> USING (dono)                    [livre]
--   INSERT  -> WITH CHECK (dono AND conta_ativa())
--   UPDATE  -> USING (dono) WITH CHECK (dono AND conta_ativa())
--   DELETE  -> USING (dono AND conta_ativa())
-- Policies de admin (is_admin()), service_role e SELECT públicos por
-- token foram preservadas intactas.
-- ============================================================

-- Helper: retorna false apenas quando profiles.ativo = false
CREATE OR REPLACE FUNCTION public.conta_ativa()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT ativo FROM profiles WHERE id = auth.uid()), true);
$$;
GRANT EXECUTE ON FUNCTION public.conta_ativa() TO authenticated, anon;

-- ORCAMENTOS (user_id)
DROP POLICY IF EXISTS "orcamentos_proprio" ON public.orcamentos;
CREATE POLICY "orc_owner_select" ON public.orcamentos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "orc_owner_insert" ON public.orcamentos FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "orc_owner_update" ON public.orcamentos FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "orc_owner_delete" ON public.orcamentos FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- CONTRATOS (user_id)
DROP POLICY IF EXISTS "contratos_owner" ON public.contratos;
CREATE POLICY "contr_owner_select" ON public.contratos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "contr_owner_insert" ON public.contratos FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "contr_owner_update" ON public.contratos FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "contr_owner_delete" ON public.contratos FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- RECIBOS (user_id)
DROP POLICY IF EXISTS "recibos_owner" ON public.recibos;
CREATE POLICY "recibo_owner_select" ON public.recibos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "recibo_owner_insert" ON public.recibos FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "recibo_owner_update" ON public.recibos FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "recibo_owner_delete" ON public.recibos FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- DOCUMENTOS_ASSINADOS (usuario_id)
DROP POLICY IF EXISTS "pintor_ve_suas_assinaturas" ON public.documentos_assinados;
CREATE POLICY "docasn_owner_select" ON public.documentos_assinados FOR SELECT USING (auth.uid() = usuario_id);
CREATE POLICY "docasn_owner_insert" ON public.documentos_assinados FOR INSERT WITH CHECK (auth.uid() = usuario_id AND conta_ativa());
CREATE POLICY "docasn_owner_update" ON public.documentos_assinados FOR UPDATE USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id AND conta_ativa());
CREATE POLICY "docasn_owner_delete" ON public.documentos_assinados FOR DELETE USING (auth.uid() = usuario_id AND conta_ativa());

-- LAUDOS (user_id) — já separado; recria só as de escrita com conta_ativa()
DROP POLICY IF EXISTS "laudos: usuario insere os proprios" ON public.laudos;
DROP POLICY IF EXISTS "laudos: usuario atualiza os proprios" ON public.laudos;
DROP POLICY IF EXISTS "laudos: usuario deleta os proprios" ON public.laudos;
CREATE POLICY "laudo_owner_insert" ON public.laudos FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "laudo_owner_update" ON public.laudos FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "laudo_owner_delete" ON public.laudos FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- AGENDA (user_id)
DROP POLICY IF EXISTS "agenda_proprio" ON public.agenda;
CREATE POLICY "agenda_owner_select" ON public.agenda FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "agenda_owner_insert" ON public.agenda FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "agenda_owner_update" ON public.agenda FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "agenda_owner_delete" ON public.agenda FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- DESPESAS (user_id)
DROP POLICY IF EXISTS "despesas_proprio" ON public.despesas;
CREATE POLICY "despesas_owner_select" ON public.despesas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "despesas_owner_insert" ON public.despesas FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "despesas_owner_update" ON public.despesas FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "despesas_owner_delete" ON public.despesas FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- OBRAS (user_id)
DROP POLICY IF EXISTS "obras_proprio" ON public.obras;
CREATE POLICY "obras_owner_select" ON public.obras FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "obras_owner_insert" ON public.obras FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "obras_owner_update" ON public.obras FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "obras_owner_delete" ON public.obras FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- EMPRESA_CONFIG (user_id)
DROP POLICY IF EXISTS "empresa_config_proprio" ON public.empresa_config;
CREATE POLICY "empcfg_owner_select" ON public.empresa_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "empcfg_owner_insert" ON public.empresa_config FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "empcfg_owner_update" ON public.empresa_config FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "empcfg_owner_delete" ON public.empresa_config FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- TEMPLATES (user_id)
DROP POLICY IF EXISTS "templates_proprio" ON public.templates;
CREATE POLICY "templates_owner_select" ON public.templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "templates_owner_insert" ON public.templates FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "templates_owner_update" ON public.templates FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "templates_owner_delete" ON public.templates FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- EQUIPES (user_id)
DROP POLICY IF EXISTS "equipes_proprio" ON public.equipes;
CREATE POLICY "equipes_owner_select" ON public.equipes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "equipes_owner_insert" ON public.equipes FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "equipes_owner_update" ON public.equipes FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "equipes_owner_delete" ON public.equipes FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- EQUIPE_MEMBROS (owner_id)
DROP POLICY IF EXISTS "equipe_membros_owner" ON public.equipe_membros;
CREATE POLICY "eqmemb_owner_select" ON public.equipe_membros FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "eqmemb_owner_insert" ON public.equipe_membros FOR INSERT WITH CHECK (owner_id = auth.uid() AND conta_ativa());
CREATE POLICY "eqmemb_owner_update" ON public.equipe_membros FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND conta_ativa());
CREATE POLICY "eqmemb_owner_delete" ON public.equipe_membros FOR DELETE USING (owner_id = auth.uid() AND conta_ativa());

-- EQUIPE_CONVITES (owner_id)
DROP POLICY IF EXISTS "equipe_convites_owner" ON public.equipe_convites;
CREATE POLICY "eqconv_owner_select" ON public.equipe_convites FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "eqconv_owner_insert" ON public.equipe_convites FOR INSERT WITH CHECK (owner_id = auth.uid() AND conta_ativa());
CREATE POLICY "eqconv_owner_update" ON public.equipe_convites FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND conta_ativa());
CREATE POLICY "eqconv_owner_delete" ON public.equipe_convites FOR DELETE USING (owner_id = auth.uid() AND conta_ativa());

-- IA_FOLLOWUP_AGENDADOS (user_id)
DROP POLICY IF EXISTS "owner_all_followup" ON public.ia_followup_agendados;
CREATE POLICY "iafup_owner_select" ON public.ia_followup_agendados FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "iafup_owner_insert" ON public.ia_followup_agendados FOR INSERT WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "iafup_owner_update" ON public.ia_followup_agendados FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND conta_ativa());
CREATE POLICY "iafup_owner_delete" ON public.ia_followup_agendados FOR DELETE USING (auth.uid() = user_id AND conta_ativa());

-- ============================================================
-- ROLLBACK (referência): para reverter, recriar cada policy ALL
-- original (ex.: CREATE POLICY "orcamentos_proprio" ON orcamentos
-- FOR ALL USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id))
-- e dropar as policies *_owner_* criadas acima, além de
-- DROP FUNCTION public.conta_ativa().
-- ============================================================
