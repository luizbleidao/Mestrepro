const { authOrRespond } = require('../_lib/auth');
const { withUser } = require('../_lib/db');

module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, endereco, valor, status, assinado_prof, assinado_cli,
                  data_inicio, data_fim, criado_em, atualizado_em
           FROM contratos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT 200`,
          [auth.profileId]
        )
        .then((r) => r.rows)
    );
    res.status(200).json({ contratos: rows });
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
          `INSERT INTO contratos (id, user_id, orcamento_id, numero, cliente, endereco, valor, dados, data_inicio, data_fim)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7,0), $8, $9, $10)
           RETURNING *`,
          [
            body.id, auth.profileId, body.orcamento_id || null, body.numero || null,
            body.cliente, body.endereco || null, body.valor, body.dados || {},
            body.data_inicio || null, body.data_fim || null,
          ]
        )
        .then((r) => r.rows[0])
    );
    res.status(201).json({ contrato: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
