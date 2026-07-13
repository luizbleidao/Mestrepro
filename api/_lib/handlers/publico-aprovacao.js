const { withSystem } = require('../db');

// GET  /api/publico/aprovacao?token=XXX          — dados do orçamento pra aprovação (sem auth)
// POST /api/publico/aprovacao {token,status,motivo} — cliente aprova/recusa (sem auth)
module.exports = async (req, res) => {
  const token = (req.query && req.query.token) || (req.body && req.body.token);
  if (!token) {
    res.status(400).json({ error: 'token obrigatório' });
    return;
  }

  if (req.method === 'GET') {
    const data = await withSystem((client) =>
      client.query('SELECT pub_orcamento_aprovacao($1) AS r', [token]).then((r) => r.rows[0].r)
    );
    if (!data) {
      res.status(404).json({ error: 'não encontrado' });
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    const { status, motivo } = req.body || {};
    const result = await withSystem((client) =>
      client.query('SELECT responder_aprovacao_orcamento($1, $2, $3) AS r', [token, status, motivo || null]).then((r) => r.rows[0].r)
    );
    res.status(result.ok ? 200 : 400).json(result);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
