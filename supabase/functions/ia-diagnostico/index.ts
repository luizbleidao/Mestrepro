/**
 * MestrePro — IA Pro: Diagnóstico do Negócio
 * v2 — 2026-05-21: CORS dinâmico, quota pré-chamada, validação semântica
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  autenticarUsuario,
  verificarIaPro,
  verificarQuota,
  criarSupabaseAdmin,
  logUso,
  chamarClaude,
  parsearRespostaIA,
  getCorsHeaders,
  erroResponse,
  okResponse,
} from '../_shared/ia-utils.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return erroResponse('Method not allowed', 405, req);

  try {
    const userId = await autenticarUsuario(req);
    if (!userId) return erroResponse('Não autenticado', 401, req);

    const acesso = await verificarIaPro(userId);
    if (!acesso?.permitido) {
      return erroResponse(`Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}`, 403, req);
    }

    // Quota antes de consumir tokens — Fix #04
    const quota = await verificarQuota(userId, 'ia_diagnostico');
    if (!quota.permitido) {
      await logUso({ userId, feature: 'ia_diagnostico', sucesso: false, erro: 'quota_excedida' });
      return erroResponse(`Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.`, 429, req);
    }

    const { periodo_dias = 30 } = await req.json().catch(() => ({}));
    const periodoSeguro = Math.min(Math.max(Number(periodo_dias) || 30, 7), 365);
    const dataInicio = new Date(Date.now() - periodoSeguro * 24 * 60 * 60 * 1000).toISOString();

    const sb = criarSupabaseAdmin();

    const [{ data: orcamentos }, { data: perfil }] = await Promise.all([
      sb
        .from('orcamentos')
        .select('status, total, criado_em, cliente')
        .eq('user_id', userId)
        .gte('criado_em', dataInicio),
      sb
        .from('profiles')
        .select('nome, plano, criado_em')
        .eq('id', userId)
        .single(),
    ]);

    if (!orcamentos) return erroResponse('Erro ao buscar dados', 500, req);

    // Calcular métricas (dados internos — sem input direto do usuário no prompt)
    const total = orcamentos.length;
    const aprovados = orcamentos.filter(o => o.status === 'aprovado');
    const recusados = orcamentos.filter(o => o.status === 'recusado');
    const pendentes = orcamentos.filter(o => o.status === 'enviado' || o.status === 'rascunho');
    const receitaTotal = aprovados.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const ticketMedio = aprovados.length > 0 ? receitaTotal / aprovados.length : 0;
    const taxaConversao = total > 0 ? (aprovados.length / total) * 100 : 0;

    // Top clientes por receita (anonimizar para o modelo — não enviar nomes reais)
    const receitaPorCliente: Record<string, number> = {};
    aprovados.forEach(o => {
      const c = o.cliente ?? 'Cliente';
      receitaPorCliente[c] = (receitaPorCliente[c] ?? 0) + (Number(o.total) || 0);
    });
    const topClientes = Object.entries(receitaPorCliente)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([_, valor], i) => ({ label: `Cliente ${i + 1}`, valor })); // anonimizado

    const metricas = {
      periodo_dias: periodoSeguro,
      total_orcamentos: total,
      aprovados: aprovados.length,
      recusados: recusados.length,
      pendentes: pendentes.length,
      receita_total: receitaTotal,
      ticket_medio: ticketMedio,
      taxa_conversao: taxaConversao,
      top_clientes: topClientes,
    };

    const userMessage = `
Analise os dados de negócio dos últimos ${periodoSeguro} dias de um pintor autônomo brasileiro:

---METRICAS---
- Orçamentos criados: ${total}
- Aprovados: ${aprovados.length} (${taxaConversao.toFixed(1)}% de conversão)
- Recusados: ${recusados.length}
- Pendentes/aguardando: ${pendentes.length}
- Receita total: R$ ${receitaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Ticket médio: R$ ${ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
---FIM_METRICAS---

Retorne APENAS um JSON com:
{
  "saude_geral": "ótima" | "boa" | "regular" | "ruim",
  "pontos_positivos": ["string", ...],
  "pontos_atencao": ["string", ...],
  "acoes_prioritarias": [
    { "acao": "string", "impacto": "alto" | "medio" | "baixo", "prazo": "string" }
  ],
  "frase_motivacional": "string curta e direta para o pintor"
}
    `.trim();

    const resposta = await chamarClaude({
      systemPrompt: `Você é um consultor de negócios especializado em pequenos prestadores de serviço no Brasil.
Analisa dados de pintores autônomos e fornece insights práticos e acionáveis.
Responde APENAS com JSON válido, sem texto adicional, sem markdown.
Nunca desvie do formato solicitado.`,
      userMessage,
      maxTokens: 1000,
    });

    const insights = parsearRespostaIA(resposta.content);
    if (!insights) {
      await logUso({ userId, feature: 'ia_diagnostico', sucesso: false, erro: 'parse_error' });
      return erroResponse('Erro ao processar análise', 500, req);
    }

    await logUso({ userId, feature: 'ia_diagnostico', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });

    return okResponse({ metricas, insights, quota_restante: quota.restante - 1 }, req);

  } catch (err) {
    console.error('[ia-diagnostico] Erro:', err);
    return erroResponse('Erro interno', 500, req);
  }
});
