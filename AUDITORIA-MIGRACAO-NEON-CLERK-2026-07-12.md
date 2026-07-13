# Auditoria completa + Plano de Migração — Supabase → Neon + Clerk + Vercel Blob

**Data:** 2026-07-12
**Status:** ⏸️ SOMENTE AUDITORIA. Nenhuma alteração de código ou banco foi feita. Aguardando aprovação humana antes de qualquer execução.
**Branch analisado:** `main` (worktree `mestrepro-migration-audit-1a87bd`, commit `a203df8` — idêntico ao `main` no momento da análise).
**Fonte dos dados:** leitura estática dos 27 arquivos `.sql` do repositório (`/sql/*.sql` + `migrations-v2.sql`, ~5.500 linhas, 159 `CREATE POLICY`, 220 referências a `auth.uid()`) e dos arquivos `.html`/`.js` do frontend. **Não houve acesso ao banco de produção** — alguns pontos abaixo exigem confirmação direta no Supabase (`pg_policies`) antes de qualquer decisão, como indicado.

---

## ⚠️ Achados críticos (leia antes do resto)

Estes achados não fazem parte do escopo original da tarefa (RLS/Realtime/Storage/Auth), mas surgiram durante a auditoria e têm relevância direta para qualquer decisão de migração — e para a segurança atual em produção, independente de migrar ou não.

1. **Fontes de schema paralelas e conflitantes.** `sql/schema-base.sql` e `sql/migration-000-schema-inicial.sql` definem políticas RLS com nomes diferentes para as mesmas tabelas (ex.: `orcamentos_owner` vs. `orc_owner_select/insert/update/delete`). Como o Postgres aplica políticas permissivas com **OR**, se ambos os arquivos rodaram no banco real, as políticas se somam — não se substituem. Isso explica a duplicação massiva de políticas encontrada (159 `CREATE POLICY` no código → 117 políticas distintas após dedupe, para 31 tabelas).

2. **Possível bypass da suspensão de conta.** `migration-suspensao-rls-2026-05-29.sql` quebrou as políticas antigas `FOR ALL` de dono em SELECT/INSERT/UPDATE/DELETE separadas, adicionando checagem de `conta_ativa()` no INSERT/UPDATE/DELETE. Mas ela só derrubou políticas com os nomes de `schema-base.sql`. As políticas `_owner` de `migration-000-schema-inicial.sql` (`orcamentos_owner`, `laudos_owner`, `docs_assinados_owner`, `agenda_owner`) têm nomes diferentes, permanecem ativas com `FOR ALL USING (auth.uid() = user_id)` **sem checar `conta_ativa()`**. Se `migration-000` foi de fato aplicada em produção, uma conta suspensa ainda consegue escrever em orçamentos/laudos/documentos assinados/agenda via essa política paralela — anulando o propósito da suspensão.
   **Ação recomendada antes de migrar:** rodar no Supabase de produção:
   ```sql
   SELECT tablename, policyname, cmd, qual FROM pg_policies
   WHERE tablename IN ('orcamentos','laudos','documentos_assinados','agenda');
   ```
   para confirmar quais políticas estão realmente ativas hoje.

3. **Vazamento cross-tenant confirmado: `equipe_convites_leitura`.** Política `FOR SELECT TO authenticated USING (true)` em `equipe_convites` (schema-base.sql) — **qualquer usuário autenticado pode ler os códigos de convite de qualquer equipe**, não só a sua. Nunca foi revogada por nenhuma migration posterior. Isto é uma falha de segurança ativa hoje, independente da migração — recomendo tratar como bug a corrigir com prioridade, e certamente **não replicar** este comportamento na nova stack.

4. **`propostas_publicas` pode estar com leitura pública quebrada.** `migration-fix-anon-leak-searchpath-2026-05-31.sql` removeu a política `propostas_leitura_publica` (que era `USING(true)`, um vazamento público total), mas — diferente do que foi feito para `orcamentos`/`laudos`/`contratos` (que ganharam RPCs `pub_orcamento_*`/`pub_documento_assinatura` como substituto seguro) — não criou nenhuma RPC substituta para `propostas_publicas`. Resultado provável: **ninguém consegue mais ler `propostas_publicas` via anon key** hoje em produção. Verificar se essa feature está de fato quebrada antes de decidir replicá-la ou não no Neon.

