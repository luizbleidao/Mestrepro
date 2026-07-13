const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, titulo, cliente, endereco, data_inicio, data_fim, hora_inicio, hora_fim,
                  cor, tipo, orc_id, status, obs, orcamento_id, contrato_id, notas, dia_todo, criado_em
           FROM agenda WHERE user_id = $1 ORDER BY data_inicio DESC LIMIT 300`,
          [auth.profileId]
        )
        .then((r) => r.rows)
    );
    res.status(200).json({ agenda: rows });
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.id || !body.titulo || !body.data_inicio) {
      res.status(400).json({ error: 'campos obrigatórios: id, titulo, data_inicio' });
      return;
    }
    const row = await withUser(auth.profileId, (client) =>
      client
        .query(
          `INSERT INTO agenda (id, user_id, titulo, cliente, endereco, data_inicio, data_fim,
                                hora_inicio, hora_fim, cor, tipo, orc_id, status, obs,
                                orcamento_id, contrato_id, notas, dia_todo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'agendado'),$14,$15,$16,$17,COALESCE($18,false))
           RETURNING *`,
          [
            body.id, auth.profileId, body.titulo, body.cliente || null, body.endereco || null,
            body.data_inicio, body.data_fim || null, body.hora_inicio || null, body.hora_fim || null,
            body.cor || null, body.tipo || null, body.orc_id || null, body.status, body.obs || null,
            body.orcamento_id || null, body.contrato_id || null, body.notas || null, body.dia_todo,
          ]
        )
        .then((r) => r.rows[0])
    );
    res.status(201).json({ evento: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
