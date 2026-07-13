const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

// POST /api/lgpd { acao: 'exportar' | 'revogar-marketing' | 'excluir-conta' }
// Substitui sb.rpc('exportar_meus_dados'), sb.rpc('revogar_consentimento_marketing')
// e sb.rpc('solicitar_exclusao_conta') — direitos do titular (LGPD Art. 18).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const acao = (req.body || {}).acao;
  const RPCS = {
    exportar: 'exportar_meus_dados',
    'revogar-marketing': 'revogar_consentimento_marketing',
    'excluir-conta': 'solicitar_exclusao_conta',
  };
  const rpc = RPCS[acao];
  if (!rpc) {
    res.status(400).json({ error: 'ação inválida: use exportar | revogar-marketing | excluir-conta' });
    return;
  }

  try {
    const data = await withUser(auth.profileId, (client) =>
      client.query(`SELECT ${rpc}() AS r`).then((r) => r.rows[0].r)
    );
    res.status(200).json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
