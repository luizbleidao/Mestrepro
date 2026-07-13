// Rotas públicas (sem Clerk) consolidadas no mesmo padrão de api/[...slug].js.
const routes = {
  assinar: require('../_lib/handlers/publico-assinar'),
  portal: require('../_lib/handlers/publico-portal'),
  aprovacao: require('../_lib/handlers/publico-aprovacao'),
};

module.exports = (req, res) => {
  const slug = req.query.slug || [];
  const resource = slug[0];
  const handler = routes[resource];
  if (!handler) {
    res.status(404).json({ error: `rota pública desconhecida: /${slug.join('/')}` });
    return;
  }
  return handler(req, res);
};
