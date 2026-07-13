const { withSystem } = require('../db');

// GET  /api/publico/assinar?token=XXX — busca o documento (orçamento/laudo/
//      contrato) pelo sig_token, sem auth. Substitui pub_documento_assinatura.
// POST /api/publico/assinar — assinatura digital do cliente via sig_token,
// SEM Clerk (o cliente do pintor nunca faz login). Substitui a RPC
// registrar_assinatura_cliente(p_token, p_tipo, p_nome, p_ip, p_sig_b64)
// que já é SECURITY DEFINER e valida o token/expiração internamente —
// aqui só repassamos os parâmetros, sem checar auth nenhuma de propósito.
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const token = req.query && req.query.token;
    if (!token) { res.status(400).json({ error: 'query param obrigatório: token' }); return; }
    const data = await withSystem((client) =>
      client.query('SELECT pub_documento_assinatura($1) AS r', [token]).then((r) => r.rows[0].r)
    );
    if (!data) { res.status(404).json({ error: 'documento não encontrado' }); return; }
    res.status(200).json(data);
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const { token, tipo, nome, sig_b64: sigB64 } = req.body || {};
  if (!token || !tipo || !nome || !sigB64) {
    res.status(400).json({ error: 'campos obrigatórios: token, tipo, nome, sig_b64' });
    return;
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

  const result = await withSystem((client) =>
    client
      .query('SELECT registrar_assinatura_cliente($1, $2, $3, $4, $5) AS r', [token, tipo, nome, ip, sigB64])
      .then((r) => r.rows[0].r)
  );
  res.status(result.ok ? 200 : 400).json(result);
};
