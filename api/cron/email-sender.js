const { processarFilaEmails } = require('../_lib/email-utils');

// Chamado pelo Vercel Cron (configurado em vercel.json) — substitui o pg_cron
// job "mestrepro-email-sender" que existia no Supabase. Vercel assina
// requisições de cron com o header Authorization: Bearer $CRON_SECRET.
module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }

  try {
    const result = await processarFilaEmails();
    res.status(200).json(result);
  } catch (err) {
    console.error('[cron/email-sender] Erro:', err);
    res.status(500).json({ error: 'erro interno' });
  }
};
