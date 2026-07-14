const { adminOrRespond } = require('../adminAuth');
const { withUser } = require('../db');

// GET   /api/admin-usuarios              — lista completa (RPC get_usuarios_completos)
// PATCH /api/admin-usuarios?id=ID        — { obs_admin? , ativo? } ou { plano, brinde?, motivo? }
module.exports = async (req, res) => {
  const admin = await adminOrRespond(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const rows = await withUser(admin.profileId, (client) =>
      client.query('SELECT * FROM get_usuarios_completos()').then((r) => r.rows)
    );
    res.status(200).json({ usuarios: rows });
    return;
  }

  if (req.method === 'PATCH') {
    const id = req.query && req.query.id;
    const body = req.body || {};
    if (!id) { res.status(400).json({ error: 'query param obrigatório: id' }); return; }

    try {
      if (body.plano) {
        const result = await withUser(admin.profileId, (client) =>
          client
            .query('SELECT admin_alterar_plano($1, $2, $3, $4) AS r', [id, body.plano, !!body.brinde, body.motivo || null])
            .then((r) => r.rows[0].r)
        );
        res.status(200).json(result);
        return;
      }

      const campos = [];
      const values = [];
      if (typeof body.obs_admin === 'string') { campos.push(`obs_admin = $${values.length + 2}`); values.push(body.obs_admin); }
      if (typeof body.ativo === 'boolean') { campos.push(`ativo = $${values.length + 2}`); values.push(body.ativo); }
      if (!campos.length) { res.status(400).json({ error: 'nenhum campo editável informado' }); return; }

      const row = await withUser(admin.profileId, (client) =>
        client
          .query(`UPDATE profiles SET ${campos.join(', ')}, atualizado_em = now() WHERE id = $1 RETURNING id, obs_admin, ativo`, [id, ...values])
          .then((r) => r.rows[0])
      );
      res.status(200).json({ profile: row });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
