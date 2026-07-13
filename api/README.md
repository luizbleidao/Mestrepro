# API — camada que substitui o PostgREST do Supabase

## Por que isso existe

O frontend (vanilla JS) hoje fala direto com o Supabase (`supabase.auth.*`,
`supabase.from(...).select/insert/update/delete`, `supabase.rpc(...)`), e o
RLS do Postgres protege os dados linha a linha. O Neon não tem um "PostgREST"
embutido, então essa pasta é a API que faz esse papel: recebe requests do
frontend, valida a sessão do Clerk, e fala com o Postgres do Neon.

## Padrão de cada rota (ver `orcamentos/index.js` como modelo)

1. `authOrRespond(req, res)` — valida o Bearer token do Clerk, resolve
   `profiles.id`. Já responde 401/403/404 e retorna `null` se falhar.
2. `withUser(profileId, fn)` — abre uma transação, seta
   `app.current_user_id` (é o que as ~60 policies RLS do
   `sql-neon/01-schema-core.sql` usam no lugar de `auth.uid()`), roda a
   query, comita.
3. Dentro da query: filtrar por `user_id = $1` explicitamente no SQL, **não
   confiar só no RLS** — é defesa em profundidade, não a única camada
   (ver `AUDITORIA-MIGRACAO-NEON-CLERK-2026-07-12.md`, seção 6).

## Variáveis de ambiente necessárias

```
NEON_DATABASE_URL=postgresql://...        # connection string do projeto Neon "mestrepro"
CLERK_SECRET_KEY=sk_test_...              # dashboard.clerk.com > API keys
CLERK_WEBHOOK_SECRET=whsec_...            # dashboard.clerk.com > Webhooks > seu endpoint
```

## Feito até agora

- `_lib/db.js`, `_lib/auth.js` — infraestrutura comum
- `webhooks/clerk.js` — provisiona `profiles` quando o Clerk cria um usuário
  (substitui os triggers `trg_handle_new_user` / `trg_boas_vindas_email` que
  rodavam em `auth.users` no Supabase)
- `me.js` — perfil + uso do plano (substitui RPC `meu_uso()` chamada direto)
- `orcamentos/index.js` — GET/POST completo, **modelo a copiar**

## Rotas que ainda faltam (mesma receita do `orcamentos/index.js`)

Cada um dos módulos abaixo precisa de rotas equivalentes (list/create, e
`[id].js` para get/update/delete). Prioridade sugerida = risco da auditoria:

- [ ] `contratos` (+ assinatura via `sig_token` público, sem auth — ver
      RPC `registrar_assinatura_cliente(p_token,...)` no schema)
- [ ] `laudos` (mesmo padrão de contratos)
- [ ] `recibos`
- [ ] `documentos_assinados`
- [ ] `equipes`, `equipe_membros`, `equipe_convites` (RPCs
      `entrar_equipe`, `criar_convite_equipe`, `listar_membros_equipe` —
      portar como chamadas SQL diretas às funções já existentes no Neon,
      elas continuam valendo, só trocam `auth.uid()` por
      `app.current_user_id()` já configurado por `withUser`)
- [ ] `agenda`, `despesas`, `obras`, `eventos`, `empresa_config`, `templates`
- [ ] `admin/*` (painel admin — checar `is_admin()` dentro da rota antes de
      qualquer coisa, igual as policies fazem)
- [ ] `portal-cliente` (acesso público por `portal_token`, sem Clerk —
      rota que NÃO passa por `authOrRespond`)
- [ ] `aprovacao` (acesso público por `aprov_token`, mesma lógica)
- [ ] `pagamentos`, `mercadopago/webhook` (webhook do MP — ver Edge Function
      `criar-preferencia-mp` original)
- [ ] `indicacoes`
- [ ] `cron/manutencao-diaria` (chama a função SQL `run_manutencao_diaria()`,
      agendada via `vercel.json` → `crons`)
- [ ] `cron/email-sender` (processa `email_queue` — o `net.http_post` que
      existia dentro do Postgres do Supabase foi removido do schema Neon de
      propósito; isso PRECISA existir como rota + cron antes de ir pra
      produção, senão nenhum e-mail automático sai)

## Realtime (Portal do Cliente)

O Neon não tem Realtime nativo. A rota `portal-cliente` pode simplesmente
não ter push — o frontend já tem fallback de "offline" pronto (ver
auditoria, seção 2). Se quiser recuperar o "ao vivo", a opção mais simples
aqui é polling a cada N segundos nessa mesma rota GET.
