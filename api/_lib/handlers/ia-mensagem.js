const { authOrRespond } = require('../auth');
const { verificarIaPro, verificarQuota, sanitizarInput, logUso, chamarClaude, parsearRespostaIA } = require('../ia-utils');

const TIPOS_VALIDOS = [
  'envio_orcamento', 'followup_orcamento', 'cobranca_amigavel', 'cobranca_urgente',
  'confirmacao_servico', 'encerramento_obra', 'pedido_avaliacao', 'reativacao_cliente',
];
const CONTEXTOS = {
  envio_orcamento: 'Pintor está enviando um orçamento para o cliente pela primeira vez',
  followup_orcamento: 'Cliente recebeu o orçamento mas ainda não respondeu',
  cobranca_amigavel: 'Pagamento está em atraso, mas de forma leve e gentil',
  cobranca_urgente: 'Pagamento muito atrasado, tom mais firme mas ainda profissional',
  confirmacao_servico: 'Confirmação de que o serviço foi contratado, alinhando próximos passos',
  encerramento_obra: 'Obra concluída, agradecimento e solicitação de aprovação',
  pedido_avaliacao: 'Solicitação de avaliação no Google ou indicação para amigos',
  reativacao_cliente: 'Cliente que não contratou há muito tempo, oferta de retorno',
};

// POST /api/ia-mensagem — substitui a Edge Function Supabase ia-mensagem (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acesso = await verificarIaPro(auth.profileId);
  if (!acesso?.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_mensagem', sucesso: false, erro: 'plano_insuficiente' });
    res.status(403).json({ error: `Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}` });
    return;
  }

  const quota = await verificarQuota(auth.profileId, 'ia_mensagem');
  if (!quota.permitido) {
    await logUso({ profileId: auth.profileId, feature: 'ia_mensagem', sucesso: false, erro: 'quota_excedida' });
    res.status(429).json({ error: `Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.` });
    return;
  }

  const raw = req.body || {};
  const tipo = raw.tipo;
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    res.status(400).json({ error: `tipo inválido. Valores aceitos: ${TIPOS_VALIDOS.join(', ')}` });
    return;
  }

  const nomeCliente = sanitizarInput(raw.nome_cliente, 100);
  if (!nomeCliente) { res.status(400).json({ error: 'Campo obrigatório: nome_cliente' }); return; }

  const nomePintor = sanitizarInput(raw.nome_pintor ?? acesso.nome, 100);
  const servico = sanitizarInput(raw.servico, 150);
  const observacoes = sanitizarInput(raw.observacoes, 300);
  const linkOrcamento = sanitizarInput(raw.link_orcamento, 200);
  const valor = raw.valor != null ? Math.abs(Number(raw.valor)) : undefined;
  const diasSemResposta = raw.dias_sem_resposta != null ? Math.min(Math.abs(Number(raw.dias_sem_resposta)), 365) : undefined;
  const diasEmAtraso = raw.dias_em_atraso != null ? Math.min(Math.abs(Number(raw.dias_em_atraso)), 365) : undefined;

  const userMessage = `
Contexto: ${CONTEXTOS[tipo]}

Dados para a mensagem:
---INICIO_DADOS---
- Nome do cliente: ${nomeCliente}
- Nome do pintor: ${nomePintor}
${servico ? `- Serviço: ${servico}` : ''}
${valor ? `- Valor: R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''}
${diasSemResposta ? `- Dias sem resposta: ${diasSemResposta}` : ''}
${diasEmAtraso ? `- Dias em atraso: ${diasEmAtraso}` : ''}
${linkOrcamento ? `- Link do orçamento: ${linkOrcamento}` : ''}
${observacoes ? `- Observações extras: ${observacoes}` : ''}
---FIM_DADOS---

Retorne APENAS um JSON com esta estrutura:
{
  "mensagem_principal": "texto completo da mensagem WhatsApp (use *negrito* para destacar, emojis moderados)",
  "mensagem_curta": "versão resumida em 1-2 linhas",
  "dica": "dica rápida sobre o melhor horário ou tom para enviar esta mensagem"
}

Regras:
- Tom profissional mas humano, linguagem simples
- Sem formalidade excessiva, sem a palavra "prezado/a"
- WhatsApp aceita *negrito*, _itálico_, ~tachado~
- Máximo 3 parágrafos na mensagem principal
  `.trim();

  try {
    const resposta = await chamarClaude({
      systemPrompt: `Você é especialista em comunicação para pequenos prestadores de serviço no Brasil.
Escreve mensagens de WhatsApp profissionais, diretas e eficazes para pintores autônomos.
Retorna APENAS JSON válido, sem markdown, sem texto extra.
Nunca desvie do formato solicitado.`,
      userMessage,
      maxTokens: 800,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ profileId: auth.profileId, feature: 'ia_mensagem', sucesso: false, erro: 'parse_error' });
      res.status(500).json({ error: 'Erro ao processar resposta da IA' });
      return;
    }

    await logUso({ profileId: auth.profileId, feature: 'ia_mensagem', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });
    res.status(200).json({ ...resultado, tipo, quota_restante: quota.restante - 1 });
  } catch (err) {
    console.error('[ia-mensagem] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
