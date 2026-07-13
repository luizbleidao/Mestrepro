const { withSystem } = require('../db');

// GET  /api/publico/portal?token=XXX        — portal do cliente, sem auth nenhuma
//      (o token no link é a única "senha"), igual pub_orcamento_portal do Supabase.
// POST /api/publico/portal {token,texto}    — cliente envia mensagem ao pintor
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const token = req.query && req.query.token;
    if (!token) {
      res.status(400).json({ error: 'query param obrigatório: token' });
      return;
    }
    const data = await withSystem((client) =>
      client.query('SELECT pub_orcamento_portal($1) AS r', [token]).then((r) => r.rows[0].r)
    );
    if (!data) {
      res.status(404).json({ error: 'não encontrado' });
      return;
    }
    res.status(200).json(data);
    return;
  }

  if (req.method === 'POST') {
    const { token, texto } = req.body || {};
    if (!token || !texto) {
      res.status(400).json({ error: 'campos obrigatórios: token, texto' });
      return;
    }
    const result = await withSystem((client) =>
      client.query('SELECT enviar_mensagem_portal_cliente($1, $2) AS r', [token, texto]).then((r) => r.rows[0].r)
    );
    res.status(result.success ? 200 : 400).json(result);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
