const { authOrRespond } = require('../auth');
const { pool } = require('../db');

const TIPO_DESCRICAO = {
  instagram: 'post para feed do Instagram (legenda com emojis, quebras de linha, envolvente)',
  facebook: 'post para Facebook (mais texto, informativo e próximo do público)',
  stories: 'texto curto para Stories (máx 3 frases, impactante e direto)',
  whatsapp: 'mensagem de prospecção para WhatsApp (direta, profissional, sem ser invasiva)',
  depoimento: 'solicitação de depoimento para cliente (educada e fácil de responder)',
  promo: 'post de promoção/oferta especial (urgência, benefício claro, CTA direto)',
};

// POST /api/ia-posts — substitui a Edge Function Supabase ia-posts (mesmo contrato).
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const { rows } = await pool.query('SELECT plano FROM profiles WHERE id = $1', [auth.profileId]);
  if (rows[0]?.plano !== 'ia-pro') {
    res.status(403).json({ error: 'Este recurso requer o plano IA Pro.' });
    return;
  }

  const { nicho, tipo, tema, tom, cidade, nomeEmpresa } = req.body || {};
  if (!tema || tema.trim().length < 5) { res.status(400).json({ error: 'Tema muito curto.' }); return; }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) { res.status(500).json({ error: 'Serviço de IA não configurado.' }); return; }

  const tipoDesc = TIPO_DESCRICAO[tipo] || 'post para redes sociais';
  const systemPrompt = `Você é especialista em marketing digital para pintores e prestadores de serviços no Brasil.
Crie conteúdo autêntico em português brasileiro.
Responda APENAS com JSON válido, sem markdown.
Formato:
{"legenda":"string","hashtags":"string","cta":"string","sugestaoImagem":"string"}
Regras:
- Tom: ${tom || 'profissional'} | NÃO use asteriscos para negrito, use emojis
- Hashtags: 8 a 12, misture populares e de nicho
- CTA específico ao contexto
- sugestaoImagem: 1-2 frases descrevendo a foto ideal`;

  const userMsg = `Nicho: ${nicho || 'pintura'} | Tipo: ${tipoDesc} | Tema: ${tema} | Tom: ${tom || 'profissional'} | Cidade: ${cidade || 'Brasil'} | Empresa: ${nomeEmpresa || 'minha empresa'}`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!aiRes.ok) { res.status(500).json({ error: 'Erro ao consultar IA.' }); return; }

    const aiData = await aiRes.json();
    const rawText = aiData.content?.[0]?.text || '';

    let parsed;
    try { parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim()); }
    catch { res.status(500).json({ error: 'Resposta da IA inválida. Tente novamente.' }); return; }

    if (!parsed.legenda) { res.status(422).json({ error: 'IA não gerou conteúdo. Tente outro tema.' }); return; }

    res.status(200).json({
      legenda: parsed.legenda || '',
      hashtags: parsed.hashtags || '',
      cta: parsed.cta || '',
      sugestaoImagem: parsed.sugestaoImagem || '',
    });
  } catch (err) {
    console.error('[ia-posts] Erro:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
};
