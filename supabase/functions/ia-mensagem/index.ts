/**
 * MestrePro — IA Pro: Gerador de Mensagem WhatsApp
 * v2 — 2026-05-21: CORS dinâmico, quota pré-chamada, sanitização de inputs
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  autenticarUsuario,
  verificarIaPro,
  verificarQuota,
  logUso,
  chamarClaude,
  sanitizarInput,
  parsearRespostaIA,
  getCorsHeaders,
  erroResponse,
  okResponse,
} from '../_shared/ia-utils.ts';

type TipoMensagem =
  | 'envio_orcamento'
  | 'followup_orcamento'
  | 'cobranca_amigavel'
  | 'cobranca_urgente'
  | 'confirmacao_servico'
  | 'encerramento_obra'
  | 'pedido_avaliacao'
  | 'reativacao_cliente';

const TIPOS_VALIDOS: TipoMensagem[] = [
  'envio_orcamento', 'followup_orcamento', 'cobranca_amigavel', 'cobranca_urgente',
  'confirmacao_servico', 'encerramento_obra', 'pedido_avaliacao', 'reativacao_cliente',
];

const CONTEXTOS: Record<TipoMensagem, string> = {
  envio_orcamento: 'Pintor está enviando um orçamento para o cliente pela primeira vez',
  followup_orcamento: 'Cliente recebeu o orçamento mas ainda não respondeu',
  cobranca_amigavel: 'Pagamento está em atraso, mas de forma leve e gentil',
  cobranca_urgente: 'Pagamento muito atrasado, tom mais firme mas ainda profissional',
  confirmacao_servico: 'Confirmação de que o serviço foi contratado, alinhando próximos passos',
  encerramento_obra: 'Obra concluída, agradecimento e solicitação de aprovação',
  pedido_avaliacao: 'Solicitação de avaliação no Google ou indicação para amigos',
  reativacao_cliente: 'Cliente que não contratou há muito tempo, oferta de retorno',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: getCorsHeaders(req) });
  if (req.method !== 'POST') return erroResponse('Method not allowed', 405, req);

  try {
    const userId = await autenticarUsuario(req);
    if (!userId) return erroResponse('Não autenticado', 401, req);

    const acesso = await verificarIaPro(userId);
    if (!acesso?.permitido) {
      await logUso({ userId, feature: 'ia_mensagem', sucesso: false, erro: 'plano_insuficiente' });
      return erroResponse(`Funcionalidade exclusiva do plano IA Pro. Plano atual: ${acesso?.plano}`, 403, req);
    }

    // Quota antes de consumir tokens — Fix #04
    const quota = await verificarQuota(userId, 'ia_mensagem');
    if (!quota.permitido) {
      await logUso({ userId, feature: 'ia_mensagem', sucesso: false, erro: 'quota_excedida' });
      return erroResponse(`Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.`, 429, req);
    }

    const raw = await req.json();

    // Validar tipo antes de usar como chave — Fix #05
    const tipo = raw.tipo as TipoMensagem;
    if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
      return erroResponse(`tipo inválido. Valores aceitos: ${TIPOS_VALIDOS.join(', ')}`, 400, req);
    }

    // Sanitizar todos os campos livres — Fix #05
    const nomeCliente = sanitizarInput(raw.nome_cliente, 100);
    if (!nomeCliente) return erroResponse('Campo obrigatório: nome_cliente', 400, req);

    const nomePintor = sanitizarInput(raw.nome_pintor ?? acesso.nome, 100);
    const servico    = sanitizarInput(raw.servico, 150);
    const observacoes = sanitizarInput(raw.observacoes, 300);
    const linkOrcamento = sanitizarInput(raw.link_orcamento, 200);
    const valor = raw.valor != null ? Math.abs(Number(raw.valor)) : undefined;
    const diasSemResposta = raw.dias_sem_resposta != null ? Math.min(Math.abs(Number(raw.dias_sem_resposta)), 365) : undefined;
    const diasEmAtraso    = raw.dias_em_atraso    != null ? Math.min(Math.abs(Number(raw.dias_em_atraso)), 365)    : undefined;

    const contexto = CONTEXTOS[tipo];

    const userMessage = `
Contexto: ${contexto}

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
      await logUso({ userId, feature: 'ia_mensagem', sucesso: false, erro: 'parse_error' });
      return erroResponse('Erro ao processar resposta da IA', 500, req);
    }

    await logUso({ userId, feature: 'ia_mensagem', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });

    return okResponse({ ...resultado, tipo, quota_restante: quota.restante - 1 }, req);

  } catch (err) {
    console.error('[ia-mensagem] Erro:', err);
    return erroResponse('Erro interno', 500, req);
  }
});
