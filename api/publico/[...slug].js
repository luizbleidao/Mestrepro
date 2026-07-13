// Rotas públicas (sem Clerk) consolidadas no mesmo padrão de api/[...slug].js.
const routes = {
  assinar: require('../_lib/handlers/publico-assinar'),
  portal: require('../_lib/handlers/publico-portal'),
  aprovacao: require('../_lib/handlers/publico-aprovacao'),
  cpf: require('../_lib/handlers/publico-cpf'),
  planos: require('../_lib/handlers/publico-planos'),
};

function resolveSlug(req) {
  if (req.query && req.query.slug) {
    return Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
  }
  const pathname = (req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/publico\//, '').split('/').filter(Boolean);
}

module.exports = (req, res) => {
  const slug = resolveSlug(req);
  const resource = slug[0];
  const handler = routes[resource];
  if (!handler) {
    res.status(404).json({ error: `rota pública desconhecida: /${slug.join('/')}` });
    return;
  }
  return handler(req, res);
};
