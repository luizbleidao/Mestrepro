# MestrePro — Deploy Master
**Pacote unificado v1.1 — atualizado em 06/05/2026**

---

## 📦 Arquivos incluídos

| Arquivo | Função |
|---|---|
| `index.html` | Landing page |
| `pintopro-app.html` | App principal |
| `pintopro-orcamentos.html` | Orçamentos (iframe) |
| `pintopro-laudos.html` | Laudos técnicos (iframe) |
| `pintopro-login.html` | Login + cadastro + planos |
| `pintopro-planos.html` | Checkout self-service |
| `pintopro-admin.html` | Painel administrativo |
| `pintopro-assinar.html` | Assinatura digital do cliente |
| `pp-modules.js` | Contratos, recibos, agenda |
| `pp-config.js` | **Config central — links MP, preços, Supabase** |
| `pp-config.local.example.js` | Modelo para credenciais locais (ver abaixo) |
| `netlify.toml` | Roteamento, headers CSP e cache |
| `migrations-v2.sql` | Schema completo do banco |
| `supabase/functions/webhook-mp/index.ts` | Edge Function MP com validação HMAC |

---

## 🔐 Configuração de credenciais

> ⚠️ As credenciais do Supabase **não** ficam mais no repositório.
> Siga um dos caminhos abaixo antes de fazer o deploy.

### Desenvolvimento local
1. Copie `pp-config.local.example.js` e renomeie para `pp-config.local.js`
2. Preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY`
3. Adicione a tag antes de `pp-config.js` em cada HTML:
   ```html
   <script src="pp-config.local.js"></script>
   <script src="pp-config.js"></script>
   ```
4. O arquivo `.gitignore` já impede que `pp-config.local.js` entre no git

### Produção (Netlify)
1. Netlify → **Site settings → Environment variables** → adicione:
   - `SUPABASE_URL` → `https://SEU-PROJETO.supabase.co`
   - `SUPABASE_ANON_KEY` → `eyJ...`
2. Use um plugin ou script de build para injetar os valores nos placeholders
   `window.__SUPABASE_URL__` e `window.__SUPABASE_ANON__` de `pp-config.js`

---

## 🚀 Checklist de ativação — faça nesta ordem

### Passo 1 — Rodar a migration no banco (5 min)
1. Acesse [supabase.com](https://supabase.com) → seu projeto
2. Vá em **SQL Editor**
3. Cole e execute o conteúdo de `migrations-v2.sql`
4. Confirme que as tabelas e funções foram criadas, incluindo:
   - `verificar_expiracao_trial()` (expiração de trial)
   - `get_usuarios_completos()` (view segura do admin)
   - Trigger `trg_set_trial_fim`

### Passo 2 — Deploy no Netlify (5 min)
1. Acesse [netlify.com](https://netlify.com)
2. Arraste a pasta para o painel de deploy
3. Configure as variáveis de ambiente (ver seção acima)
4. Aguarde o deploy terminar e anote a URL gerada

### Passo 3 — Configurar o Webhook do Mercado Pago (15 min)
1. No Supabase → **Edge Functions** → **Deploy new function**
2. Cole o conteúdo de `supabase/functions/webhook-mp/index.ts`
3. Adicione as variáveis de ambiente **obrigatórias**:
   - `MP_ACCESS_TOKEN` → token de produção do Mercado Pago
   - `MP_WEBHOOK_SECRET` → chave secreta do webhook (gerada no painel do MP)
   - `SUPABASE_URL` → URL do seu projeto Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → chave service_role do Supabase
4. No Mercado Pago → **Notificações** → **Webhooks**
5. URL: `https://SEU-PROJETO.supabase.co/functions/v1/webhook-mp`
6. Ativar a assinatura de notificações para gerar o `MP_WEBHOOK_SECRET`

> ⚠️ **Sem a `MP_WEBHOOK_SECRET` o webhook rejeita todas as requisições.**
> Isso é intencional (fail-closed) para impedir ativação fraudulenta de planos.

### Passo 4 — Configurar usuário admin
1. Crie uma conta normalmente em `/entrar`
2. No Supabase → **Table Editor** → tabela `profiles`
3. Localize o seu registro e altere `perfil` de `pintor` para `admin`
4. Acesse `/admin` e faça login com sua conta

### Passo 5 — Testar o fluxo completo (10 min)
1. Crie uma conta nova → confirme que o trial de 7 dias iniciou imediatamente
2. Verifique `profiles.trial_fim` no banco (deve ser agora + 7 dias)
3. Crie um orçamento, laudo, contrato e recibo → confirme sem duplicações
4. Gere um link de assinatura de contrato → teste o modal com botão WhatsApp
5. Acesse `/planos` diretamente (sem sessão) → confirme que o botão de checkout aguarda o login

---

## ⚙️ Alterando preços e links do Mercado Pago

Tudo em **`pp-config.js`** — fonte única:

```js
window.PP = {
  mpBasico:      'https://mpago.la/...',
  mpBasicoAnual: 'https://mpago.la/...',
  // ...demais planos

  precos: {
    basico:   { mensal: 49,  anual: 490,  eq: 41  },
    // ...demais planos
  },
}
```

Após alterar `pp-config.js` e re-executar a migration, os valores
aparecem automaticamente em todas as páginas e na tabela `planos_config`.

---

## 📋 Planos e status de funcionalidades

| Plano | Preço | Status |
|---|---|---|
| Gratuito | Grátis | ✅ Disponível |
| Trial 7d | Grátis | ✅ Disponível |
| Básico | R$49/mês | ✅ Disponível |
| Pro | R$97/mês | ✅ Disponível |
| Equipe | R$197/mês | ⚠️ Multi-usuário em desenvolvimento (recebe Pro até lançamento) |
| IA Pro | R$297/mês | ⚠️ Early access — IA em desenvolvimento (recebe Equipe até lançamento) |

---

## 🔗 Rotas disponíveis

| URL | Destino |
|---|---|
| `/` | Landing page |
| `/entrar` | Login |
| `/app` | App principal |
| `/planos` | Escolha de plano |
| `/admin` | Painel admin |
| `/assinar` | Assinatura digital (cliente) |

---

## ❗ O que ainda falta implementar

### Curto prazo (próximas 2 semanas)
- [ ] E-mails automáticos via Resend (boas-vindas, aviso de trial expirando em 2 dias)
- [ ] Contador mensal de laudos persistente no Supabase (hoje é in-memory)
- [ ] Pixel Meta Ads + GA4 na `index.html`
- [ ] Script de build para injetar SUPABASE_URL/ANON_KEY via env no deploy

### Médio prazo (1–2 meses)
- [ ] Dashboard financeiro (faturamento, ticket médio, churn)
- [ ] Pipeline de status dos orçamentos
- [ ] CRM básico de clientes
- [ ] Multi-usuário completo (plano Equipe)
- [ ] Painel de afiliados com comissão 30%
- [ ] IA: gerador de orçamentos e análise de patologias por foto
