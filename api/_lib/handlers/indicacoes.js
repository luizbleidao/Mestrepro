const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// GET /api/indicacoes — substitui sb.from('indicacoes').select(...).eq('referrer_id', uid)
// pela RPC meu_programa_indicacao(), que já calcula total/ativos/comissão no banco.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const data = await withUser(auth.profileId, (client) =>
    client.query('SELECT meu_programa_indicacao() AS r').then((r) => r.rows[0].r)
  );
  res.status(200).json(data);
};
