// inject-env.js — Roda durante o build do Netlify
// Lê pp-config.template.js (source of truth no git) e gera pp-config.js
// com as credenciais reais injetadas a partir das env vars do Netlify.
//
// ⚠️  NUNCA modifica pp-config.template.js — sem risco de corrupção em
//     builds consecutivos ou cache de build.
// pp-config.js deve estar no .gitignore (gerado em build-time).

const fs = require('fs');

const SUPABASE_URL  = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY  || '';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('[inject-env] ❌ SUPABASE_URL ou SUPABASE_ANON_KEY não definidas no Netlify.');
  process.exit(1);
}

const template = fs.readFileSync('pp-config.template.js', 'utf8');

const config = template
  .replace("window.__SUPABASE_URL__  || ''", `'${SUPABASE_URL}'`)
  .replace("window.__SUPABASE_ANON__ || ''", `'${SUPABASE_ANON}'`);

fs.writeFileSync('pp-config.js', config);
console.log('[inject-env] ✅ pp-config.js gerado a partir do template com variáveis de ambiente.');
