# ROADMAP.md — MestrePro Technical Roadmap

> Documento para uso interno e pelo Claude Code.
> Cada item tem prioridade, contexto técnico e critério de aceitação claro.
> Atualizar status ao concluir cada item.

---

## 🗓️ Status Geral

| Sprint | Foco | Status |
|--------|------|--------|
| Sprint 0 | Estabilização crítica | ✅ Concluído |
| Sprint 1 | Segurança e server-side enforcement | 🔴 Em aberto |
| Sprint 2 | Comunicação e automação | 🔴 Em aberto |
| Sprint 3 | Performance e infra | 🔴 Em aberto |
| Sprint 4 | Crescimento e monetização | 🔴 Em aberto |

---

## 🔴 SPRINT 0 — Estabilização Crítica
*Funcionalidades quebradas em produção. Deve ser feito ANTES de qualquer outra coisa.*

---

### ~~[S0-001] Criar RPC `registrar_assinatura_cliente`~~ ✅ CONCLUÍDO (2026-05-20)
**Prioridade:** CRÍTICA — funcionalidade vendida está 100% quebrada
**Arquivo:** `/sql/rpc-assinatura-cliente.sql`

**Contexto:**
O frontend em `/js/assinatura.js` chama `supabase.rpc('registrar_assinatura_cliente', ...)`
mas esta RPC não existe no banco. O fluxo de assinatura digital falha silenciosamente.

**O que criar:**
```sql
-- Tabela de suporte (se não existir)
CREATE TABLE IF NOT EXISTS documentos_assinados (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  usuario_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  documento_tipo text NOT NULL, -- 'orcamento' | 'contrato' | 'recibo'
  documento_id uuid NOT NULL,
  cliente_nome text NOT NULL,
  cliente_email text,
  cliente_cpf text,
  ip_assinatura text,
  user_agent text,
  hash_documento text NOT NULL,
  dados_assinatura jsonb NOT NULL DEFAULT '{}',
  assinado_em timestamptz DEFAULT now(),
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE documentos_assinados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pintor_ve_suas_assinaturas"
  ON documentos_assinados FOR ALL
  USING (auth.uid() = usuario_id);

-- A RPC em si
CREATE OR REPLACE FUNCTION registrar_assinatura_cliente(
  p_documento_tipo text,
  p_documento_id uuid,
  p_cliente_nome text,
  p_cliente_email text DEFAULT NULL,
  p_cliente_cpf text DEFAULT NULL,
  p_hash_documento text DEFAULT NULL,
  p_dados_assinatura jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_usuario_id uuid;
  v_assinatura_id uuid;
BEGIN
  v_usuario_id := auth.uid();

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  INSERT INTO documentos_assinados (
    usuario_id, documento_tipo, documento_id,
    cliente_nome, cliente_email, cliente_cpf,
    hash_documento, dados_assinatura
  ) VALUES (
    v_usuario_id, p_documento_tipo, p_documento_id,
    p_cliente_nome, p_cliente_email, p_cliente_cpf,
    p_hash_documento, p_dados_assinatura
  ) RETURNING id INTO v_assinatura_id;

  RETURN jsonb_build_object(
    'sucesso', true,
    'assinatura_id', v_assinatura_id,
    'assinado_em', now()
  );
END;
$$;
```

**Critério de aceitação:**
- [x] Tabela `documentos_assinados` existe com RLS
- [x] RPC `registrar_assinatura_cliente` retorna `{ sucesso: true, assinatura_id, assinado_em }`
- [ ] Frontend consegue registrar assinatura sem erro
- [ ] Registro aparece na tabela com `usuario_id` correto

---

### ~~[S0-002] Aplicar patch do spinner de login infinito~~ ✅ CONCLUÍDO (2026-05-20)
**Prioridade:** CRÍTICA — UX quebrada visível para todos os usuários
**Arquivo:** `/login.html` (ou equivalente)

**Contexto:**
Bug documentado em arquivo de patch mas nunca aplicado ao HTML real.
Usuário que erra senha ou tem token expirado fica com spinner eterno.

