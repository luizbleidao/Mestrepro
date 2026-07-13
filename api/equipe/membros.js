const { authOrRespond } = require('../_lib/auth');
const { withUser } = require('../_lib/db');

// GET    /api/equipe/membros                  — listar membros da própria equipe
// DELETE /api/equipe/membros?membro_id=UUID   — remover um membro (dono) ou sair (o próprio)
module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const membros = await withUser(auth.profileId, (client) =>
      client.query('SELECT listar_membros_equipe() AS r').then((r) => r.rows[0].r)
    );
    res.status(200).json({ membros });
    return;
  }

  if (req.method === 'DELETE') {
    const membroId = req.query && req.query.membro_id;
    const result = await withUser(auth.profileId, (client) =>
      membroId
        ? client.query('SELECT remover_membro_equipe($1) AS r', [membroId]).then((r) => r.rows[0].r)
        : client.query('SELECT sair_equipe() AS r').then((r) => r.rows[0].r)
    );
    res.status(result.ok ? 200 : 400).json(result);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
