const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// GET   /api/laudos       — lista completa do usuário
// POST  /api/laudos       — upsert (cria ou atualiza se o id já existir)
// PATCH /api/laudos?id=ID — atualiza sig_token (link de assinatura)
module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, obra, cidade, data, status, criticidade, pat_count,
                  sig_token, sig_cliente, sig_cliente_at, sig_cliente_nome,
                  criado_em, atualizado_em
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
        const existente = await client.query('SELECT 1 FROM laudos WHERE id = $1 AND user_id = $2', [body.id, auth.profileId]);
        if (existente.rowCount === 0) {
          const permitido = await client.query('SELECT check_laudo_permitido() AS r');
          if (permitido.rows[0].r.permitido === false) {
            const err = new Error('Limite de laudos do seu plano atingido.');
            err.status = 403;
            throw err;
          }
        }
        const inserted = await client.query(
          `INSERT INTO laudos (id, user_id, numero, cliente, obra, cidade, data, criticidade, status, pat_count, dados, atualizado_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8,'MODERADO'), COALESCE($9,'rascunho'), COALESCE($10,0), $11, now())
           ON CONFLICT (id) DO UPDATE SET
             numero = EXCLUDED.numero, cliente = EXCLUDED.cliente, obra = EXCLUDED.obra,
             cidade = EXCLUDED.cidade, data = EXCLUDED.data, criticidade = EXCLUDED.criticidade,
             status = EXCLUDED.status, pat_count = EXCLUDED.pat_count, dados = EXCLUDED.dados, atualizado_em = now()
           WHERE laudos.user_id = $2
           RETURNING *`,
          [
            body.id, auth.profileId, body.numero || null, body.cliente, body.obra || null,
            body.cidade || null, body.data || null, body.criticidade, body.status, body.pat_count, body.dados || {},
          ]
        );
        return inserted.rows[0];
      });
      res.status(201).json({ laudo: row });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'PATCH') {
    const id = req.query && req.query.id;
    const body = req.body || {};
    if (!id || !body.sig_token) {
      res.status(400).json({ error: 'query param id e campo sig_token obrigatórios' });
      return;
    }
    const row = await withUser(auth.profileId, (client) =>
      client
        .query(
          'UPDATE laudos SET sig_token = $3, atualizado_em = now() WHERE id = $1 AND user_id = $2 RETURNING *',
          [id, auth.profileId, body.sig_token]
        )
        .then((r) => r.rows[0])
    );
    if (!row) { res.status(404).json({ error: 'laudo não encontrado' }); return; }
    res.status(200).json({ laudo: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
