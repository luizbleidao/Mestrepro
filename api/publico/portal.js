const { withSystem } = require('../_lib/db');

// GET /api/publico/portal?token=XXX — portal do cliente, sem auth nenhuma
// (o token no link é a única "senha"), igual pub_orcamento_portal do Supabase.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
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
};
