// Rota dinâmica única (Vercel Hobby limita a 12 Serverless Functions por
// deployment — consolidamos os handlers autenticados aqui em vez de um
// arquivo por recurso). Cada entrada do mapa é um módulo em _lib/handlers/
// com a mesma assinatura (req, res) => {...} usada nas rotas individuais.
const routes = {
  me: require('./_lib/handlers/me'),
  orcamentos: require('./_lib/handlers/orcamentos'),
  contratos: require('./_lib/handlers/contratos'),
  laudos: require('./_lib/handlers/laudos'),
  recibos: require('./_lib/handlers/recibos'),
  agenda: require('./_lib/handlers/agenda'),
  despesas: require('./_lib/handlers/despesas'),
  obras: require('./_lib/handlers/obras'),
  equipes: require('./_lib/handlers/equipes'),
  'empresa-config': require('./_lib/handlers/empresa-config'),
  templates: require('./_lib/handlers/templates'),
  'equipe-convite': require('./_lib/handlers/equipe-convite'),
  'equipe-membros': require('./_lib/handlers/equipe-membros'),
  'equipe-info': require('./_lib/handlers/equipe-info'),
  'portal-progresso': require('./_lib/handlers/portal-progresso'),
};

module.exports = (req, res) => {
  const slug = req.query.slug || [];
  const resource = slug[0];
  const handler = routes[resource];
  if (!handler) {
    res.status(404).json({ error: `rota desconhecida: /${slug.join('/')}` });
    return;
  }
  return handler(req, res);
};
