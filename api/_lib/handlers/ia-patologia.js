const { authOrRespond } = require('../auth');
const { pool } = require('../db');

// POST /api/ia-patologia — substitui a Edge Function Supabase ia-patologia
// (mesmo contrato). Rate limit próprio (10/hora, mais caro por usar visão),
// separado da quota mensal de ia_uso_log usada pelas outras features de IA.
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const { rows: rlRows } = await pool.query(
    "SELECT check_rate_limit($1, 'ia-patologia', 10, interval '1 hour') AS ok",
    [auth.profileId]
  );
  if (!rlRows[0].ok) {
    res.status(429).json({ error: 'Limite de análises de foto atingido. Tente novamente em 1 hora.', code: 'RATE_LIMIT_EXCEEDED' });
    return;
  }

  const { rows: profRows } = await pool.query('SELECT plano FROM profiles WHERE id = $1', [auth.profileId]);
  const plano = profRows[0]?.plano;
  if (plano !== 'ia-pro') {
    res.status(403).json({ error: 'Disponível apenas no plano IA Pro', plano_atual: plano });
    return;
  }

  const { imageBase64, mimeType, ambiente } = req.body || {};
  const mime = mimeType || 'image/jpeg';
  const amb = ambiente || 'Ambiente';
  if (!imageBase64 || imageBase64.length < 100) { res.status(422).json({ error: 'Imagem inválida' }); return; }
  if (imageBase64.length > 5_500_000) { res.status(422).json({ error: 'Imagem muito grande. Use até 4MB.' }); return; }

  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  if (!anthropicKey) { res.status(500).json({ error: 'API key não configurada' }); return; }

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: 'Você é um perito técnico em patologias de superfície predial no Brasil. Responda SOMENTE com JSON válido.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: imageBase64 } },
            { type: 'text', text: `Analise o ambiente "${amb}" e retorne: {"tipoPatologia": "fissuras|umidade|bolor|descascamento|eflorescencia|corrosao|outro", "severidade": "leve|moderada|grave", "descricao": "", "tratamento": "", "custoAdicionalEstimado": 0}` },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) { res.status(502).json({ error: 'Erro na API de IA' }); return; }

    const raw = (await claudeRes.json())?.content?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { res.status(500).json({ error: 'IA retornou formato inválido.' }); return; }

    const tiposValidos = ['fissuras', 'umidade', 'bolor', 'descascamento', 'eflorescencia', 'corrosao', 'outro'];
    const resultado = {
      ok: true,
      tipoPatologia: tiposValidos.includes(String(parsed.tipoPatologia)) ? String(parsed.tipoPatologia) : 'outro',
      severidade: String(parsed.severidade || 'moderada'),
      descricao: String(parsed.descricao || '').slice(0, 400),
      tratamento: String(parsed.tratamento || '').slice(0, 600),
      custoAdicionalEstimado: Math.max(0, Number(parsed.custoAdicionalEstimado) || 0),
    };

    res.status(200).json(resultado);
  } catch (err) {
    console.error('[ia-patologia] Erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
};
