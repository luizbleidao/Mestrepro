const { authOrRespond } = require('../_lib/auth');
const { withUser } = require('../_lib/db');

module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, obra, cidade, data, status, criticidade, pat_count, criado_em, atualizado_em
           FROM laudos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT 200`,
          [auth.profileId]
        )
        .then((r) => r.rows)
    );
    res.status(200).json({ laudos: rows });
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.id || !body.cliente) {
      res.status(400).json({ error: 'campos obrigatórios: id, cliente' });
      return;
    }
    try {
      const row = await withUser(auth.profileId, async (client) => {
        const permitido = await client.query('SELECT check_laudo_permitido() AS r');
        if (permitido.rows[0].r.permitido === false) {
          const err = new Error('Limite de laudos do seu plano atingido.');
          err.status = 403;
          throw err;
        }
        const inserted = await client.query(
          `INSERT INTO laudos (id, user_id, numero, cliente, obra, cidade, data, dados)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [body.id, auth.profileId, body.numero || null, body.cliente, body.obra || null, body.cidade || null, body.data || null, body.dados || {}]
        );
        return inserted.rows[0];
      });
      res.status(201).json({ laudo: row });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
