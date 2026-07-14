const { adminOrRespond } = require('../adminAuth');
const { withUser } = require('../db');

// GET   /api/admin-painel?tipo=metricas|mrr|indicacoes|assinaturas|ia-uso|retencao
// PATCH /api/admin-painel?tipo=plano-config   { id, nome, descricao, preco_mensal, preco_anual,
//                                                desconto_pct, promo_inicio, promo_validade, promo_label, ativo }
module.exports = async (req, res) => {
  const admin = await adminOrRespond(req, res);
  if (!admin) return;

  const tipo = req.query && req.query.tipo;

  if (req.method === 'GET') {
    if (tipo === 'metricas') {
      const data = await withUser(admin.profileId, async (client) => {
        const orcs = await client.query('SELECT COUNT(*)::int AS n FROM orcamentos');
        const laudos = await client.query('SELECT COUNT(*)::int AS n FROM laudos');
        const producao = await client.query('SELECT * FROM get_producao_por_usuario()');
        return { totalOrcs: orcs.rows[0].n, totalLaudos: laudos.rows[0].n, producao: producao.rows };
      });
      res.status(200).json(data);
      return;
    }

    if (tipo === 'mrr') {
      const data = await withUser(admin.profileId, (client) =>
        client.query('SELECT admin_get_mrr_stats() AS r').then((r) => r.rows[0].r)
      );
      res.status(200).json(data);
      return;
    }

    if (tipo === 'indicacoes') {
      const rows = await withUser(admin.profileId, (client) =>
        client.query('SELECT * FROM admin_get_indicacoes()').then((r) => r.rows)
      );
      res.status(200).json({ indicacoes: rows });
      return;
    }

    if (tipo === 'assinaturas') {
      const rows = await withUser(admin.profileId, (client) =>
        client
          .query('SELECT id, user_id, plano, status, criado_em, atualizado_em FROM assinaturas ORDER BY criado_em DESC LIMIT 300')
          .then((r) => r.rows)
      );
      res.status(200).json({ assinaturas: rows });
      return;
    }

    if (tipo === 'ia-uso') {
      const rows = await withUser(admin.profileId, (client) =>
        client.query('SELECT * FROM admin_get_ia_uso()').then((r) => r.rows)
      );
      res.status(200).json({ ia_uso: rows });
      return;
    }

    if (tipo === 'retencao') {
      const data = await withUser(admin.profileId, async (client) => {
        const orcsHoje = await client.query("SELECT COUNT(*)::int AS n FROM orcamentos WHERE criado_em >= date_trunc('day', now())");
        const ativosHoje = await client.query("SELECT COUNT(*)::int AS n FROM profiles WHERE atualizado_em >= now() - interval '24 hours'");
        const ativos7d = await client.query("SELECT COUNT(*)::int AS n FROM profiles WHERE atualizado_em >= now() - interval '7 days'");
        const churnRisk = await client.query(
          `SELECT id, nome, plano, atualizado_em FROM profiles
           WHERE plano IN ('pro','equipe','ia-pro','ia_pro') AND atualizado_em < now() - interval '14 days'
           ORDER BY atualizado_em ASC LIMIT 50`
        );
        const novos = await client.query(
          `SELECT id, nome, plano, criado_em FROM profiles WHERE criado_em >= now() - interval '7 days'
           ORDER BY criado_em DESC LIMIT 20`
        );
        const orcsDias = await client.query("SELECT criado_em FROM orcamentos WHERE criado_em >= now() - interval '7 days'");
        return {
          orcsHoje: orcsHoje.rows[0].n, ativosHoje: ativosHoje.rows[0].n, ativos7d: ativos7d.rows[0].n,
          churnRisk: churnRisk.rows, novos: novos.rows, orcsDias: orcsDias.rows,
        };
      });
      res.status(200).json(data);
      return;
    }

    res.status(400).json({ error: 'query param tipo inválido ou ausente' });
    return;
  }

  if (req.method === 'PATCH') {
    if (tipo === 'plano-config') {
      const b = req.body || {};
      if (!b.id || !b.nome) { res.status(400).json({ error: 'campos obrigatórios: id, nome' }); return; }
      try {
        await withUser(admin.profileId, (client) =>
          client.query(
            `SELECT admin_atualizar_plano_config($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              b.id, b.nome, b.descricao || null, b.preco_mensal, b.preco_anual,
              b.desconto_pct || 0, b.promo_inicio || null, b.promo_validade || null,
              b.promo_label || null, b.ativo !== false,
            ]
          )
        );
        res.status(200).json({ ok: true });
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
      return;
    }

    res.status(400).json({ error: 'query param tipo inválido ou ausente' });
    return;
  }

  res.status(405).json({ error: 'method not allowed' });
};
