const { authOrRespond } = require('../auth');
const { verificarIaPro, verificarQuota, sanitizarInput, logUso, chamarClaude, parsearRespostaIA } = require('../ia-utils');

const SUPERFICIES_VALIDAS = ['parede_interna', 'fachada', 'teto', 'piso', 'madeira', 'metal', 'outro'];

// POST /api/ia-laudo — substitui a Edge Function Supabase ia-laudo (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acesso = await verificarIaPro(auth.profileId);
  if (!acesso?.permitido) { res.status(403).json({ error: `Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}` }); return; }

  const quota = await verificarQuota(auth.profileId, 'ia_laudo');
  if (!quota.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_laudo', sucesso: false, erro: 'quota_excedida' });
    res.status(429).json({ error: `Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.` });
    return;
  }

  const raw = req.body || {};
  const tipoSuperficie = sanitizarInput(raw.tipo_superficie, 100);
  const condicaoAtual = sanitizarInput(raw.condicao_atual, 400);
  const servicoRecomendado = sanitizarInput(raw.servico_recomendado, 300);
  const produtoRecomendado = sanitizarInput(raw.produto_recomendado, 150);
  const observacoes = sanitizarInput(raw.observacoes, 300);
  const local = sanitizarInput(raw.local, 100);
  const problemas = Array.isArray(raw.problemas)
    ? raw.problemas.map((p) => sanitizarInput(p, 50)).filter(Boolean).slice(0, 10)
    : [];

  if (!tipoSuperficie || !condicaoAtual || !servicoRecomendado) {
    res.status(400).json({ error: 'Campos obrigatórios: tipo_superficie, condicao_atual, servico_recomendado' });
    return;
  }
  if (!SUPERFICIES_VALIDAS.includes(tipoSuperficie)) {
    res.status(400).json({ error: `Superfície inválida. Valores aceitos: ${SUPERFICIES_VALIDAS.join(', ')}` });
    return;
  }

  const userMessage = `
Preciso de texto técnico para laudo de pintura:

---DADOS_TECNICOS---
- Superfície: ${tipoSuperficie}
- Local: ${local || 'não especificado'}
- Condição atual: ${condicaoAtual}
- Problemas identificados: ${problemas.length > 0 ? problemas.join(', ') : 'nenhum especificado'}
- Serviço recomendado: ${servicoRecomendado}
- Produto recomendado: ${produtoRecomendado || 'a definir'}
${observacoes ? `- Observações técnicas: ${observacoes}` : ''}
---FIM_DADOS---

Retorne APENAS um JSON com:
{
  "descricao_tecnica": "parágrafo técnico descrevendo o estado da superfície (2-3 frases formais)",
  "diagnostico": "diagnóstico técnico dos problemas encontrados (2-3 frases)",
  "recomendacao_tecnica": "recomendação técnica completa e justificada (3-4 frases)",
  "especificacao_produto": "especificação técnica do produto recomendado (1-2 frases)",
  "observacoes_adicionais": "outras observações relevantes ou null"
}

Linguagem técnica mas compreensível. Padrão ABNT NBR para laudos de pintura.
  `.trim();

  try {
    const resposta = await chamarClaude({
      systemPrompt: 'Você é um especialista técnico em pintura e revestimentos com conhecimento de normas ABNT e patologias de superfícies. Redige laudos técnicos profissionais para pintores brasileiros. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.',
      userMessage,
      maxTokens: 1000,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ profileId: auth.profileId, feature: 'ia_laudo', sucesso: false, erro: 'parse_error' });
      res.status(500).json({ error: 'Erro ao processar resposta' });
      return;
    }

    const camposObrigatorios = ['descricao_tecnica', 'diagnostico', 'recomendacao_tecnica'];
    for (const campo of camposObrigatorios) {
      if (typeof resultado[campo] !== 'string' || resultado[campo].length < 10) {
        await logUso({ profileId: auth.profileId, feature: 'ia_laudo', sucesso: false, erro: `campo_invalido:${campo}` });
        res.status(500).json({ error: 'Resposta da IA incompleta. Tente novamente.' });
        return;
      }
    }

    await logUso({ profileId: auth.profileId, feature: 'ia_laudo', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });
    res.status(200).json({ ...resultado, quota_restante: quota.restante - 1 });
  } catch (err) {
    console.error('[ia-laudo] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
