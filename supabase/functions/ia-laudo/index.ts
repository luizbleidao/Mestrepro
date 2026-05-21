/**
 * MestrePro — IA Pro: Assistente de Laudo Técnico
 * v2 — 2026-05-21: CORS dinâmico, quota pré-chamada, sanitização, validação de saída
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

const SUPERFICIES_VALIDAS = ['parede_interna', 'fachada', 'teto', 'piso', 'madeira', 'metal', 'outro'];

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
    const quota = await verificarQuota(userId, 'ia_laudo');
    if (!quota.permitido) {
      await logUso({ userId, feature: 'ia_laudo', sucesso: false, erro: 'quota_excedida' });
      return erroResponse(`Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.`, 429, req);
    }

    const raw = await req.json();

    // Sanitizar todos os campos livres — Fix #05
    const tipo_superficie     = sanitizarInput(raw.tipo_superficie, 100);
    const condicao_atual      = sanitizarInput(raw.condicao_atual, 400);
    const servico_recomendado = sanitizarInput(raw.servico_recomendado, 300);
    const produto_recomendado = sanitizarInput(raw.produto_recomendado, 150);
    const observacoes         = sanitizarInput(raw.observacoes, 300);
    const local               = sanitizarInput(raw.local, 100);
    const problemas           = Array.isArray(raw.problemas)
      ? raw.problemas.map((p: unknown) => sanitizarInput(p, 50)).filter(Boolean).slice(0, 10)
      : [];

    if (!tipo_superficie || !condicao_atual || !servico_recomendado) {
      return erroResponse('Campos obrigatórios: tipo_superficie, condicao_atual, servico_recomendado', 400, req);
    }

    const userMessage = `
Preciso de texto técnico para laudo de pintura:

---DADOS_TECNICOS---
- Superfície: ${tipo_superficie}
- Local: ${local || 'não especificado'}
- Condição atual: ${condicao_atual}
- Problemas identificados: ${problemas.length > 0 ? problemas.join(', ') : 'nenhum especificado'}
- Serviço recomendado: ${servico_recomendado}
- Produto recomendado: ${produto_recomendado || 'a definir'}
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

    const resposta = await chamarClaude({
      systemPrompt: `Você é um especialista técnico em pintura e revestimentos com conhecimento de normas ABNT e patologias de superfícies. Redige laudos técnicos profissionais para pintores brasileiros. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.`,
      userMessage,
      maxTokens: 1000,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ userId, feature: 'ia_laudo', sucesso: false, erro: 'parse_error' });
      return erroResponse('Erro ao processar resposta', 500, req);
    }

    // Validação semântica: campos obrigatórios devem ser strings não-vazias — Fix #12
    const camposObrigatorios = ['descricao_tecnica', 'diagnostico', 'recomendacao_tecnica'];
    for (const campo of camposObrigatorios) {
      if (typeof resultado[campo] !== 'string' || (resultado[campo] as string).length < 10) {
        await logUso({ userId, feature: 'ia_laudo', sucesso: false, erro: `campo_invalido:${campo}` });
        return erroResponse('Resposta da IA incompleta. Tente novamente.', 500, req);
      }
    }

    await logUso({ userId, feature: 'ia_laudo', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });

    return okResponse({ ...resultado, quota_restante: quota.restante - 1 }, req);

  } catch (err) {
    console.error('[ia-laudo] Erro:', err);
    return erroResponse('Erro interno', 500, req);
  }
});
