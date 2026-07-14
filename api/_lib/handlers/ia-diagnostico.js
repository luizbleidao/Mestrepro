const { authOrRespond } = require('../auth');
const { pool } = require('../db');
const { verificarIaPro, verificarQuota, logUso, chamarClaude, parsearRespostaIA } = require('../ia-utils');

// POST /api/ia-diagnostico — substitui a Edge Function Supabase ia-diagnostico (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acesso = await verificarIaPro(auth.profileId);
  if (!acesso?.permitido) {
    res.status(403).json({ error: `Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}` });
    return;
  }

  const quota = await verificarQuota(auth.profileId, 'ia_diagnostico');
  if (!quota.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_diagnostico', sucesso: false, erro: 'quota_excedida' });
    res.status(429).json({ error: `Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.` });
    return;
  }

  const body = req.body || {};
  const periodoSeguro = Math.min(Math.max(Number(body.periodo_dias) || 30, 7), 365);
  const dataInicio = new Date(Date.now() - periodoSeguro * 24 * 60 * 60 * 1000).toISOString();

  const { rows: orcamentos } = await pool.query(
    'SELECT status, total, criado_em, cliente FROM orcamentos WHERE user_id = $1 AND criado_em >= $2',
    [auth.profileId, dataInicio]
  );

  const total = orcamentos.length;
  const aprovados = orcamentos.filter((o) => o.status === 'aprovado');
  const recusados = orcamentos.filter((o) => o.status === 'recusado');
  const pendentes = orcamentos.filter((o) => o.status === 'enviado' || o.status === 'rascunho');
  const receitaTotal = aprovados.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const ticketMedio = aprovados.length > 0 ? receitaTotal / aprovados.length : 0;
  const taxaConversao = total > 0 ? (aprovados.length / total) * 100 : 0;

  const receitaPorCliente = {};
  aprovados.forEach((o) => {
    const c = o.cliente || 'Cliente';
    receitaPorCliente[c] = (receitaPorCliente[c] || 0) + (Number(o.total) || 0);
  });
  const topClientes = Object.entries(receitaPorCliente)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([, valor], i) => ({ label: `Cliente ${i + 1}`, valor }));

  const metricas = {
    periodo_dias: periodoSeguro, total_orcamentos: total, aprovados: aprovados.length,
    recusados: recusados.length, pendentes: pendentes.length, receita_total: receitaTotal,
    ticket_medio: ticketMedio, taxa_conversao: taxaConversao, top_clientes: topClientes,
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

  try {
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
      await logUso({ profileId: auth.profileId, feature: 'ia_diagnostico', sucesso: false, erro: 'parse_error' });
      res.status(500).json({ error: 'Erro ao processar análise' });
      return;
    }

    await logUso({ profileId: auth.profileId, feature: 'ia_diagnostico', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });
    res.status(200).json({ metricas, insights, quota_restante: quota.restante - 1 });
  } catch (err) {
    console.error('[ia-diagnostico] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
