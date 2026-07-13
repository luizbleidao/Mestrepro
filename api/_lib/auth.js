const { verifyToken } = require('@clerk/backend');
const { pool } = require('./db');

// Substitui sb.auth.getUser() do Supabase. O frontend manda o session token
// do Clerk (Authorization: Bearer <token>, obtido via getToken() do Clerk JS).
// Retorna { clerkUserId, profileId, email } ou lança erro 401.
async function requireAuth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    const err = new Error('Não autenticado');
    err.status = 401;
    throw err;
  }

  let payload;
  try {
    payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });
  } catch {
    const err = new Error('Token inválido ou expirado');
    err.status = 401;
    throw err;
  }

  const clerkUserId = payload.sub;
  const { rows } = await pool.query(
    'SELECT id, email, ativo FROM profiles WHERE clerk_user_id = $1',
    [clerkUserId]
  );

  if (!rows.length) {
    const err = new Error('Perfil não provisionado — aguarde o webhook do Clerk ou tente novamente em instantes.');
    err.status = 404;
    throw err;
  }
  if (rows[0].ativo === false) {
    const err = new Error('Conta suspensa.');
    err.status = 403;
    throw err;
  }

  return { clerkUserId, profileId: rows[0].id, email: rows[0].email };
}

// Helper padrão pra rotas: chama requireAuth, escreve 401/403/404 e retorna
// null se falhar (caller deve checar e dar return).
async function authOrRespond(req, res) {
  try {
    return await requireAuth(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
    return null;
  }
}

module.exports = { requireAuth, authOrRespond };