5. **Schema base não existe como migration única — débito já registrado no `CLAUDE.md`, confirmado pela auditoria.** `migration-000-schema-inicial.sql` não recria 7 tabelas que existem em `schema-base.sql`: `equipes`, `empresa_config`, `templates`, `despesas`, `obras`, `eventos`, `propostas_publicas`. Rodar apenas `migration-000` em um ambiente novo deixaria essas tabelas (e suas RLS) inexistentes. Isso reforça a necessidade do passo 1 do plano de migração (schema canônico único, ver seção 6).

6. **`migration-email-queue-2026-05-26.sql` define `email_queue` com schema divergente do já existente** (`tipo, dados, resend_id` vs. `user_id, template, agendado_para` de `schema-base.sql`). Como a tabela já existe, o `CREATE TABLE IF NOT EXISTS` é no-op, mas o código dessa migration assume colunas que não existem na tabela real — RPCs escritos contra essa migration provavelmente falham silenciosamente em produção. Verificar antes de portar a lógica de fila de e-mails.

> **Recomendação geral:** antes de decidir a arquitetura de RLS-equivalente no Neon, rode uma auditoria `pg_policies` no banco de produção real para confirmar qual conjunto de ~117 políticas está de fato ativo — este documento reflete o código-fonte, que contém definições paralelas cuja ordem real de aplicação em produção não pode ser confirmada só pelos arquivos.

---

## 1. Inventário de políticas RLS (por tabela)

31 tabelas com RLS habilitado, 117 políticas ativas distintas (após dedupe por tabela+nome). Nenhuma tabela foi encontrada com RLS habilitado sem nenhuma política, exceto `contato_mensagens` (proposital — só a Edge Function via `service_role` acessa). Nenhuma tabela tem políticas definidas com RLS desabilitado.

Legenda de risco: **alto** = envolve isolamento entre usuários/equipes pagantes, billing, ou dados que vazam entre tenants se a regra sair errada; **médio** = dado do próprio usuário sem risco de vazamento cross-tenant grave; **baixo** = dado público ou de referência.

### profiles
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| profiles: leitura | SELECT | usuário vê o próprio perfil OU admin vê todos | alto |
| profiles: insercao | INSERT | só pode inserir com seu próprio id | alto |
| profiles: atualizacao usuario | UPDATE | só atualiza o próprio perfil | alto |
| profiles: atualizacao admin | UPDATE | admin atualiza qualquer perfil | alto |
| profiles: admin ve todos | ALL | admin acesso total | alto |
| profiles_owner *(M000, duplicata)* | ALL | dono vê/edita tudo do próprio perfil | alto |

### subscriptions / assinaturas
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| subscriptions_owner / user_own_subscription *(duplicatas)* | ALL | dono vê/edita a própria assinatura | alto |
| admin_all_subscriptions | ALL | admin acesso total (`is_admin()`) | alto |
| assinaturas_owner_read | SELECT | dono lê a própria assinatura | alto |
| assinaturas_admin_all | ALL | admin acesso total | alto |

### pagamentos
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| pagamentos: usuario le proprios / pagamentos_owner / user_own_pagamentos *(duplicatas)* | SELECT | usuário lê os próprios pagamentos | alto |
| pagamentos: admin total / admin_all_pagamentos | ALL | admin acesso total | alto |

### afiliados / comissoes / indicacoes
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| user_own_afiliados / afiliados_owner *(duplicatas)* | ALL | dono só vê/edita seu próprio registro de afiliado | alto (comissão/dinheiro) |
| user_own_comissoes / comissoes_owner *(duplicatas)* | SELECT | vê comissões cujo `afiliado_id` é seu | alto |
| comissoes_no_direct_write | INSERT (`CHECK false`) | bloqueia insert direto — só via RPC | alto |
| referrer_ve_suas_indicacoes | SELECT | vê indicações onde é o referrer | alto |
| indicado_ve_seu_registro | SELECT | vê o próprio registro como indicado | alto |
| service_role_gerencia_indicacoes | ALL | só service_role escreve | alto |

