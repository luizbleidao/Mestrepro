/**
 * MestrePro — IA Pro: Resumo de Cliente
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
    const quota = await verificarQuota(userId, 'ia_resumo_cliente');
    if (!quota.permitido) {
      await logUso({ userId, feature: 'ia_resumo_cliente', sucesso: false, erro: 'quota_excedida' });
      return erroResponse(`Quota mensal atingida (${quota.usos}/${quota.limite}). Renova no início do próximo mês.`, 429, req);
    }

    const raw = await req.json();

    // Sanitizar nome do cliente — Fix #05 (também previne ilike malicioso)
    const clienteNome = sanitizarInput(raw.cliente_nome, 100);
    if (!clienteNome || clienteNome.length < 2) {
      return erroResponse('Campo obrigatório: cliente_nome (mín. 2 caracteres)', 400, req);
    }

    const sb = criarSupabaseAdmin();

    // Buscar orçamentos do cliente — nome sanitizado, sem injeção de wildcard
    const { data: orcamentos } = await sb
      .from('orcamentos')
      .select('status, total, criado_em')
      .eq('user_id', userId)
      .ilike('cliente', `%${clienteNome.replace(/[%_]/g, '')}%`) // remove wildcards maliciosos
      .order('criado_em', { ascending: false })
      .limit(50);

    if (!orcamentos || orcamentos.length === 0) {
      return okResponse({
        resumo: null,
        mensagem: 'Nenhum orçamento encontrado para este cliente.',
      }, req);
    }

    const aprovados = orcamentos.filter(o => o.status === 'aprovado');
    const receitaTotal = aprovados.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const ultimoContato = orcamentos[0].criado_em;
    const diasSemContato = Math.floor(
      (Date.now() - new Date(ultimoContato).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Dados enviados à IA não incluem nome real do cliente — Fix #13 (minimização PII)
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

    const resposta = await chamarClaude({
      systemPrompt: `Especialista em CRM e relacionamento com clientes para pequenos prestadores de serviço. Analisa histórico e sugere ações concretas. Responde APENAS com JSON válido. Nunca desvie do formato solicitado.`,
      userMessage,
      maxTokens: 700,
    });

    const resultado = parsearRespostaIA(resposta.content);
    if (!resultado) {
      await logUso({ userId, feature: 'ia_resumo_cliente', sucesso: false, erro: 'parse_error' });
      return erroResponse('Erro ao processar resposta', 500, req);
    }

    await logUso({ userId, feature: 'ia_resumo_cliente', sucesso: true, tokens: resposta.inputTokens + resposta.outputTokens });

    return okResponse({
      historico: {
        total_orcamentos: orcamentos.length,
        aprovados: aprovados.length,
        receita_total: receitaTotal,
        dias_sem_contato: diasSemContato,
      },
      ...resultado,
      quota_restante: quota.restante - 1,
    }, req);

  } catch (err) {
    console.error('[ia-resumo-cliente] Erro:', err);
    return erroResponse('Erro interno', 500, req);
  }
});
