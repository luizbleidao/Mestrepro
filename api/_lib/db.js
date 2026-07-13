const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  max: 5,
});

// Toda query autenticada passa por aqui. Isso é o que substitui o RLS
// automático do Supabase: cada transação seta app.current_user_id (lido
// pelas policies criadas em sql-neon/schema-neon.sql) antes de rodar
// qualquer coisa, então RLS continua sendo a última linha de defesa —
// mas a checagem de posse real deve acontecer no código da rota também.
async function withUser(profileId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_user_id',
      profileId || '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Para rotas de sistema (webhooks, cron) que não agem em nome de um usuário
// e precisam bypassar RLS de propósito (ex: gravar em email_log).
async function withSystem(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withUser, withSystem };
