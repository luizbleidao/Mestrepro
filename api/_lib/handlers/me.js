const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// Colunas de profiles que o próprio usuário pode alterar via PATCH /api/me.
// Substitui os vários supabase.from('profiles').update({...}).eq('id',...)
// espalhados pelo pintopro-app.html (dados pessoais, empresa, preferências, assinatura).
const CAMPOS_EDITAVEIS = ['nome', 'tel', 'cidade', 'sig_profissional', 'empresa_data', 'preferencias'];

// GET   /api/me — substitui a leitura direta de `profiles` + RPC meu_uso() que
//       o frontend fazia via supabase.from('profiles').select() / supabase.rpc('meu_uso').
// PATCH /api/me — substitui supabase.from('profiles').update({...}).eq('id', USER.id).
module.exports = async (req, res) => {
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const result = await withUser(auth.profileId, async (client) => {
      const profile = await client.query('SELECT * FROM profiles WHERE id = $1', [auth.profileId]);
      const uso = await client.query('SELECT meu_uso() AS uso');
      return { profile: profile.rows[0], uso: uso.rows[0].uso };
    });
    res.status(200).json(result);
    return;
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const campos = Object.keys(body).filter((k) => CAMPOS_EDITAVEIS.includes(k));
    if (!campos.length) {
      res.status(400).json({ error: 'nenhum campo editável informado' });
      return;
    }
    const sets = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const values = campos.map((c) => body[c]);
    const row = await withUser(auth.profileId, (client) =>
      client
        .query(`UPDATE profiles SET ${sets}, atualizado_em = now() WHERE id = $1 RETURNING *`, [auth.profileId, ...values])
        .then((r) => r.rows[0])
    );
    res.status(200).json({ profile: row });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
