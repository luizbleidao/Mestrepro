const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// GET  /api/orcamentos       — substitui supabase.from('orcamentos').select()
// POST /api/orcamentos       — substitui supabase.from('orcamentos').insert()
//
// Este arquivo é o MODELO a copiar para os demais módulos (contratos, laudos,
// recibos, agenda, despesas, obras, equipes, ...) — mesma estrutura:
// 1) authOrRespond, 2) withUser (seta app.current_user_id p/ o RLS do Neon),
// 3) query já filtrando por user_id explicitamente no código (não depender só do RLS).
module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await withUser(auth.profileId, (client) =>
      client
        .query(
          `SELECT id, numero, cliente, endereco, status, total, data, criado_em, atualizado_em
           FROM orcamentos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT 200`,
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
        const uso = await client.query('SELECT meu_uso() AS uso');
        const restantes = uso.rows[0].uso.orcamentos_restantes;
        if (restantes !== null && restantes <= 0) {
          const err = new Error('Limite de orçamentos do seu plano atingido.');
          err.status = 403;
          throw err;
        }
        const inserted = await client.query(
          `INSERT INTO orcamentos (id, user_id, cliente, endereco, dados, status, total, data)
           VALUES ($1, $2, $3, $4, $5, COALESCE($6,'rascunho'), COALESCE($7,0), $8)
           RETURNING *`,
          [
            body.id, auth.profileId, body.cliente, body.endereco || null,
            body.dados || {}, body.status, body.total, body.data || null,
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

  res.status(405).json({ error: 'method not allowed' });
};
