# MestrePro — Gestão de Segredos

> **Regra de ouro:** nenhuma credencial real entra no repositório.  
> Qualquer arquivo com valores reais deve estar no `.gitignore`.

---

## Inventário completo

### Grupo 1 — Netlify Environment Variables (Frontend Build)
Configurar em: **Netlify → Site settings → Environment variables**

| Variável | Escopo | Rotação | Crítica |
|---|---|---|---|
| `SUPABASE_URL` | Build + geração do pp-config.js | Só se recriar o projeto Supabase | ✅ |
| `SUPABASE_ANON_KEY` | Build + geração do pp-config.js | A cada **90 dias** | ✅ |
| `META_PIXEL_ID` | Build → injetado no pp-config.js | Só se recriar o pixel | ⬜ |
| `GA4_MEASUREMENT_ID` | Build → injetado no pp-config.js | Só se recriar a propriedade GA4 | ⬜ |

### Grupo 2 — Supabase Secrets (Edge Functions)
Configurar em: **Supabase → Edge Functions → Manage secrets**  
Ou via CLI: `supabase secrets set NOME=valor`

| Variável | Escopo | Rotação | Crítica |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | webhook-mp, email-sender | A cada **90 dias** | ✅ |
| `MP_ACCESS_TOKEN` | webhook-mp → API Mercado Pago | A cada **180 dias** | ✅ |
| `MP_WEBHOOK_SECRET` | webhook-mp → validação HMAC | A cada **180 dias** ou ao recriar webhook | ✅ |
| `RESEND_API_KEY` | email-sender (quando ativar) | A cada **180 dias** | ⬜ |

---

## Onde buscar cada credencial

### SUPABASE_URL e SUPABASE_ANON_KEY
```
Supabase → Seu projeto → Settings → API → Project URL / anon public key
```

### SUPABASE_SERVICE_ROLE_KEY
```
Supabase → Seu projeto → Settings → API → service_role (secret)
⚠️  NUNCA expor no frontend — apenas Edge Functions
```

### MP_ACCESS_TOKEN
```
Mercado Pago → Developers → Suas aplicações → Credenciais de produção
Formato esperado: APP_USR-XXXXXXXXXXXXXXXX-XXXXXX-...
```

### MP_WEBHOOK_SECRET
```
Mercado Pago → Developers → Webhooks → sua URL → "Chave secreta"
Gerada automaticamente pelo MP ao criar/editar o webhook
```

### RESEND_API_KEY
```
resend.com → API Keys → Create API Key
Formato: re_XXXXXXXXXXXXXXXXXX
```

---

## Procedimento de rotação (a cada 90/180 dias)

### SUPABASE_ANON_KEY (90 dias)

1. Acessar **Supabase → Settings → API**
2. Clicar em **"Roll anon key"** (gera nova chave sem derrubar o serviço)
3. Copiar a nova `anon public key`
4. Atualizar no **Netlify → Environment variables → SUPABASE_ANON_KEY**
5. Fazer **redeploy manual** (Netlify → Deploys → Trigger deploy)
6. Confirmar que `build-manifest.json` tem novo `configHash`
7. Atualizar a data de rotação neste arquivo abaixo

### MP_ACCESS_TOKEN (180 dias)

1. Acessar **Mercado Pago → Developers → Suas aplicações**
2. Selecionar a aplicação MestrePro → **Credenciais**
3. Clicar em **"Renovar token"**
4. Copiar o novo `Access Token de produção`
5. Atualizar no **Supabase → Edge Functions → Manage secrets → MP_ACCESS_TOKEN**
6. Testar o webhook com uma assinatura de teste
7. Atualizar a data de rotação neste arquivo abaixo

### MP_WEBHOOK_SECRET (180 dias ou ao recriar webhook)

1. Acessar **Mercado Pago → Developers → Webhooks**
2. Editar o webhook → **"Renovar chave secreta"**
3. Copiar a nova chave
4. Atualizar no **Supabase → Edge Functions → Manage secrets → MP_WEBHOOK_SECRET**
5. A Edge Function `webhook-mp` já usa `Deno.env.get` — sem redeploy necessário
6. Testar imediatamente com uma notificação de teste do painel MP

---

## Calendário de rotação

| Credencial | Última rotação | Próxima rotação |
|---|---|---|
| SUPABASE_ANON_KEY | _preencher após rotação_ | _+90 dias_ |
| SUPABASE_SERVICE_ROLE_KEY | _preencher após rotação_ | _+90 dias_ |
| MP_ACCESS_TOKEN | _preencher após rotação_ | _+180 dias_ |
| MP_WEBHOOK_SECRET | _preencher após rotação_ | _+180 dias_ |
| RESEND_API_KEY | _quando ativar_ | _+180 dias_ |

---

## Verificação rápida de segredos (CI)

```bash
# Checar se todos os segredos estão configurados (não gera arquivos)
node inject-env.js --check-only
```

Execute antes de qualquer deploy manual ou ao suspeitar de problema.

---

## Sinais de comprometimento — agir imediatamente

- `MP_ACCESS_TOKEN` ou `SUPABASE_SERVICE_ROLE_KEY` apareceu em log público
- Push acidental de `pp-config.local.js` ou `.env` para o GitHub
- Atividade suspeita no painel do Mercado Pago ou Supabase
- Build com credenciais em URL pública (verificar `build-manifest.json`)

**Procedimento de emergência:**
1. Revogar a credencial **imediatamente** no painel do serviço
2. Gerar nova credencial
3. Atualizar no Netlify/Supabase
4. Fazer redeploy
5. Auditar logs das últimas 24h no Supabase (Auth + Edge Functions)
6. Se dados de usuários expostos: seguir protocolo LGPD de notificação

---

## Checklist para novo desenvolvedor / ambiente

- [ ] Copiar `pp-config.local.example.js` → `pp-config.local.js`
- [ ] Preencher `SUPABASE_URL` e `SUPABASE_ANON_KEY` reais no arquivo local
- [ ] Confirmar que `pp-config.local.js` aparece no `.gitignore`
- [ ] Nunca commitar arquivos com credenciais reais
- [ ] No deploy: configurar as 2 env vars obrigatórias no Netlify
- [ ] No Supabase: configurar os 3 secrets das Edge Functions
- [ ] Rodar `node inject-env.js --check-only` para validar
