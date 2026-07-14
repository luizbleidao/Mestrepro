const { adminOrRespond } = require('../adminAuth');
const { withUser } = require('../db');

// GET   /api/admin-pagamentos           — lista completa
// POST  /api/admin-pagamentos           — registra pagamento manual + ativa plano
// PATCH /api/admin-pagamentos?id=ID     — { status: 'aprovado'|'cancelado' }
module.exports = async (req, res) => {
  const admin = await adminOrRespond(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const rows = await withUser(admin.profileId, (client) =>
      client.query('SELECT * FROM pagamentos ORDER BY criado_em DESC').then((r) => r.rows)
    );
    res.status(200).json({ pagamentos: rows });
    return;
  }

  if (req.method === 'POST') {
    const { user_id: userId, plano, valor, observacao } = req.body || {};
    if (!userId || !plano) { res.status(400).json({ error: 'campos obrigatórios: user_id, plano' }); return; }

    const row = await withUser(admin.profileId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO pagamentos (user_id, plano, valor, observacao, status, aprovado_em)
         VALUES ($1, $2, $3, $4, 'aprovado', now()) RETURNING *`,
        [userId, plano, valor || 0, observacao || null]
      );
      await client.query('UPDATE profiles SET plano = $1, atualizado_em = now() WHERE id = $2', [plano, userId]);
      return inserted.rows[0];
    });
    res.status(201).json({ pagamento: row });
    return;
  }

  if (req.method === 'PATCH') {
    const id = req.query && req.query.id;
    const { status } = req.body || {};
    if (!id || !['aprovado', 'cancelado'].includes(status)) {
      res.status(400).json({ error: 'query param id e campo status (aprovado|cancelado) obrigatórios' });
      return;
    }
    const row = await withUser(admin.profileId, async (client) => {
      const updated = await client.query(
        `UPDATE pagamentos SET status = $2, aprovado_em = CASE WHEN $2 = 'aprovado' THEN now() ELSE aprovado_em END
         WHERE id = $1 RETURNING *`,
        [id, status]
      );
      const pag = updated.rows[0];
      if (pag && status === 'aprovado') {
        await client.query('UPDATE profiles SET plano = $1, atualizado_em = now() WHERE id = $2', [pag.plano, pag.user_id]);
      }
      return pag;
    });
    if (!row) { res.status(404).json({ error: 'pagamento não encontrado' }); return; }
    res.status(200).json({ pagamento: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
