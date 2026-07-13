const { authOrRespond } = require('../_lib/auth');
const { withUser } = require('../_lib/db');

module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, valor, descricao, forma_pgto, data, orc_id, contrato_id, criado_em
           FROM recibos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT 200`,
          [auth.profileId]
        )
        .then((r) => r.rows)
    );
    res.status(200).json({ recibos: rows });
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.id || !body.cliente) {
      res.status(400).json({ error: 'campos obrigatórios: id, cliente' });
      return;
    }
    const row = await withUser(auth.profileId, (client) =>
      client
        .query(
          `INSERT INTO recibos (id, user_id, orc_id, numero, cliente, valor, descricao, forma_pgto, data, dados, contrato_id, observacao, parcela)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *`,
          [
            body.id, auth.profileId, body.orc_id || null, body.numero || null, body.cliente,
            body.valor || null, body.descricao || null, body.forma_pgto || null, body.data || null,
            body.dados || {}, body.contrato_id || null, body.observacao || null, body.parcela || null,
          ]
        )
        .then((r) => r.rows[0])
    );
    res.status(201).json({ recibo: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
