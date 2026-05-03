# MestrePro — Deploy Master
**Pacote unificado v1.0 — gerado em 02/05/2025**

---

## 📦 Arquivos incluídos

| Arquivo | Função | Fonte |
|---|---|---|
| `index.html` | Landing page completa | Conta 2 |
| `pintopro-app.html` | App principal (merge das 3 contas) | **Merge** |
| `pintopro-orcamentos.html` | Orçamentos — Supabase como fonte | Conta 1 |
| `pintopro-laudos.html` | Laudos técnicos | Conta 3 |
| `pintopro-login.html` | Login + 4 planos + toggle mensal/anual | Conta 1 |
| `pintopro-planos.html` | Checkout self-service | Conta 2 |
| `pintopro-admin.html` | Painel administrativo | Conta 2 |
| `pintopro-assinar.html` | Assinatura digital do cliente | Conta 2 |
| `pp-modules.js` | Contratos, recibos, agenda | Conta 2/3 |
| `pp-config.js` | **Config central com links MP** | Unificado |
| `netlify.toml` | Roteamento e headers de segurança | Conta 2 |
| `migrations-v2.sql` | Schema completo do banco | Conta 3 |
| `supabase/functions/webhook-mp/index.ts` | Edge Function MP automática | Conta 3 |

---

## 🚀 Checklist de ativação — faça nesta ordem

### Passo 1 — Rodar o banco (5 min)
1. Acesse [supabase.com](https://supabase.com) → projeto `ufdrxucvyukgzvenfuhj`
2. Vá em **SQL Editor**
3. Cole e execute o conteúdo de `migrations-v2.sql`
4. Confirme que as tabelas `subscriptions`, `pagamentos`, `afiliados` foram criadas

### Passo 2 — Deploy no Netlify (5 min)
1. Acesse [netlify.com](https://netlify.com)
2. Arraste a pasta inteira para o painel de deploy
3. Aguarde o deploy terminar
4. Anote a URL gerada (ex: `mestrepro.netlify.app`)

### Passo 3 — Configurar o Webhook do Mercado Pago (15 min)
1. No Supabase → **Edge Functions** → **Deploy new function**
2. Cole o conteúdo de `supabase/functions/webhook-mp/index.ts`
3. Adicione as variáveis de ambiente:
   - `MP_ACCESS_TOKEN` → seu token de produção do Mercado Pago
   - `SUPABASE_URL` → `https://ufdrxucvyukgzvenfuhj.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` → chave service_role do Supabase
4. No painel do Mercado Pago → **Notificações IPN**
5. Coloque a URL: `https://ufdrxucvyukgzvenfuhj.supabase.co/functions/v1/webhook-mp`

### Passo 4 — Testar o fluxo completo (10 min)
1. Acesse `sua-url.netlify.app`
2. Crie uma conta nova
3. Entre no trial → tente criar orçamento → veja o trial countdown
4. Clique em "Assinar" → escolha um plano → confirme que o link do MP abre
5. (Opcional) Faça um pagamento de teste no MP e confirme que o plano ativa

### Passo 5 — Apontar domínio (opcional)
1. No Netlify → **Domain settings** → **Add custom domain**
2. Configure o DNS conforme instruído

---

## ⚙️ Ajustes em `pp-config.js`

Todos os links e configurações ficam num único lugar:

```js
window.PP = {
  supabaseUrl: '...',      // já configurado
  supabaseKey: '...',      // já configurado
  mpBasico: '...',         // links do Mercado Pago já configurados
  appNome: 'MestrePro',   // altere aqui para mudar o nome em todo o app
  appSlogan: '...',        // slogan exibido no login e sidebar
}
```

---

## 📋 Planos e limites configurados

| Plano | Orçamentos | Laudos | Usuários | IA |
|---|---|---|---|---|
| Gratuito | 3 total | 1 total | 1 | — |
| Trial 7d | Ilimitado | Ilimitado | 1 | — |
| Básico R$49 | Ilimitado | 3/mês | 1 | — |
| Pro R$97 | Ilimitado | Ilimitado | 1 | — |
| Equipe R$197 | Ilimitado | Ilimitado | Até 5 | — |
| IA Pro R$297 | Ilimitado | Ilimitado | Ilimitado | ✓ |

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

### Crítico (antes de escalar tráfego)
- [ ] Configurar `external_reference` nos links do MP no formato `userId:plano_periodo`
- [ ] Testar webhook com pagamento real

### Curto prazo (próximas 2 semanas)
- [ ] E-mails automáticos via Resend (boas-vindas, trial expirando)
- [ ] Contador mensal de laudos persistente no Supabase
- [ ] Pixel Meta Ads + GA4 na `index.html`
- [ ] Botão WhatsApp flutuante na landing

### Médio prazo (1–2 meses)
- [ ] Dashboard financeiro (faturamento, ticket médio, lucro)
- [ ] Pipeline de status dos orçamentos
- [ ] CRM básico de clientes
- [ ] Multi-usuário completo (plano Equipe)
- [ ] Painel de afiliados
