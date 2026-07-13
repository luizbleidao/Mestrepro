const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// POST /api/portal/progresso — o PINTOR (autenticado) atualiza progresso/foto/mensagem
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const { orc_id: orcId, progresso, etapa, nova_foto: novaFoto, mensagem } = req.body || {};
  if (!orcId || progresso === undefined) {
    res.status(400).json({ error: 'campos obrigatórios: orc_id, progresso' });
    return;
  }
  const result = await withUser(auth.profileId, (client) =>
    client
      .query('SELECT atualizar_progresso_portal($1, $2, $3, $4, $5) AS r', [orcId, progresso, etapa ?? null, novaFoto || null, mensagem || null])
      .then((r) => r.rows[0].r)
  );
  res.status(result.ok ? 200 : 400).json(result);
};
