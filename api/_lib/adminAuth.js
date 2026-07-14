const { requireAuth } = require('./auth');
const { pool } = require('./db');

// Substitui a checagem de admin que cada RPC do Supabase fazia internamente
// (WHERE id=auth.uid() AND (perfil='admin' OR is_admin=true)). Aqui validamos
// uma vez, na borda da API, antes de chamar qualquer RPC administrativa.
async function requireAdmin(req) {
  const auth = await requireAuth(req);
  const { rows } = await pool.query('SELECT perfil, is_admin FROM profiles WHERE id = $1', [auth.profileId]);
  const profile = rows[0];
  if (!profile || (profile.perfil !== 'admin' && !profile.is_admin)) {
    const err = new Error('Acesso negado: permissão de admin necessária.');
    err.status = 403;
    throw err;
  }
  return auth;
}

async function adminOrRespond(req, res) {
  try {
    return await requireAdmin(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
    return null;
  }
}

module.exports = { requireAdmin, adminOrRespond };
