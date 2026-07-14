const { authOrRespond } = require('../auth');
const { pool } = require('../db');
const { verificarIaPro, verificarQuota, sanitizarInput, logUso, chamarClaude, parsearRespostaIA, validarNumeroFaixa } = require('../ia-utils');

// POST /api/ia-preco — substitui a Edge Function Supabase ia-preco (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acesso = await verificarIaPro(auth.profileId);
  if (!acesso?.permitido) { res.status(403).json({ error: `Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}` }); return; }

  const quota = await verificarQuota(auth.profileId, 'ia_preco');
  if (!quota.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_preco', sucesso: false, erro: 'quota_excedida' });
    res.status(429).json({ error: `Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.` });
    return;
  }

  const raw = req.body || {};
  const tipoServico = sanitizarInput(raw.tipo_servico, 100);
  const cidade = sanitizarInput(raw.cidade, 100);
  const tipoCliente = sanitizarInput(raw.tipo_cliente, 100);
  if (!tipoServico) { res.status(400).json({ error: 'Campo obrigatório: tipo_servico' }); return; }

  const areaM2 = Number(raw.area_m2);
  if (!areaM2 || areaM2 <= 0 || areaM2 > 50000) {
    res.status(400).json({ error: 'area_m2 inválida. Informe entre 1 e 50.000 m²' });
    return;
  }

  const { rows: historico } = await pool.query(
    "SELECT total, criado_em FROM orcamentos WHERE user_id = $1 AND status = 'aprovado' ORDER BY criado_em DESC LIMIT 20",
    [auth.profileId]
  );
  const historicoTexto = historico.length > 0
    ? historico.map((o) => `R$ ${Number(o.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(', ')
    : 'sem histórico ainda';

  const userMessage = `Preciso precificar um serviço de pintura:
---DADOS---
- Tipo: ${tipoServico}
- Área: ${areaM2}m²
- Cidade: ${cidade || 'não informada'}
- Tipo de cliente: ${tipoCliente || 'residencial'}
- Meu histórico de orçamentos aprovados: ${historicoTexto}
---FIM_DADOS---

Retorne APENAS um JSON:
{
  "preco_minimo_m2": number,
  "preco_maximo_m2": number,
  "preco_recomendado_m2": number,
  "preco_total_minimo": number,
  "preco_total_recomendado": number,
  "preco_total_maximo": number,
  "base_calculo": "string",
  "fatores_ajuste": ["string"],
  "alerta": "string ou null"
}`;

  try {
    const resposta = await chamarClaude({
      systemPrompt: 'Especialista em precificação de pintura no Brasil. Conhece preços por m² para diferentes tipos de serviço, tinta e região. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.',
      userMessage,
      maxTokens: 700,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ profileId: auth.profileId, feature: 'ia_preco', sucesso: false, erro: 'parse_error' });
      res.status(500).json({ error: 'Erro ao processar resposta' });
      return;
    }

    const precoM2 = validarNumeroFaixa(resultado.preco_recomendado_m2, 1, 5000);
    if (precoM2 === null) {
      await logUso({ profileId: auth.profileId, feature: 'ia_preco', sucesso: false, erro: 'preco_m2_invalido' });
      res.status(500).json({ error: 'Resposta da IA fora da faixa esperada. Tente novamente.' });
      return;
    }

    await logUso({ profileId: auth.profileId, feature: 'ia_preco', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });
    res.status(200).json({ ...resultado, quota_restante: quota.restante - 1 });
  } catch (err) {
    console.error('[ia-preco] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