**O que verificar no login.html:**
```javascript
// ❌ Padrão atual quebrado — spinner não desaparece em erro
async function fazerLogin() {
  mostrarSpinner();
  const { data, error } = await supabase.auth.signInWithPassword({...});
  if (data) redirecionarParaDashboard();
  // FALTA: esconder spinner em caso de erro!
}

// ✅ Padrão correto
async function fazerLogin() {
  mostrarSpinner();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({...});
    if (error) throw error;
    redirecionarParaDashboard();
  } catch (error) {
    esconderSpinner(); // ← isso estava faltando
    mostrarErro(error.message);
  } finally {
    esconderSpinner(); // garante que sempre esconde
  }
}
```

**Critério de aceitação:**
- [x] Spinner desaparece após erro de autenticação
- [x] Mensagem de erro exibida ao usuário
- [x] Spinner desaparece após timeout de rede (try/catch captura qualquer exceção)
- [x] Botão de login fica habilitado novamente após falha

---

### ~~[S0-003] Criar migration de schema base completo~~ ✅ CONCLUÍDO (2026-05-20)
**Prioridade:** CRÍTICA — impossível fazer deploy em ambiente novo
**Arquivo:** `/sql/schema-base.sql` (criar do zero)

**Contexto:**
`migrations-v2.sql` contém apenas comandos ALTER TABLE.
Não existe arquivo que cria o schema do zero.
Deploy em ambiente novo (staging, disaster recovery) vai falhar.

**O que fazer:**
1. Inspecionar todas as tabelas existentes no Supabase via MCP
2. Gerar `schema-base.sql` com CREATE TABLE para cada tabela
3. Incluir: indexes, constraints, triggers, RLS policies, RPCs
4. Testar que o arquivo pode ser executado do zero em banco vazio

**Estrutura do arquivo:**
```sql
-- schema-base.sql
-- MestrePro — Schema Completo
-- Versão: 1.0.0
-- Gerado em: [data]
-- EXECUTE ESTE ARQUIVO APENAS EM BANCO VAZIO

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- [Tabelas na ordem correta de dependência]
-- [Indexes]
-- [Triggers]
-- [RLS Policies]
-- [RPCs]
```

**Critério de aceitação:**
- [x] Arquivo executa sem erro em banco PostgreSQL vazio
- [x] Todas as tabelas, indexes e constraints recriadas (23 tabelas + subscriptions inferida)
- [x] RLS habilitado em todas as tabelas
- [x] Todas as RPCs existentes incluídas (36 funções)
- [ ] Testado com `psql -f schema-base.sql` num banco limpo

---

## 🟠 SPRINT 1 — Segurança e Server-Side Enforcement

---

### [S1-001] Mover enforcement de plano para server-side
**Prioridade:** ALTA — vulnerabilidade de segurança (bypass via DevTools)
**Arquivos:** `/js/planos.js`, novas RPCs SQL

**Contexto:**
Atualmente qualquer usuário pode abrir DevTools e alterar o valor de plano
no localStorage, ganhando acesso a features pagas sem pagar.

**Implementação:**
```sql
-- RPC genérica de verificação de feature
CREATE OR REPLACE FUNCTION verificar_acesso_feature(p_feature text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plano text;
  v_permitido boolean := false;
BEGIN
  SELECT plano INTO v_plano
  FROM assinaturas
  WHERE usuario_id = auth.uid()
    AND status = 'ativo'
  LIMIT 1;

  -- Mapa de features por plano
  v_permitido := CASE p_feature
    WHEN 'orcamentos_ilimitados' THEN v_plano IN ('pro', 'equipe', 'ia_pro')
    WHEN 'exportar_pdf'          THEN v_plano IN ('pro', 'equipe', 'ia_pro')
    WHEN 'contratos'             THEN v_plano IN ('pro', 'equipe', 'ia_pro')
    WHEN 'equipe'                THEN v_plano IN ('equipe', 'ia_pro')
    WHEN 'ia_pro'                THEN v_plano = 'ia_pro'
    ELSE false
  END;

  RETURN jsonb_build_object('permitido', v_permitido, 'plano', v_plano);
END;
$$;
```

**Critério de aceitação:**
- [ ] RPC `verificar_acesso_feature` criada e testada
- [ ] Frontend usa RPC antes de executar qualquer ação premium
- [ ] localStorage não é mais fonte de verdade para plano
- [ ] Bypass via DevTools retorna erro 403 do backend

---

### [S1-002] Adicionar validação de `event.origin` em postMessage
**Prioridade:** ALTA — vulnerabilidade XSS cross-origin
**Arquivo:** Qualquer JS que usa `window.addEventListener('message', ...)`

**Contexto:**
Listeners de postMessage sem validação de origem permitem que
páginas maliciosas injetem mensagens no app.