### orcamentos / contratos / laudos / recibos / documentos_assinados
| Tabela | Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|---|
| orcamentos | admin_all_orcamentos / orcamentos: admin ve todos | SELECT/ALL | admin vê tudo | alto |
| orcamentos | equipe_owner_ve_orcamentos | SELECT | dono de equipe vê orçamentos dos membros | alto |
| orcamentos | **orcamentos_owner** *(M000)* | ALL | dono acesso total **sem checar `conta_ativa()`** — ver achado crítico #2 | **alto** |
| orcamentos | orc_owner_select/insert/update/delete | SELECT/INSERT/UPDATE/DELETE | dono only; escrita exige `conta_ativa()` | alto |
| contratos | equipe_owner_ve_contratos, contr_owner_select/insert/update/delete | — | mesmo padrão de orcamentos | alto |
| laudos | laudos: admin ve todos, admin_all_laudos, equipe_owner_ve_laudos | SELECT/ALL | admin/equipe veem | alto |
| laudos | **laudos_owner** *(M000)* | ALL | dono acesso total sem `conta_ativa()` — mesmo risco do achado #2 | **alto** |
| laudos | laudo_owner_insert/update/delete, "laudos: usuario le os proprios" | — | dono only; escrita exige `conta_ativa()` | alto |
| recibos | equipe_owner_ve_recibos, recibo_owner_select/insert/update/delete | — | dono/equipe only; escrita exige `conta_ativa()` | médio |
| documentos_assinados | **docs_assinados_owner** *(M000)* | ALL | dono acesso total sem `conta_ativa()` | médio-alto (valor jurídico) |
| documentos_assinados | docasn_owner_select/insert/update/delete | — | dono only; escrita exige `conta_ativa()` | médio |

