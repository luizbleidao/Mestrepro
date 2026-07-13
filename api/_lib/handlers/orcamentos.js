const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// Campos que o módulo de orçamentos (iframe) pode alterar via PATCH — cada um
// corresponde a um .update({...}) isolado que o pintopro-orcamentos.html fazia
// direto no Supabase (portal_token, aprov_token, sig_token, etc.).
const CAMPOS_PATCH = [
  'portal_token', 'portal_progresso', 'portal_etapa',
  'aprov_token', 'aprov_status',
  'sig_token',
];

// GET    /api/orcamentos          — lista completa do usuário
// POST   /api/orcamentos          — upsert (cria ou atualiza se o id já existir)
// PATCH  /api/orcamentos?id=ID    — atualiza campos específicos (tokens/portal)
// DELETE /api/orcamentos?id=ID
module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, endereco, status, total, mode, data, data_completa,
                  sig_token, sig_cliente, sig_cliente_at, sig_cliente_nome,
                  portal_token, portal_progresso, portal_etapa,
                  aprov_token, aprov_status, aprov_at, aprov_motivo,
                  criado_em, atualizado_em
           FROM orcamentos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT 500`,
          [auth.profileId]
        )
        .then((r) => r.rows)
    );
    res.status(200).json({ orcamentos: rows });
    return;
  }

  if (req.method === 'POST') {
    // Checagem de limite de plano — equivalente ao que hoje é feito client-side
    // + RPC meu_uso() antes de criar. Fica no backend, não no frontend
    // (CLAUDE.md: "Limites de plano NUNCA devem ser enforçados apenas no frontend").
    const body = req.body || {};
    if (!body.id || !body.cliente) {
      res.status(400).json({ error: 'campos obrigatórios: id, cliente' });
      return;
    }

    try {
      const row = await withUser(auth.profileId, async (client) => {
        const existente = await client.query('SELECT 1 FROM orcamentos WHERE id = $1 AND user_id = $2', [body.id, auth.profileId]);
        if (existente.rowCount === 0) {
          const uso = await client.query('SELECT meu_uso() AS uso');
          const restantes = uso.rows[0].uso.orcamentos_restantes;
          if (restantes !== null && restantes <= 0) {
            const err = new Error('Limite de orçamentos do seu plano atingido.');
            err.status = 403;
            throw err;
          }
        }
        const inserted = await client.query(
          `INSERT INTO orcamentos (id, user_id, numero, cliente, endereco, status, total, mode, data, data_completa, atualizado_em)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6,'rascunho'), COALESCE($7,0), COALESCE($8,'prod'), $9, $10, now())
           ON CONFLICT (id) DO UPDATE SET
             numero = EXCLUDED.numero, cliente = EXCLUDED.cliente, endereco = EXCLUDED.endereco,
             status = EXCLUDED.status, total = EXCLUDED.total, mode = EXCLUDED.mode,
             data = EXCLUDED.data, data_completa = EXCLUDED.data_completa, atualizado_em = now()
           WHERE orcamentos.user_id = $2
           RETURNING *`,
          [
            body.id, auth.profileId, body.numero || null, body.cliente, body.endereco || null,
            body.status, body.total, body.mode, body.data || null, body.data_completa || {},
          ]
        );
        return inserted.rows[0];
      });
      res.status(201).json({ orcamento: row });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'PATCH') {
    const id = req.query && req.query.id;
    const body = req.body || {};
    const campos = Object.keys(body).filter((k) => CAMPOS_PATCH.includes(k));
    if (!id || !campos.length) {
      res.status(400).json({ error: 'query param id obrigatório e ao menos um campo editável no corpo' });
      return;
    }
    const sets = campos.map((c, i) => `${c} = $${i + 3}`).join(', ');
    const values = campos.map((c) => body[c]);
    const row = await withUser(auth.profileId, (client) =>
      client
        .query(
          `UPDATE orcamentos SET ${sets}, atualizado_em = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
          [id, auth.profileId, ...values]
        )
        .then((r) => r.rows[0])
    );
    if (!row) { res.status(404).json({ error: 'orçamento não encontrado' }); return; }
    res.status(200).json({ orcamento: row });
    return;
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    if (!id) { res.status(400).json({ error: 'query param obrigatório: id' }); return; }
    await withUser(auth.profileId, (client) =>
      client.query('DELETE FROM orcamentos WHERE id = $1 AND user_id = $2', [id, auth.profileId])
    );
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