**Correção:**
```javascript
// ❌ VULNERÁVEL
window.addEventListener('message', (event) => {
  processarMensagem(event.data);
});

// ✅ SEGURO
const ORIGENS_PERMITIDAS = [
  'https://mestrepro.com.br',
  'https://app.mestrepro.com.br'
];

window.addEventListener('message', (event) => {
  if (!ORIGENS_PERMITIDAS.includes(event.origin)) {
    console.warn('[MestrePro] Mensagem rejeitada de origem:', event.origin);
    return;
  }
  processarMensagem(event.data);
});
```

**Critério de aceitação:**
- [ ] Todos os listeners de `message` validam `event.origin`
- [ ] Lista de origens permitidas centralizada em constante
- [ ] Log de segurança para origens rejeitadas

---

### [S1-003] Eliminar dual storage (localStorage + Supabase)
**Prioridade:** MÉDIA-ALTA — fragilidade arquitetural
**Arquivo:** `/js/auth.js`, `/js/planos.js`

**Contexto:**
Dados de sessão e plano são escritos tanto no localStorage quanto no Supabase.
Quando ficam dessincronizados, o app exibe comportamento incorreto.

**Estratégia:**
- Supabase é a única fonte de verdade
- localStorage pode ser usado apenas como cache temporário com TTL
- Ao inicializar o app, sempre validar sessão contra Supabase
- Implementar listener `supabase.auth.onAuthStateChange` como mecanismo principal

**Critério de aceitação:**
- [ ] Remoção de toda lógica de plano dependente de localStorage
- [ ] `onAuthStateChange` atualiza estado global do app
- [ ] Cache local tem TTL máximo de 5 minutos
- [ ] Teste: alterar plano no banco → frontend reflete sem reload

---

## 🟡 SPRINT 2 — Comunicação e Automação

---

### [S2-001] Implementar emails automáticos via Supabase Edge Functions
**Prioridade:** MÉDIA — impacta retenção e ativação
**Arquivos:** `/supabase/functions/email-boas-vindas/`, `/supabase/functions/email-trial-expirando/`

**Emails a implementar:**

| Trigger | Email | Timing |
|---------|-------|--------|
| Novo cadastro | Boas-vindas + tutorial | Imediato |
| Trial expirando | Aviso de expiração | 3 dias antes |
| Trial expirado | Oferta de upgrade | No dia |
| Downgrade | Confirmação + o que perdeu | Imediato |
| Upgrade | Confirmação + novidades | Imediato |
| Convite de equipe | Email com link de convite | Imediato |

**Critério de aceitação:**
- [ ] Edge Function para cada trigger
- [ ] Emails com template HTML responsivo
- [ ] Logs de envio registrados no banco
- [ ] Sem dependência de serviço externo de email pago (usar Resend free tier ou SMTP Supabase)

---

### [S2-002] Implementar lazy-load de iframes
**Prioridade:** MÉDIA — impacta performance de carregamento inicial
**Arquivo:** `/dashboard.html`, scripts de inicialização

**Contexto:**
Todos os iframes são carregados no startup, causando múltiplas requisições
paralelas e lentidão perceptível no carregamento inicial.

**Implementação:**
```javascript
// Lazy load de iframes por demanda
function carregarIframePorDemanda(containerId, url) {
  const container = document.getElementById(containerId);
  if (!container || container.querySelector('iframe')) return; // já carregado

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.loading = 'lazy';
  iframe.onload = () => container.classList.add('carregado');
  container.appendChild(iframe);
}

// Chamar apenas quando o usuário navegar para aquela aba
document.querySelector('[data-tab="relatorios"]').addEventListener('click', () => {
  carregarIframePorDemanda('container-relatorios', '/relatorios.html');
});
```

**Critério de aceitação:**
- [ ] Nenhum iframe carrega no startup
- [ ] Iframes carregam apenas quando a aba correspondente é acessada
- [ ] Loading state visível enquanto iframe carrega
- [ ] Lighthouse score de performance melhora ≥ 15 pontos

---

## 🔵 SPRINT 3 — Performance e Infraestrutura

---

### [S3-001] Configurar pixel IDs de analytics no Netlify
**Prioridade:** MÉDIA — dados de conversão não estão sendo coletados
**Arquivo:** Variáveis de ambiente no Netlify Dashboard

