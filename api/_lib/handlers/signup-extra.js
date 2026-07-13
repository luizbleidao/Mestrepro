const { authOrRespond } = require('../auth');
const { withUser } = require('../db');

function validarCPF(cpf) {
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i], 10) * (10 - i);
  let r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(cpf[9], 10)) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i], 10) * (11 - i);
  r = (s * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(cpf[10], 10);
}

// POST /api/signup-extra — completa o cadastro logo após o Clerk criar a sessão:
// grava CPF (validado + checado como único), consentimento LGPD, tel/cidade,
// e registra indicação se veio de um ref_code. Substitui o que antes era um
// INSERT direto do cliente (supabase.from('profiles').upsert(...)).
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const auth = await authOrRespond(req, res);
  if (!auth) return;

  const body = req.body || {};
  const cpf = (body.cpf || '').replace(/\D/g, '');
  const { tel, cidade, marketing, refCode } = body;

  if (!cpf || !validarCPF(cpf)) {
    res.status(400).json({ error: 'CPF inválido' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

  try {
    const result = await withUser(auth.profileId, async (client) => {
      const disponivel = await client.query('SELECT verificar_cpf_disponivel($1) AS r', [cpf]);
      if (disponivel.rows[0].r === false) {
        const err = new Error('Este CPF já está vinculado a uma conta MestrePro.');
        err.status = 409;
        throw err;
      }

      await client.query(
        `UPDATE profiles SET cpf = $1, cpf_verificado = true, tel = COALESCE($2, tel),
                cidade = COALESCE($3, cidade), consentimento_termos_em = now(),
                consentimento_termos_ip = $4, consentimento_marketing = COALESCE($5, false),
                consentimento_marketing_em = CASE WHEN $5 THEN now() ELSE NULL END
         WHERE id = $6`,
        [cpf, tel || null, cidade || null, ip, !!marketing, auth.profileId]
      );

      let indicacao = null;
      if (refCode) {
        const r = await client.query('SELECT registrar_indicacao($1, $2, $3) AS r', [refCode, auth.profileId, auth.email]);
        indicacao = r.rows[0].r;
      }
      return { ok: true, indicacao };
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};
