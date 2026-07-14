const crypto = require('crypto');
const { withSystem } = require('../_lib/db');

// Configurar no painel do Mercado Pago:
//   URL: https://mestrepro.space/api/webhooks/mercadopago
//   Eventos: payment (todos os status)
// Substitui a Edge Function Supabase webhook-mp — mesma validação HMAC,
// mesma idempotência por mp_payment_id, agora chamando ativar_plano()/
// creditar_comissao() no Neon via withSystem (bypassa RLS de propósito).
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const PLANO_MAP = {
  mestrepro_basico_mensal: { plano: 'basico', dias: 30 },
  mestrepro_pro_mensal: { plano: 'pro', dias: 30 },
  mestrepro_equipe_mensal: { plano: 'equipe', dias: 30 },
  mestrepro_iapro_mensal: { plano: 'ia-pro', dias: 30 },
  mestrepro_basico_anual: { plano: 'basico', dias: 365 },
  mestrepro_pro_anual: { plano: 'pro', dias: 365 },
  mestrepro_equipe_anual: { plano: 'equipe', dias: 365 },
  mestrepro_iapro_anual: { plano: 'ia-pro', dias: 365 },
};

const VALOR_MINIMO = { basico: 4900, pro: 9700, equipe: 19700, 'ia-pro': 29700 };

async function validarAssinaturaMP(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook-mp] MP_WEBHOOK_SECRET não configurada — requisição rejeitada.');
    return false;
  }
  const xSignature = req.headers['x-signature'] || '';
  const xRequestId = req.headers['x-request-id'] || '';

  const parts = {};
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) {
    console.error('[webhook-mp] Header x-signature ausente ou malformado.');
    return false;
  }

  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const calculado = crypto.createHmac('sha256', secret).update(template).digest('hex');
  if (calculado !== v1) {
    console.error('[webhook-mp] Assinatura HMAC inválida. Possível requisição forjada.');
    return false;
  }

  const agora = Math.floor(Date.now() / 1000);
  if (Math.abs(agora - parseInt(ts, 10)) > 300) {
    console.error('[webhook-mp] Timestamp fora da janela de 5 min — possível replay attack.');
    return false;
  }
  return true;
}

async function handleCancelamento(payment) {
  const [userId] = String(payment.external_reference || '').split(':');
  if (!userId) return;
  await withSystem(async (client) => {
    await client.query("UPDATE profiles SET plano = 'gratuito' WHERE id = $1", [userId]);
    await client.query("UPDATE subscriptions SET status = 'cancelada' WHERE user_id = $1 AND status = 'ativa'", [userId]);
  });
  console.log(`[webhook-mp] Plano de ${userId} cancelado/rebaixado para gratuito`);
}

module.exports = async (req, res) => {
  if (req.method === 'GET') { res.status(200).send('MestrePro webhook OK'); return; }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }

  const rawBody = await readRawBody(req);
  let body;
  try { body = JSON.parse(rawBody); } catch { res.status(400).send('Body inválido'); return; }

  const dataId = (new URL(req.url, 'http://x').searchParams.get('data.id')) || '';
  const assinaturaValida = await validarAssinaturaMP(req, dataId);
  if (!assinaturaValida) { res.status(401).send('Assinatura inválida'); return; }

  const paymentId = body?.data?.id || body?.id;
  const eventType = body?.type || body?.action || '';
  if (!paymentId || !String(eventType).includes('payment')) { res.status(200).send('Evento ignorado'); return; }

  const mpToken = process.env.MP_ACCESS_TOKEN || '';
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${mpToken}` },
  });
  if (!mpRes.ok) { console.error('[webhook-mp] MP retornou', mpRes.status); res.status(502).send('MP API error'); return; }

  const payment = await mpRes.json();

  const existente = await withSystem((client) =>
    client.query('SELECT id, status FROM pagamentos WHERE mp_payment_id = $1', [String(paymentId)]).then((r) => r.rows[0])
  );
  if (existente) { res.status(200).send('Já processado'); return; }

  if (payment.status !== 'approved') {
    if (['cancelled', 'charged_back', 'refunded'].includes(payment.status)) {
      await handleCancelamento(payment);
    }
    res.status(200).send('Status não é approved');
    return;
  }

  const [userId, planoKey] = String(payment.external_reference || '').split(':');
  if (!userId || !planoKey) { res.status(422).send('external_reference inválido'); return; }

  const planoInfo = PLANO_MAP[planoKey];
  if (!planoInfo) { res.status(422).send('planoKey desconhecido'); return; }

  const valorCentavos = Math.round((payment.transaction_amount || 0) * 100);
  if (valorCentavos < (VALOR_MINIMO[planoInfo.plano] || 0)) {
    console.error('[webhook-mp] valor suspeito', valorCentavos);
    res.status(422).send('Valor suspeito');
    return;
  }

  const agora = new Date();
  const fim = new Date(agora.getTime() + planoInfo.dias * 24 * 60 * 60 * 1000);

  try {
    await withSystem(async (client) => {
      await client.query(
        'SELECT ativar_plano($1,$2,$3,$4,$5,$6,$7,$8)',
        [userId, planoInfo.plano, String(paymentId), payment.transaction_amount, payment.payment_type_id || 'outros', agora.toISOString(), fim.toISOString(), payment.id]
      );

      try {
        const r = await client.query('SELECT creditar_comissao($1,$2,$3) AS r', [userId, payment.transaction_amount, planoInfo.plano]);
        const comissao = r.rows[0].r;
        if (comissao?.ok) {
          console.log(`[webhook-mp] Comissão R$ ${comissao.comissao_brl} registrada para referrer ${comissao.referrer_id} (payout manual pelo admin)`);
        }
      } catch (e) {
        console.warn('[webhook-mp] creditar_comissao aviso (não crítico):', e.message);
      }
    });
  } catch (err) {
    console.error('[webhook-mp] ativar_plano erro:', err);
    res.status(500).send('Internal error');
    return;
  }

  console.log(`[webhook-mp] Plano ${planoInfo.plano} ativado para user ${userId} até ${fim.toISOString()}`);
  res.status(200).json({ ok: true, plano: planoInfo.plano, userId });
};