**O que configurar:**
- Google Analytics 4 (GA4) — Measurement ID
- Meta Pixel (Facebook) — Pixel ID
- Hotjar — Site ID (para gravação de sessão)

**Eventos críticos a rastrear:**
- `sign_up` — novo cadastro
- `purchase` — upgrade de plano
- `trial_start` — início de trial
- `feature_used` — uso de feature premium

**Critério de aceitação:**
- [ ] Pixels carregam em produção sem erro
- [ ] Evento de cadastro disparando
- [ ] Evento de compra disparando com valor
- [ ] Dados aparecem nos dashboards de analytics

---

### [S3-002] Criar migration de schema base (se S0-003 não foi feito)
Ver [S0-003] — este item é dependency de todo o Sprint 3.

---

### [S3-003] Implementar índices de performance no banco
**Prioridade:** MÉDIA — vai importar com escala

**Índices a criar:**
```sql
-- Queries mais frequentes identificadas
CREATE INDEX CONCURRENTLY idx_orcamentos_usuario_criado
  ON orcamentos(usuario_id, criado_em DESC);

CREATE INDEX CONCURRENTLY idx_assinaturas_usuario_status
  ON assinaturas(usuario_id, status);

CREATE INDEX CONCURRENTLY idx_equipe_membros_equipe
  ON equipe_membros(equipe_id, status);

CREATE INDEX CONCURRENTLY idx_convites_token
  ON equipe_convites(token) WHERE status = 'pendente';

CREATE INDEX CONCURRENTLY idx_clientes_usuario
  ON clientes(usuario_id, nome);
```

**Critério de aceitação:**
- [ ] Queries de listagem executam em < 50ms com 10k registros
- [ ] EXPLAIN ANALYZE mostra uso dos índices
- [ ] Sem degradação em operações de escrita

---

## 🟢 SPRINT 4 — Crescimento e Monetização

---

### [S4-001] Implementar dashboard financeiro consolidado
**Prioridade:** MÉDIA — retenção e perceived value
**Arquivo:** `/financeiro.html`, `/js/financeiro.js`

**Funcionalidades:**
- Receita total do mês
- Orçamentos aprovados vs recusados
- Ticket médio
- Top 5 clientes por receita
- Gráfico de evolução mensal

---

### [S4-002] Implementar notificação de remoção de membro de equipe
**Prioridade:** MÉDIA — edge case não tratado na feature de equipe

**Contexto:**
Quando um owner remove um membro da equipe, o membro não recebe
nenhuma notificação. O membro simplesmente perde acesso sem saber por quê.

**O que implementar:**
- Email automático para membro removido explicando o que aconteceu
- Opcionalmente: notificação in-app na próxima vez que logar

---

### [S4-003] Substituir conteúdo placeholder do blog
**Prioridade:** BAIXA-MÉDIA — impacta SEO e credibilidade
**Foco:** Conteúdo para pintores: dicas de orçamento, precificação, gestão

---

### [S4-004] Revisão de consolidação Netlify vs Vercel
**Prioridade:** BAIXA — decisão arquitetural estratégica

**Contexto:**
Projeto está no Netlify mas há MCPs de Vercel conectados.
Avaliar se faz sentido consolidar em uma única plataforma.

**Critérios de decisão:**
- Custo por tier
- Suporte a Edge Functions
- Integração com Supabase
- Developer experience

---

## 📊 Métricas de Saúde da Plataforma

Monitorar semanalmente:

| Métrica | Target | Crítico |
|---------|--------|---------|
| Tempo de carregamento inicial | < 2s | > 4s |
| Taxa de erro de login | < 1% | > 5% |
| Erro de RPC (any) | < 0.5% | > 2% |
| Assinaturas ativas | Crescimento MoM | Queda 2 meses seguidos |
| Churn rate | < 5%/mês | > 10%/mês |

---

## 🔧 Como Usar Este Roadmap com Claude Code

```bash
# Para implementar um item específico:
> Implemente o item S0-001 do ROADMAP.md — criar a RPC registrar_assinatura_cliente

# Para verificar status:
> Revise o ROADMAP.md e me diga quais itens do Sprint 0 ainda estão em aberto

# Para priorizar:
> Analise o ROADMAP.md e sugira o que atacar primeiro dado que o objetivo é estabilizar produção
```

---

*Documento vivo — atualizar status de cada item ao concluir.*
*Versão: 1.0.0 | Criado: 2025*
