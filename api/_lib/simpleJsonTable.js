const { authOrRespond } = require('./auth');
const { withUser } = require('./db');

// Factory para tabelas no padrão {id text PK, user_id, platform, dados jsonb,
// atualizado_em} — usado por despesas, obras, equipes. Mesmo padrão do
// supabase.from(table).select()/upsert() que o frontend chamava direto.
function simpleJsonTable(table) {
  return async (req, res) => {
    const auth = await authOrRespond(req, res);
    if (!auth) return;

    if (req.method === 'GET') {
      const rows = await withUser(auth.profileId, (client) =>
        client
          .query(`SELECT id, dados, atualizado_em FROM ${table} WHERE user_id = $1 ORDER BY atualizado_em DESC`, [auth.profileId])
          .then((r) => r.rows)
      );
      res.status(200).json({ [table]: rows });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.id || !body.dados) {
        res.status(400).json({ error: 'campos obrigatórios: id, dados' });
        return;
      }
      const row = await withUser(auth.profileId, (client) =>
        client
          .query(
            `INSERT INTO ${table} (id, user_id, dados) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()
             RETURNING id, dados, atualizado_em`,
            [body.id, auth.profileId, body.dados]
          )
          .then((r) => r.rows[0])
      );
      res.status(201).json({ [table.slice(0, -1)]: row });
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || (req.body && req.body.id);
      if (!id) {
        res.status(400).json({ error: 'id obrigatório' });
        return;
      }
      await withUser(auth.profileId, (client) =>
        client.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2`, [id, auth.profileId])
      );
      res.status(204).end();
      return;
    }

    res.status(405).json({ error: 'method not allowed' });
  };
}

module.exports = { simpleJsonTable };
