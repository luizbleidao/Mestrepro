const { authOrRespond, requireAuth } = require('../auth');
const { withUser, pool } = require('../db');

// GET  /api/equipe/convite?codigo=XXX  — validar código (público, sem auth,
//      igual a validar_convite_equipe no fluxo de cadastro/login)
// POST /api/equipe/convite             — gera um novo código (dono da equipe)
// PUT  /api/equipe/convite {codigo}    — usuário logado entra na equipe (entrar_equipe)
module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const codigo = req.query && req.query.codigo;
    if (!codigo) {
      res.status(400).json({ error: 'query param obrigatório: codigo' });
      return;
    }
    const { rows } = await pool.query('SELECT validar_convite_equipe($1) AS r', [codigo]);
    res.status(200).json(rows[0].r);
    return;
  }

  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'POST') {
    const codigo = await withUser(auth.profileId, (client) =>
      client.query('SELECT criar_convite_equipe() AS codigo').then((r) => r.rows[0].codigo)
    );
    res.status(201).json({ codigo });
    return;
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    if (!body.codigo) {
      res.status(400).json({ error: 'campo obrigatório: codigo' });
      return;
    }
    const result = await withUser(auth.profileId, (client) =>
      client.query('SELECT entrar_equipe($1) AS r', [body.codigo]).then((r) => r.rows[0].r)
    );
    res.status(result.ok ? 200 : 400).json(result);
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
