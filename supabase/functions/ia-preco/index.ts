/**
 * MestrePro — IA Pro: Sugestão de Preço
 * v2 — 2026-05-21: CORS dinâmico, quota pré-chamada, sanitização, validação semântica
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  autenticarUsuario,
  verificarIaPro,
  verificarQuota,
  criarSupabaseAdmin,
  logUso,
  chamarClaude,
  sanitizarInput,
  parsearRespostaIA,
  validarNumeroFaixa,
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
    const quota = await verificarQuota(userId, 'ia_preco');
    if (!quota.permitido) {
      await logUso({ userId, feature: 'ia_preco', sucesso: false, erro: 'quota_excedida' });
      return erroResponse(`Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.`, 429, req);
    }

    const raw = await req.json();

    // Sanitizar inputs — Fix #05
    const tipo_servico  = sanitizarInput(raw.tipo_servico, 100);
    const cidade        = sanitizarInput(raw.cidade, 100);
    const tipo_cliente  = sanitizarInput(raw.tipo_cliente, 100);

    if (!tipo_servico) return erroResponse('Campo obrigatório: tipo_servico', 400, req);

    const area_m2 = Number(raw.area_m2);
    if (!area_m2 || area_m2 <= 0 || area_m2 > 50000) {
      return erroResponse('area_m2 inválida. Informe entre 1 e 50.000 m²', 400, req);
    }

    const sb = criarSupabaseAdmin();

    // Buscar histórico de orçamentos aprovados do próprio pintor
    const { data: historico } = await sb
      .from('orcamentos')
      .select('total, criado_em')
      .eq('user_id', userId)
      .eq('status', 'aprovado')
      .order('criado_em', { ascending: false })
      .limit(20);

    const historicoTexto = historico && historico.length > 0
      ? historico
          .map(o => `R$ ${Number(o.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
          .join(', ')
      : 'sem histórico ainda';

    const userMessage = `
Preciso precificar um serviço de pintura:
---DADOS---
- Tipo: ${tipo_servico}
- Área: ${area_m2}m²
- Cidade: ${cidade || 'não informada'}
- Tipo de cliente: ${tipo_cliente || 'residencial'}
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
  "base_calculo": "string (como chegou nos valores)",
  "fatores_ajuste": ["string"],
  "alerta": "string ou null"
}
    `.trim();

    const resposta = await chamarClaude({
      systemPrompt: `Especialista em precificação de pintura no Brasil. Conhece preços por m² para diferentes tipos de serviço, tinta e região. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.`,
      userMessage,
      maxTokens: 700,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ userId, feature: 'ia_preco', sucesso: false, erro: 'parse_error' });
      return erroResponse('Erro ao processar resposta', 500, req);
    }

    // Validação semântica: preço/m² deve estar entre R$1 e R$5000 — Fix #12
    const precoM2 = validarNumeroFaixa(resultado.preco_recomendado_m2, 1, 5000);
    if (precoM2 === null) {
      await logUso({ userId, feature: 'ia_preco', sucesso: false, erro: 'preco_m2_invalido' });
      return erroResponse('Resposta da IA fora da faixa esperada. Tente novamente.', 500, req);
    }

    await logUso({ userId, feature: 'ia_preco', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });

    return okResponse({ ...resultado, quota_restante: quota.restante - 1 }, req);

  } catch (err) {
    console.error('[ia-preco] Erro:', err);
    return erroResponse('Erro interno', 500, req);
  }
});