### equipes / equipe_membros / equipe_convites
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| **equipe_convites_leitura** | SELECT (`USING true`) | **qualquer usuário logado lê todos os convites de todas as equipes** | **alto — vazamento confirmado (achado crítico #3)** |
| convite_pub_v2 | SELECT (público, sem auth) | qualquer um lê convites ativos/não expirados/não usados (necessário para validar código antes do login) | alto (comportamento intencional) |
| owner_convite_v2, eqconv_owner_* | ALL/SELECT/INSERT/UPDATE/DELETE | dono gerencia seus convites | alto |
| equipe_membros_membro_read, ver_membros_v2, eqmemb_owner_* | SELECT/INSERT/UPDATE/DELETE | membro vê a própria linha; dono vê/gerencia membros da equipe | alto |
| equipes_owner_select/insert/update/delete | — | dono only; escrita exige `conta_ativa()` | médio |

### Demais tabelas (padrão dono-only, risco médio salvo indicação)
`empresa_config`, `templates`, `agenda` (+ `agenda_owner` M000 sem `conta_ativa()`, mesmo padrão do achado #2), `despesas`, `obras`, `eventos` (nunca migrada para o padrão `conta_ativa()`), `email_queue` (+ bloqueio de insert direto, service_role gerencia a fila), `ia_uso_log` (controle de quota do plano IA Pro — **alto**), `ia_followup_agendados` (médio-alto, feature paga), `rate_limits` (`USING false` restritiva — só RPC `check_rate_limit` acessa — **alto**, proteção antifraude), `audit_log` (`INSERT` bloqueado, só admin lê — **alto**), `otp_verificacoes` (`USING false` total — só RPCs de OTP acessam), `planos_config` (leitura pública, escrita só admin), `contato_mensagens` (sem política, só service_role).

### propostas_publicas
| Política | Operação | Regra (resumo) | Risco |
|---|---|---|---|
| propostas_insert_proprio / propostas_update_proprio | INSERT/UPDATE | dono cria/edita | baixo |
| *(sem SELECT)* | — | leitura pública removida em 31/05 sem substituto — ver achado crítico #4 | baixo (dado não sensível, mas feature possivelmente quebrada) |

---

## 2. Realtime — dependência e impacto de remoção

**Escopo é mínimo: uma única feature usa Realtime em todo o projeto.**

| Local | Canal/Tabela | Feature | Impacto se removido |
|---|---|---|---|
| `pintopro-portal-cliente.html:306-345` | `portal-<orcamento_id>` → `postgres_changes` UPDATE em `orcamentos` | Portal do Cliente: progresso ao vivo, etapa, fotos e chat pintor↔cliente | **Degrada silenciosamente.** Já está em try/catch — se falhar, só loga aviso no console. Sem Realtime, o cliente precisa recarregar a página para ver atualizações; o indicador "🟢 Ao vivo" fica preso em "⚪ Conectando..." (bug cosmético, não funcional). Envio de mensagens continua funcionando normalmente (é um insert/RPC comum, não depende de Realtime). |

Nenhum outro uso de `.channel()`, `postgres_changes`, `broadcast` ou `presence` no restante do app (SPA principal, admin, laudos, orçamentos, IA — todos usam reload/polling comum).

**Recomendação de migração:** dado o escopo (1 canal, 1 tabela, 1 filtro), a substituição é um trabalho de meio dia — não uma reformulação de arquitetura. Opções para Neon (sem Realtime nativo): (a) polling em intervalo curto da linha de `orcamentos` (mais simples, compatível com o baixo risco da feature), (b) `LISTEN/NOTIFY` do Postgres atrás de um relay websocket pequeno, (c) serviço terceiro (Pusher/Ably) disparado no mesmo ponto em que hoje o app grava `portal_progresso`/`portal_mensagens`. Se a substituição não cobrir o indicador "ao vivo", remover ou renomear esse elemento de UI para não prometer algo que não existe mais.

---

## 3. Storage — Supabase Storage não é usado

**Achado importante: o projeto não usa Supabase Storage.** Nenhum bucket, nenhuma chamada `.storage.from()`/`getPublicUrl()`/`createSignedUrl()`, nenhuma política em `storage.objects`/`storage.buckets` existe em nenhum arquivo (`.html`, `.js`, ou `.sql`).

Todo "arquivo" hoje é tratado como **base64 embutido em colunas JSONB/text**, nunca enviado a um bucket:

| Feature | Onde vive | Mecanismo |
|---|---|---|
| Logo da empresa | `profiles.empresa_data.logo` (JSONB) + cache em localStorage | `FileReader.readAsDataURL()` |
| Assinatura digital | `documentos_assinados.sig_cli_base64` | `canvas.toDataURL('image/png')` → RPC `registrar_assinatura_cliente` |
| Fotos do portal do cliente | `orcamentos.portal_fotos` (JSONB array) | strings base64/URL renderizadas direto em `<img src>` |
| Fotos de laudos | array em memória `SEL[id].fotos[].b64`, persistido no laudo | `FileReader.readAsDataURL()` |
| Anexos genéricos | array `{name, type, b64, leg}` | `FileReader.readAsDataURL()` |

**Implicação para a migração:** não há política de bucket para portar — é trabalho novo, não um "de-para". Se o objetivo é ir para Vercel Blob (que não tem conceito de bucket/RLS — controle de acesso precisa virar URL assinada gerada no backend após checar posse via `auth.uid()`/equivalente Clerk), o trabalho real é: extrair os blobs base64 hoje presos em colunas JSONB → subir para Vercel Blob → trocar as colunas por referências de URL. Isso também resolve um problema de performance/custo já existente (base64 infla ~33% o tamanho da linha e é lido por completo em cada `SELECT`, mesmo quando a foto não é exibida). Dado LGPD (fotos de clientes, assinaturas), as URLs devem ser privadas com expiração curta, nunca públicas.

---

## 4. Auth — uso de Supabase Auth e fluxos

### 4.1 Chamadas `supabase.auth.*` (mapa completo)
Login (email/senha + Google OAuth), Signup, Reset de senha, Troca de senha logado, `onAuthStateChange` (evento `PASSWORD_RECOVERY`), `getSession`/`refreshSession` (bootstrap de cada tela e antes do checkout Mercado Pago), `signOut`. Presentes em `pintopro-login.html`, `pintopro-app.html`, `pintopro-admin.html`, `pintopro-ia.html`, `pintopro-orcamentos.html`, `pintopro-planos.html`, `pintopro-posts.html`, e nas Edge Functions `_shared/ia-utils.ts` e `criar-preferencia-mp` (via `sb.auth.getUser()` para validar o bearer token).

Cada módulo do app (`pintopro-orcamentos.html`, `pintopro-laudos.html`, `pintopro-ia.html`, `pintopro-posts.html`) roda como **iframe** com seu próprio client supabase-js — a sessão não é passada por `postMessage`, é compartilhada via localStorage do supabase-js (mesma origem).

### 4.2 Fluxo de recuperação de senha (100% nativo do Supabase Auth)
`resetPasswordForEmail` → Supabase envia email próprio com magic link → volta para `pintopro-login.html` com hash `#type=recovery` → `onAuthStateChange('PASSWORD_RECOVERY')` (+ fallback manual checando o hash) → `updateUser({password})`. Não usa o sistema de emails próprio (`emails-automaticos`/Resend) — é o email nativo do Supabase Auth. **Sob Clerk, esse fluxo inteiro é substituído pelo equivalente nativo do Clerk** (que tem seu próprio magic link de reset), só precisa re-estilizar o template.

### 4.3 Convite/entrada em equipe — agnóstico de provedor de auth
Não toca `auth.users` nem APIs do Supabase Auth diretamente — só RPCs (`validar_convite_equipe`, `entrar_equipe`) gated por `auth.uid()`. Portanto **funciona sem alteração sob Clerk**, desde que a nova stack tenha uma forma de resolver "id do usuário atual" nas RPCs (ver 4.5).

### 4.4 WhatsApp OTP — mecanismo morto/substituído
Existe (`wpp-otp-send`/`wpp-otp-verify`, tabela `otp_verificacoes`), mas **nenhum arquivo do frontend chama essas Edge Functions hoje**. Foi substituído por verificação de CPF (`verificar_cpf_disponivel`, ativo no signup real). Tratar como legado — confirmar com o dono do produto antes de descartar, mas não faz parte do fluxo de auth ativo.

### 4.5 Dependências específicas de JWT do Supabase (o que precisa de rework sob Clerk)
- **Nenhum uso de `auth.jwt()`** nas RLS/RPCs — bom sinal, sem claims customizados amarrados ao formato do Supabase.
- **Trigger `AFTER INSERT ON auth.users`** (`trg_handle_new_user` + `trg_boas_vindas_email`) — é a maior dependência estrutural: cria o registro em `profiles` e dispara o email de boas-vindas. Sob Clerk, precisa virar um webhook (`user.created`) → Edge Function que replica a mesma lógica.
- **FKs para `auth.users(id)` em quase todas as tabelas** (`profiles`, `pagamentos`, `orcamentos`, `contratos`, `laudos`, `recibos`, `documentos_assinados`, `equipe_convites/membros/equipes`, `email_queue`, `empresa_config`, `templates`, `agenda`, `despesas`, `obras`, `eventos`, `rate_limits`, `indicacoes`, tabelas de IA — ~20 tabelas). Sob Clerk isso exige decidir entre (a) manter uma tabela-sombra compatível com `auth.users` populada via webhook Clerk, ou (b) repontar todas as FKs para `profiles(id)` — opção (b) é uma migração de schema maior, em cascata.
- **`auth.uid() = ...` nas ~117 políticas RLS não é sintaxe proprietária "dura"** — é o padrão que o próprio Supabase documenta para integração com Clerk (aceitar o JWT do Clerk e mapear `auth.uid()`-equivalente para o `sub` claim), o que reduz bastante o risco desse ponto especificamente comparado ao rework de triggers/FKs acima.
- **`sb.auth.getUser()` nas Edge Functions** precisaria validar um JWT do Clerk (via JWKS) em vez de chamar a API do Supabase Auth.
- **Checagem de admin não usa claims/roles do Supabase** — é feita via coluna `profiles.perfil`/`is_admin`, totalmente portável.

### 4.6 MFA
Não implementado. Nenhum uso de TOTP/2FA em nenhum lugar do código.

---

## 5. Estrutura de tabelas (schema canônico consolidado)

31 tabelas identificadas (usando o superset de `schema-base.sql` + `migration-000-schema-inicial.sql`, resolvendo a duplicidade do achado crítico #1 e #5):

`profiles`, `subscriptions`/`assinaturas` (duas tabelas de billing coexistindo — confirmar no banco qual é a fonte de verdade real), `pagamentos`, `afiliados`, `comissoes`, `indicacoes`, `orcamentos`, `contratos`, `laudos`, `recibos`, `documentos_assinados`, `equipes`, `equipe_membros`, `equipe_convites`, `empresa_config`, `templates`, `agenda`, `despesas`, `obras`, `eventos`, `propostas_publicas`, `email_queue`, `email_log`, `ia_uso_log`, `ia_followup_agendados`, `rate_limits`, `audit_log`, `otp_verificacoes`, `planos_config`, `contato_mensagens`.

**36+ funções/RPCs** em `schema-base.sql` sozinho, mais dezenas espalhadas pelas migrations subsequentes (contagem aproximada por arquivo na seção 8). **2 jobs `pg_cron` ativos** (email sender diário, ver `migration-admin-recursos-2026-05-25.sql` e `migration-pgcron-emails-2026-05-24.sql`).

---

## 6. Schema proposto para Neon (RLS → autorização na aplicação)

Neon não tem RLS nativo integrado a um provedor de auth externo do mesmo jeito que o Supabase (embora Postgres puro suporte RLS, não há o equivalente de `auth.uid()` automático). Duas abordagens, recomendo a primeira:

### Abordagem recomendada: RLS + função `current_user_id()` alimentada pela aplicação
1. Manter RLS habilitado em todas as 31 tabelas (não abrir mão da defesa em profundidade).
2. Criar uma função `app.current_user_id()` que lê `current_setting('app.current_user_id', true)::uuid` — a API (camada Node/Edge que fala com Clerk) executa `SET LOCAL app.current_user_id = '<clerk_user_id mapeado>'` no início de cada transação/request, e todas as políticas RLS trocam `auth.uid()` por `app.current_user_id()`. Isso é uma tradução mecânica de find-and-replace nas ~117 políticas — baixo risco de reescrever a lógica de negócio, mas exige que **toda** rota da API monte essa sessão corretamente (um esquecimento = RLS não filtra nada, falha aberta).
3. Alternativa mais defensiva (maior esforço, menor risco de "vazamento por esquecimento"): mover as checagens de posse para a camada de aplicação/API (cada handler já sabe o `userId` do Clerk e filtra explicitamente as queries), usando RLS apenas como cinturão de segurança adicional com a mesma função `app.current_user_id()`. Recomendo esta para as tabelas marcadas **alto risco** acima (billing, comissões, isolamento de equipe).

### Mapeamento de identidade
- Tabela `profiles` passa a ter `clerk_user_id text unique` no lugar de (ou além de) `id uuid references auth.users`.
- Webhook Clerk (`user.created`, `user.updated`, `user.deleted`) → Edge Function/rota serverless que faz upsert em `profiles`, substituindo os triggers `trg_handle_new_user`/`trg_boas_vindas_email` de hoje.
- Todas as ~20 tabelas com FK para `auth.users(id)` passam a referenciar `profiles(id)` (chave interna própria, não o id do Clerk diretamente) — evita acoplar o schema inteiro ao formato de id do Clerk e facilita troca futura de provedor de auth.

### Políticas RLS reescritas (padrão a aplicar nas 117 políticas)
```sql
-- Antes (Supabase)
CREATE POLICY "orc_owner_select" ON orcamentos FOR SELECT
  USING (auth.uid() = user_id);

-- Depois (Neon + Clerk)
CREATE POLICY "orc_owner_select" ON orcamentos FOR SELECT
  USING (app.current_user_id() = user_id);
```
Padrões especiais a resolver caso a caso, não apenas find-and-replace:
- Políticas com `is_admin()`/checagem de `profiles.perfil` — a função helper continua igual, só troca a fonte do id do chamador.
- Políticas de acesso público via token (`pub_orcamento_*`, `convite_pub_v2`, `portal_token`, `aprov_token`) — não dependem de auth nenhum, portam sem alteração conceitual.
- Políticas `USING (false)` / bloqueio total (`rate_limits`, `otp_verificacoes`, `audit_log` insert) — portam sem alteração, só recriar a sintaxe.
- **Corrigir, não replicar:** `equipe_convites_leitura` (`USING true`) — achado crítico #3. Reescrever para `USING (equipe_id IN (SELECT equipe_id FROM equipe_membros WHERE usuario_id = app.current_user_id()))` ou equivalente.
- **Resolver antes de portar:** as políticas `_owner` do M000 sem `conta_ativa()` (achado crítico #2) — decidir a versão correta antes de gerar a versão Neon, não portar as duas.

---

## 7. Estratégia de migração de dados

**Recomendação: migração em fases por módulo, com dual-write temporário nos módulos de billing, não downtime total de uma vez.**

### Fase 0 — Pré-requisitos (bloqueantes, antes de qualquer dado se mover)
- Resolver achados críticos #1–#6 no Supabase atual (ou pelo menos documentar a decisão consciente de não corrigir antes de migrar o comportamento).
- Consolidar o schema canônico único (resolver schema-base vs. migration-000).
- Configurar Neon (branch de produção + branches de teste) e Clerk (aplicação, webhooks, templates de email).
- Construir a camada de compatibilidade `app.current_user_id()` e testá-la isoladamente.

### Fase 1 — Migração de dados "fria" para ambiente de staging
- `pg_dump` do Supabase → restore no Neon (schema idêntico, apenas troca de host). Testar toda a aplicação apontando para Neon com uma camada de auth ainda simulando Supabase (ou já com Clerk em modo de teste), sem tráfego real.
- Validar cada RPC crítica (verificação de plano, RLS, triggers de suspensão) nesse ambiente.

### Fase 2 — Migração por módulo, em produção, com janela de manutenção curta por módulo
Ordem sugerida (do menor para o maior risco/impacto):
1. **Dados de referência** (`planos_config`) — baixo risco, sem downtime necessário.
2. **Cadastro/perfil** (`profiles`, `empresa_config`, `templates`) — baixo/médio risco.
3. **Operação do dia a dia** (`clientes`/`orcamentos`, `contratos`, `laudos`, `recibos`, `agenda`, `despesas`, `obras`, `eventos`) — médio risco, mas alto volume de uso; recomendo migrar com **dual-write** (escreve nos dois bancos por um período curto, lê do antigo) antes do cutover de leitura, para poder reverter sem perda de dados se algo falhar.
4. **Equipes** (`equipes`, `equipe_membros`, `equipe_convites`) — alto risco de isolamento cross-tenant; exige teste extra do trigger `trg_cascade_plano_equipe` equivalente no novo ambiente antes do cutover.
5. **Billing/dinheiro** (`pagamentos`, `assinaturas`/`subscriptions`, `afiliados`, `comissoes`, `indicacoes`) — **maior risco de todos**. Aqui sim recomendo downtime curto e programado (madrugada, poucas transações) em vez de dual-write, porque divergência de estado de pagamento entre dois bancos é pior que uma janela de manutenção de alguns minutos. Webhook do Mercado Pago deve apontar para o novo backend só depois da virada confirmada.
6. **IA / auditoria / operacional interno** (`ia_uso_log`, `ia_followup_agendados`, `audit_log`, `rate_limits`, `otp_verificacoes`, `email_queue`, `email_log`, `contato_mensagens`) — baixo risco de negócio, pode migrar por último ou até ser recriado do zero (são dados operacionais/log, não histórico crítico do cliente).

### Fase 3 — Storage (Vercel Blob)
Como não existe Storage Supabase hoje (seção 3), este não é um passo de "migração" — é construção nova, pode rodar em paralelo às fases acima sem dependência de ordem, exceto pela necessidade de já ter Clerk funcionando para gerar URLs assinadas por usuário.

### Fase 4 — Realtime
Único ponto (Portal do Cliente), baixo risco, pode ser feito a qualquer momento — inclusive depois do cutover principal, já que hoje falha de forma segura (seção 2).

### Rollback
Cada fase deve ter um plano de rollback documentado antes de executar — principalmente a fase de billing, onde o Supabase deve permanecer como fonte de verdade "read-only de emergência" por pelo menos 30 dias após o cutover completo, antes de desligar o projeto original.

---

## 8. Estimativa de esforço/risco por módulo

| Módulo | Risco de migração | Esforço estimado | Motivo |
|---|---|---|---|
| Cadastro de clientes / perfil (`profiles`, `empresa_config`) | Baixo | Pequeno | Sem lógica de billing, isolamento simples dono-a-dono |
| Planos/config (`planos_config`) | Baixo | Trivial | Leitura pública, poucos registros |
| Orçamentos/Contratos/Laudos/Recibos (operação núcleo) | Médio | Médio-Grande | Alto volume de uso diário, muitas políticas RLS por tabela (owner+equipe+admin), mas padrão repetido e bem entendido |
| Documentos assinados (assinatura digital) | Médio-Alto | Médio | Valor jurídico dos dados, precisa de trilha de auditoria intacta na migração |
| Agenda/Despesas/Obras/Eventos | Baixo-Médio | Pequeno | Padrão dono-only simples, mas `eventos` nunca ganhou a checagem de `conta_ativa()` (inconsistência a resolver) |
| Equipes (`equipes`, `equipe_membros`, `equipe_convites`) | **Alto** | Médio | Isolamento cross-tenant é o ponto mais sensível hoje (vazamento confirmado em `equipe_convites_leitura`); trigger de cascata de downgrade precisa reimplementação cuidadosa |
| Billing (`pagamentos`, `assinaturas`/`subscriptions`) | **Alto** | Grande | Webhook Mercado Pago, dinheiro real, exige janela de manutenção e reconciliação pós-migração |
| Afiliados/Comissões/Indicações | **Alto** | Médio | Dinheiro (comissão), mas volume/complexidade menor que billing principal |
| IA (`ia_uso_log`, `ia_followup_agendados`) | Médio | Pequeno-Médio | Controla quota de feature paga (IA Pro), mas não é dinheiro direto |
| Rate limiting / OTP / Audit log | Baixo (para o negócio) / Alto (para segurança) | Pequeno | Dados operacionais, mas a lógica anti-abuso precisa ser preservada com exatidão |
| Auth (Supabase Auth → Clerk) | **Alto** | Grande | Trigger em `auth.users`, ~20 tabelas com FK em `auth.users`, todo fluxo de login/signup/reset de senha reescrito; é o item de maior esforço de engenharia do projeto inteiro, mesmo sendo "baixo risco de dado" |
| Storage → Vercel Blob | Baixo (não existe hoje) | Médio-Grande | Não é migração, é construção nova: extrair base64 de colunas JSONB, subir para Blob, trocar referências |
| Realtime (Portal do Cliente) | Baixo | Pequeno | Escopo de 1 canal, já falha de forma segura hoje |

---

## 9. Checklist de aprovação antes de qualquer execução

- [ ] Confirmar no Supabase de produção (`pg_policies`) qual conjunto real de políticas está ativo (achados críticos #1, #2)
- [ ] Decidir o que fazer com `equipe_convites_leitura` (achado #3) — corrigir agora no Supabase ou só na nova stack?
- [ ] Confirmar se `propostas_publicas` está de fato com leitura pública quebrada em produção (achado #4)
- [ ] Confirmar se `email_queue` real tem o schema de `schema-base.sql` ou de `migration-email-queue-2026-05-26.sql` (achado #6)
- [ ] Aprovar a estratégia de `app.current_user_id()` para RLS no Neon (seção 6) ou optar pela alternativa de autorização 100% na aplicação
- [ ] Aprovar a ordem de fases e a decisão de dual-write vs. downtime por módulo (seção 7)
- [ ] Aprovar o plano de Storage novo via Vercel Blob (seção 3/7, Fase 3)
- [ ] Confirmar que o escopo de Realtime é aceitável como está (seção 2) antes de despriorizar sua substituição

**Nenhuma migração real deve começar até este documento ser revisado e aprovado.**
