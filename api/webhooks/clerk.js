const { Webhook } = require('svix');
const { withSystem } = require('../_lib/db');

// Configurar no Clerk Dashboard: Configure > Webhooks > Add Endpoint
//   URL: https://mestrepro.space/api/webhooks/clerk
//   Eventos: user.created
// O "Signing Secret" gerado lá vai na env var CLERK_WEBHOOK_SECRET.
//
// Vercel precisa do corpo bruto (raw body) pra verificar a assinatura Svix —
// por isso desligamos o bodyParser automático.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const rawBody = await readRawBody(req);

  let event;
  try {
    const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
    event = wh.verify(rawBody, {
      'svix-id': req.headers['svix-id'],
      'svix-timestamp': req.headers['svix-timestamp'],
      'svix-signature': req.headers['svix-signature'],
    });
  } catch {
    res.status(400).json({ error: 'assinatura de webhook inválida' });
    return;
  }

  if (event.type === 'user.created') {
    const u = event.data;
    const email = u.email_addresses?.find((e) => e.id === u.primary_email_address_id)?.email_address
      || u.email_addresses?.[0]?.email_address;
    const nome = [u.first_name, u.last_name].filter(Boolean).join(' ') || null;

    if (!email) {
      res.status(400).json({ error: 'usuário Clerk sem email' });
      return;
    }

    await withSystem((client) =>
      client.query('SELECT provision_new_user($1, $2, $3)', [u.id, email, nome])
    );
  }

  // user.updated / user.deleted: ainda não tratados aqui — se o email trocar no
  // Clerk, hoje profiles.email fica desatualizado até o próximo evento tratado.
  // TODO antes de produção: tratar user.updated (sync email/nome) e user.deleted
  // (ativo=false, não apagar dados — mesma regra de soft-delete do CLAUDE.md).

  res.status(200).json({ ok: true });
};
