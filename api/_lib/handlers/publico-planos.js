const { pool } = require('../db');

// GET /api/publico/planos — público, sem auth. Substitui sb.rpc('get_planos_config')
// usado no modal de upgrade (preços/promoções vindos do banco, não hardcoded).
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const { rows } = await pool.query('SELECT * FROM get_planos_config()');
  res.status(200).json({ planos: rows });
};
