const { authOrRespond } = require('../auth');
const { pool } = require('../db');

// POST /api/checkout { plano_id, periodo } — substitui a Edge Function
// Supabase criar-preferencia-mp. Cria uma preferência de pagamento no
// Mercado Pago e devolve o init_point para redirecionar o usuário.
const PLANO_KEY = {
  basico:   { mensal: 'mestrepro_basico_mensal',  anual: 'mestrepro_basico_anual' },
  pro:      { mensal: 'mestrepro_pro_mensal',     anual: 'mestrepro_pro_anual' },
  equipe:   { mensal: 'mestrepro_equipe_mensal',  anual: 'mestrepro_equipe_anual' },
  'ia-pro': { mensal: 'mestrepro_iapro_mensal',   anual: 'mestrepro_iapro_anual' },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const body = req.body || {};
  const planoId = String(body.plano_id || '').toLowerCase().trim();
  const periodo = String(body.periodo || 'mensal').toLowerCase().trim();

  if (!planoId) { res.status(422).json({ error: 'plano_id é obrigatório.' }); return; }
  if (!['mensal', 'anual'].includes(periodo)) { res.status(422).json({ error: 'Período inválido.' }); return; }

  const keys = PLANO_KEY[planoId];
  if (!keys) { res.status(422).json({ error: `Plano inválido: "${planoId}"` }); return; }

  const { rows } = await pool.query('SELECT * FROM get_planos_config() WHERE id = $1', [planoId]);
  const plano = rows[0];
  if (!plano || !plano.ativo) { res.status(422).json({ error: `Plano inativo ou não encontrado: "${planoId}"` }); return; }

  let nomePlano = plano.nome;
  const descricao = plano.descricao || plano.nome;
  const valorFinal = periodo === 'anual' ? Number(plano.preco_anual_final) : Number(plano.preco_mensal_final);
  if (plano.tem_promo && plano.promo_label) nomePlano = `${plano.nome} — ${plano.promo_label}`;

  const planoKey = periodo === 'anual' ? keys.anual : keys.mensal;
  const mpToken = process.env.MP_ACCESS_TOKEN || '';
  if (!mpToken) { res.status(500).json({ error: 'Configuração de pagamento indisponível.' }); return; }

  const appUrl = process.env.APP_URL || 'https://mestrepro.space';
  const extRef = `${auth.profileId}:${planoKey}`;

  const preference = {
    items: [{ id: planoKey, title: nomePlano, description: descricao, quantity: 1, unit_price: valorFinal, currency_id: 'BRL' }],
    external_reference: extRef,
    payer: { email: auth.email || '' },
    back_urls: {
      success: `${appUrl}/pintopro-app.html?pagamento=sucesso&plano=${planoId}`,
      failure: `${appUrl}/pintopro-planos.html?pagamento=falhou`,
      pending: `${appUrl}/pintopro-planos.html?pagamento=pendente`,
    },
    auto_return: 'approved',
    statement_descriptor: 'MESTREPRO',
    notification_url: `${appUrl}/api/webhooks/mercadopago`,
    expires: true,
    expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    });

    if (!mpRes.ok) {
      const mpErr = await mpRes.text();
      console.error('[checkout] MP error:', mpRes.status, mpErr);
      res.status(502).json({ error: 'Erro ao criar preferência de pagamento.' });
      return;
    }

    const mpData = await mpRes.json();
    res.status(200).json({
      preference_id: mpData.id, init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point, plano_key: planoKey, valor: valorFinal,
    });
  } catch (err) {
    console.error('[checkout] Erro:', err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
};
