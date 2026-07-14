const { pool } = require('./db');

// Porte Node do supabase/functions/_shared/ia-utils.ts. Autenticação em si já
// é feita por requireAuth (Clerk) — aqui só ficam as partes específicas de IA
// (plano, quota, sanitização, chamada ao Claude, parsing/validação da resposta).

async function verificarIaPro(profileId) {
  const { rows } = await pool.query('SELECT plano, nome FROM profiles WHERE id = $1', [profileId]);
  const data = rows[0];
  if (!data) return null;
  return { permitido: data.plano === 'ia-pro' || data.plano === 'ia_pro', plano: data.plano, nome: data.nome || 'Pintor' };
}

async function verificarQuota(profileId, feature) {
  const { rows } = await pool.query('SELECT plano FROM profiles WHERE id = $1', [profileId]);
  const plano = rows[0]?.plano || 'gratuito';
  const limite = (plano === 'ia-pro' || plano === 'ia_pro') ? 500 : plano === 'equipe' ? 100 : 0;
  if (limite === 0) return { permitido: false, restante: 0, limite: 0, usos: 0 };

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { rows: cRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ia_uso_log WHERE user_id = $1 AND feature = $2 AND sucesso = true AND criado_em >= $3`,
    [profileId, feature, inicioMes.toISOString()]
  );
  const usos = cRows[0].n;
  const restante = Math.max(0, limite - usos);
  return { permitido: usos < limite, restante, limite, usos };
}

function sanitizarInput(value, maxLength = 500) {
  if (value === null || value === undefined) return '';
  const s = String(value).slice(0, maxLength).trim();
  return s
    .replace(/ignore\s+(previous|above|all|prior)\s+(instructions?|prompts?|context)/gi, '[removido]')
    .replace(/you\s+(must|should|have\s+to)\s+ignore/gi, '[removido]')
    .replace(/ignore\s+as\s+instru[çc][oõ]es\s+anteriores/gi, '[removido]')
    .replace(/esque[çc]a\s+(tudo|as\s+instru[çc][oõ]es)/gi, '[removido]')
    .replace(/atue\s+(como|agora)\s+como/gi, '[removido]')
    .replace(/retorne\s+(o\s+)?(system\s*prompt|prompt\s*do\s*sistema)/gi, '[removido]')
    .replace(/<\s*script[^>]*>/gi, '[removido]')
    .replace(/\beval\s*\(/gi, '[removido]');
}

async function logUso({ profileId, feature, tokens, sucesso, erro }) {
  try {
    await pool.query(
      `INSERT INTO ia_uso_log (user_id, feature, tokens_usados, sucesso, erro, criado_em) VALUES ($1,$2,$3,$4,$5,now())`,
      [profileId, feature, tokens || 0, sucesso, erro || null]
    );
  } catch (e) {
    // log silencioso — não quebrar a feature por falha no log
  }
}

async function chamarClaude({ systemPrompt, userMessage, maxTokens }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 1024,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return {
    content: data.content[0]?.text || '',
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

function parsearRespostaIA(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validarNumeroFaixa(valor, min, max) {
  const n = Number(valor);
  if (!isFinite(n) || n < min || n > max) return null;
  return n;
}

module.exports = { verificarIaPro, verificarQuota, sanitizarInput, logUso, chamarClaude, parsearRespostaIA, validarNumeroFaixa };
