const { withSystem } = require('../db');

// GET /api/publico/cpf?cpf=00000000000 — checagem anti-abuso antes do cadastro
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const cpf = (req.query && req.query.cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) {
    res.status(400).json({ error: 'cpf inválido' });
    return;
  }
  const disponivel = await withSystem((client) =>
    client.query('SELECT verificar_cpf_disponivel($1) AS r', [cpf]).then((r) => r.rows[0].r)
  );
  res.status(200).json({ disponivel });
};
