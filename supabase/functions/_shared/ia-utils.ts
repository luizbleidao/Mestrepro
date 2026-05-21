/**
 * MestrePro — Utilitários compartilhados para Edge Functions de IA
 * v2 — 2026-05-21: CORS dinâmico, sanitização, quota, prompt caching
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://mestrepro.space',
  'https://www.mestrepro.space',
  'http://localhost:3000',
  'http://localhost:54321',
  'http://127.0.0.1:3000',
];

/** Retorna headers CORS restritos à origem permitida. Fix #01 do relatório de auditoria. */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // Reflete a origem se for permitida; caso contrário usa o domínio principal
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

/** Fallback estático para contextos sem req (ex.: respostas de erro antes de ler o body). */
export const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://mestrepro.space',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

// ── CLIENTES SUPABASE ─────────────────────────────────────────────────────────

/** Cria cliente Supabase usando a service role (apenas server-side). */
export function criarSupabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}

// ── AUTENTICAÇÃO ──────────────────────────────────────────────────────────────

/** Extrai o user_id do JWT no header Authorization. */
export async function autenticarUsuario(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

// ── VERIFICAÇÃO DE PLANO ──────────────────────────────────────────────────────

/**
 * Verifica se o usuário tem plano ia-pro ativo.
 * Retorna { permitido, plano, nome } ou null se não encontrado.
 */
export async function verificarIaPro(
  userId: string
): Promise<{ permitido: boolean; plano: string; nome: string } | null> {
  const sb = criarSupabaseAdmin();
  const { data, error } = await sb
    .from('profiles')
    .select('plano, nome')
    .eq('id', userId)
    .single();

  if (error || !data) return null;

  return {
    permitido: data.plano === 'ia-pro',
    plano: data.plano,
    nome: data.nome ?? 'Pintor',
  };
}

// ── QUOTA DE IA ───────────────────────────────────────────────────────────────

/**
 * Verifica quota mensal de IA antes de chamar o modelo.
 * Fix #04 do relatório: quota não era verificada antes de consumir tokens.
 */
export async function verificarQuota(
  userId: string,
  feature: string
): Promise<{ permitido: boolean; restante: number; limite: number; usos: number }> {
  const sb = criarSupabaseAdmin();

  const { data: profile } = await sb
    .from('profiles')
    .select('plano')
    .eq('id', userId)
    .single();

  const plano = profile?.plano ?? 'gratuito';
  const limite = plano === 'ia-pro' ? 500 : plano === 'equipe' ? 100 : 0;

  if (limite === 0) return { permitido: false, restante: 0, limite: 0, usos: 0 };

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { count } = await sb
    .from('ia_uso_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('feature', feature)
    .eq('sucesso', true)
    .gte('criado_em', inicioMes.toISOString());

  const usos = count ?? 0;
  const restante = Math.max(0, limite - usos);

  return { permitido: usos < limite, restante, limite, usos };
}

// ── SANITIZAÇÃO DE INPUT ──────────────────────────────────────────────────────

/**
 * Sanitiza texto livre antes de inserir em prompt.
 * Fix #05: mitiga Prompt Injection via campos observacoes, nome_cliente, etc.
 */
export function sanitizarInput(value: unknown, maxLength = 500): string {
  if (value === null || value === undefined) return '';
  const s = String(value).slice(0, maxLength).trim();

  // Remove padrões comuns de prompt injection (PT-BR e EN)
  return s
    .replace(/ignore\s+(previous|above|all|prior)\s+(instructions?|prompts?|context)/gi, '[removido]')
    .replace(/you\s+(must|should|have\s+to)\s+ignore/gi, '[removido]')
    .replace(/ignore\s+as\s+instru[çc][oõ]es\s+anteriores/gi, '[removido]')
    .replace(/esqueça\s+(tudo|as\s+instru[çc][oõ]es)/gi, '[removido]')
    .replace(/atue\s+(como|agora)\s+como/gi, '[removido]')
    .replace(/retorne\s+(o\s+)?(system\s*prompt|prompt\s*do\s*sistema)/gi, '[removido]')
    .replace(/<\s*script[^>]*>/gi, '[removido]')
    .replace(/\beval\s*\(/gi, '[removido]');
}

// ── LOG DE USO ────────────────────────────────────────────────────────────────

/** Registra uso de feature IA no banco para analytics e controle de quota. */
export async function logUso(params: {
  userId: string;
  feature: string;
  tokens?: number;
  sucesso: boolean;
  erro?: string;
}): Promise<void> {
  try {
    const sb = criarSupabaseAdmin();
    await sb.from('ia_uso_log').insert({
      user_id: params.userId,
      feature: params.feature,
      tokens_usados: params.tokens ?? 0,
      sucesso: params.sucesso,
      erro: params.erro ?? null,
      criado_em: new Date().toISOString(),
    });
  } catch {
    // log silencioso — não quebrar a feature por falha no log
  }
}

// ── CHAMADA À API CLAUDE ──────────────────────────────────────────────────────

/**
 * Chama a API Claude da Anthropic com prompt caching no system prompt.
 * Fix #25: cache_control: ephemeral reduz custo de tokens em ~90% nas chamadas repetidas.
 */
export async function chamarClaude(params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: params.maxTokens ?? 1024,
      // System como array com cache_control: ephemeral
      system: [
        {
          type: 'text',
          text: params.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: params.userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return {
    content: data.content[0]?.text ?? '',
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

// ── VALIDAÇÃO DE RESPOSTA IA ──────────────────────────────────────────────────

/**
 * Extrai e parseia JSON da resposta do Claude com validação de estrutura.
 * Fix #12: validação semântica básica da resposta da IA.
 */
export function parsearRespostaIA(content: string): Record<string, unknown> | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Valida que um campo numérico está dentro de uma faixa razoável. */
export function validarNumeroFaixa(
  valor: unknown,
  min: number,
  max: number
): number | null {
  const n = Number(valor);
  if (!isFinite(n) || n < min || n > max) return null;
  return n;
}

// ── RESPOSTAS PADRONIZADAS ────────────────────────────────────────────────────

/** Resposta de erro padronizada com CORS dinâmico. */
export function erroResponse(msg: string, status = 400, req?: Request): Response {
  const headers = req ? getCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify({ erro: msg }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/** Resposta de sucesso padronizada com CORS dinâmico. */
export function okResponse(data: unknown, req?: Request): Response {
  const headers = req ? getCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
