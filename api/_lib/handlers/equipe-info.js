const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const info = await withUser(auth.profileId, (client) =>
    client.query('SELECT get_minha_equipe_info() AS r').then((r) => r.rows[0].r)
  );
  res.status(200).json(info);
};
