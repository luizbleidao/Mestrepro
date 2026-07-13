const { authOrRespond } = require('./_lib/auth');
const { withUser } = require('./_lib/db');

// GET /api/me — substitui a leitura direta de `profiles` + RPC meu_uso() que
// o frontend fazia via supabase.from('profiles').select() / supabase.rpc('meu_uso').
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const result = await withUser(auth.profileId, async (client) => {
    const profile = await client.query('SELECT * FROM profiles WHERE id = $1', [auth.profileId]);
    const uso = await client.query('SELECT meu_uso() AS uso');
    return { profile: profile.rows[0], uso: uso.rows[0].uso };
  });

  res.status(200).json(result);
};
