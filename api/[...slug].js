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
  'signup-extra': require('./_lib/handlers/signup-extra'),
  lgpd: require('./_lib/handlers/lgpd'),
  indicacoes: require('./_lib/handlers/indicacoes'),
  'admin-usuarios': require('./_lib/handlers/admin-usuarios'),
  'admin-pagamentos': require('./_lib/handlers/admin-pagamentos'),
  'admin-painel': require('./_lib/handlers/admin-painel'),
  checkout: require('./_lib/handlers/checkout'),
  'ia-orcamento': require('./_lib/handlers/ia-orcamento'),
  'ia-mensagem': require('./_lib/handlers/ia-mensagem'),
  'ia-diagnostico': require('./_lib/handlers/ia-diagnostico'),
  'ia-preco': require('./_lib/handlers/ia-preco'),
  'ia-laudo': require('./_lib/handlers/ia-laudo'),
  'ia-resumo-cliente': require('./_lib/handlers/ia-resumo-cliente'),
  'ia-followup': require('./_lib/handlers/ia-followup'),
  'ia-patologia': require('./_lib/handlers/ia-patologia'),
  'ia-posts': require('./_lib/handlers/ia-posts'),
};

function resolveSlug(req) {
  if (req.query && req.query.slug) {
    return Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
  }
  // Fallback: nem toda runtime da Vercel popula req.query com os params
  // de [...slug] fora do Next.js — parseia a partir do path cru.
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
}

module.exports = (req, res) => {
  const slug = resolveSlug(req);
  const resource = slug[0];
  const handler = routes[resource];
  if (!handler) {
    res.status(404).json({ error: `rota desconhecida: /${slug.join('/')}` });
    return;
  }
  return handler(req, res);
};
