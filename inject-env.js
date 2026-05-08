// inject-env.js — Roda durante o build do Netlify
// Substitui os placeholders de window.PP com as env vars reais
// Assim as credenciais nunca ficam no repositório

const fs = require('fs');

const SUPABASE_URL     = process.env.SUPABASE_URL     || '';
const SUPABASE_ANON    = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('[inject-env] ⚠️  SUPABASE_URL ou SUPABASE_ANON_KEY não definidas — app rodará em modo local.');
}

let config = fs.readFileSync('pp-config.js', 'utf8');

config = config
  .replace("window.__SUPABASE_URL__  || ''", `'${SUPABASE_URL}'`)
  .replace("window.__SUPABASE_ANON__ || ''", `'${SUPABASE_ANON}'`);

fs.writeFileSync('pp-config.js', config);
console.log('[inject-env] ✅ pp-config.js atualizado com variáveis de ambiente.');
