const { authOrRespond } = require('../auth');
const { pool } = require('../db');
const { verificarIaPro, verificarQuota, sanitizarInput, logUso, chamarClaude, parsearRespostaIA } = require('../ia-utils');

// POST /api/ia-resumo-cliente — substitui a Edge Function Supabase ia-resumo-cliente (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acesso = await verificarIaPro(auth.profileId);
  if (!acesso?.permitido) { res.status(403).json({ error: `Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}` }); return; }

  const quota = await verificarQuota(auth.profileId, 'ia_resumo_cliente');
  if (!quota.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_resumo_cliente', sucesso: false, erro: 'quota_excedida' });
    res.status(429).json({ error: `Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.` });
    return;
  }

  const raw = req.body || {};
  const clienteNome = sanitizarInput(raw.cliente_nome, 100);
  if (!clienteNome || clienteNome.length < 2) {
    res.status(400).json({ error: 'Campo obrigatório: cliente_nome (mín. 2 caracteres)' });
    return;
  }

  // Escapa wildcards do ILIKE (%, _, \) — mesma proteção da função original.
  const clienteEscapado = clienteNome.replace(/[%_\\]/g, '\\$&');
  const { rows: orcamentos } = await pool.query(
    `SELECT status, total, criado_em FROM orcamentos
     WHERE user_id = $1 AND cliente ILIKE $2 ESCAPE '\\' ORDER BY criado_em DESC LIMIT 50`,
    [auth.profileId, `%${clienteEscapado}%`]
  );

  if (!orcamentos.length) {
    res.status(200).json({ resumo: null, mensagem: 'Nenhum orçamento encontrado para este cliente.' });
    return;
  }

  const aprovados = orcamentos.filter((o) => o.status === 'aprovado');
  const receitaTotal = aprovados.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const diasSemContato = Math.floor((Date.now() - new Date(orcamentos[0].criado_em).getTime()) / (1000 * 60 * 60 * 24));

  const userMessage = `
Analise o histórico de um cliente de um pintor autônomo:

---HISTORICO---
- Total de orçamentos: ${orcamentos.length}
- Orçamentos aprovados: ${aprovados.length}
- Taxa de conversão: ${orcamentos.length > 0 ? ((aprovados.length / orcamentos.length) * 100).toFixed(1) : 0}%
- Receita total gerada: R$ ${receitaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
- Último contato: ${diasSemContato} dias atrás
---FIM_HISTORICO---

Retorne APENAS um JSON:
{
  "perfil_cliente": "fiel" | "esporadico" | "perdido" | "novo",
  "valor_cliente": "alto" | "medio" | "baixo",
  "resumo": "2-3 frases descrevendo o relacionamento com este cliente",
  "proxima_acao": "ação concreta que o pintor deve tomar agora",
  "mensagem_sugerida": "mensagem curta de WhatsApp para reativar ou manter o cliente",
  "alerta": "string ou null (ex: cliente sem retorno há muito tempo)"
}
  `.trim();

  try {
    const resposta = await chamarClaude({
      systemPrompt: 'Especialista em CRM e relacionamento com clientes para pequenos prestadores de serviço. Analisa histórico e sugere ações concretas. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.',
      userMessage,
      maxTokens: 700,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ profileId: auth.profileId, feature: 'ia_resumo_cliente', sucesso: false, erro: 'parse_error' });
      res.status(500).json({ error: 'Erro ao processar resposta' });
      return;
    }

    await logUso({ profileId: auth.profileId, feature: 'ia_resumo_cliente', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });
    res.status(200).json({
      historico: { total_orcamentos: orcamentos.length, aprovados: aprovados.length, receita_total: receitaTotal, dias_sem_contato: diasSemContato },
      ...resultado,
      quota_restante: quota.restante - 1,
    });
  } catch (err) {
    console.error('[ia-resumo-cliente] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
