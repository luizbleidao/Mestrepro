const { authOrRespond } = require('./auth');
const { withUser } = require('./db');

// Factory para tabelas com PK = user_id (1 registro por usuário):
// empresa_config, templates.
function singletonJsonTable(table) {
  return async (req, res) => {
    const auth = await authOrRespond(req, res);
    if (!auth) return;

    if (req.method === 'GET') {
      const row = await withUser(auth.profileId, (client) =>
        client
          .query(`SELECT dados, atualizado_em FROM ${table} WHERE user_id = $1`, [auth.profileId])
          .then((r) => r.rows[0] || null)
      );
      res.status(200).json({ dados: row ? row.dados : null, atualizado_em: row ? row.atualizado_em : null });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = req.body || {};
      if (!body.dados) {
        res.status(400).json({ error: 'campo obrigatório: dados' });
        return;
      }
      const row = await withUser(auth.profileId, (client) =>
        client
          .query(
            `INSERT INTO ${table} (user_id, dados) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()
             RETURNING dados, atualizado_em`,
            [auth.profileId, body.dados]
          )
          .then((r) => r.rows[0])
      );
      res.status(200).json(row);
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  };
}

module.exports = { singletonJsonTable };
