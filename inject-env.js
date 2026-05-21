#!/usr/bin/env node
// inject-env.js — MestrePro
// Injeta variáveis de ambiente no pp-config.js antes do deploy.
//
// Uso:
//   node inject-env.js             → produção (lê process.env)
//   node inject-env.js --local     → desenvolvimento (lê pp-config.local.js)
//   node inject-env.js --check-only → valida sem escrever arquivos
//
// Variáveis esperadas:
//   SUPABASE_URL          (obrigatória)
//   SUPABASE_ANON_KEY     (obrigatória)
//   META_PIXEL_ID         (opcional — deixar vazio desativa o Pixel)
//   GA4_MEASUREMENT_ID    (opcional — deixar vazio desativa o GA4)

const fs   = require('fs')
const path = require('path')

const isLocal    = process.argv.includes('--local')
const checkOnly  = process.argv.includes('--check-only')

// ── Carregar variáveis ────────────────────────────────────
let env = {}

if (isLocal) {
  const localFile = path.join(__dirname, 'pp-config.local.js')
  if (!fs.existsSync(localFile)) {
    console.error('❌  pp-config.local.js não encontrado.')
    console.error('   Copie pp-config.local.example.js e preencha as credenciais.')
    process.exit(1)
  }
  // Executa o arquivo local e captura window.__LOCAL__
  const src = fs.readFileSync(localFile, 'utf8')
  const match = src.match(/window\.__LOCAL__\s*=\s*({[\s\S]+?})/)
  if (match) {
    try { env = JSON.parse(match[1]) } catch { env = {} }
  }
  // Fallback: tenta ler como chave=valor simples
  if (!env.SUPABASE_URL) {
    src.split('\n').forEach(line => {
      const m = line.match(/['"]?([\w]+)['"]?\s*[:=]\s*['"](.+)['"]/)
      if (m) env[m[1]] = m[2]
    })
  }
} else {
  env = process.env
}

// ── Validação das variáveis obrigatórias ──────────────────
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
const missing  = REQUIRED.filter(k => !env[k])

if (missing.length > 0) {
  console.error('❌  Variáveis obrigatórias ausentes:', missing.join(', '))
  if (!isLocal) {
    console.error('   Configure-as em: Netlify → Site settings → Environment variables')
    console.error('   Ou crie um arquivo pp-config.local.js para desenvolvimento local.')
  }
  process.exit(1)
}

if (checkOnly) {
  console.log('✅  Todas as variáveis obrigatórias estão configuradas.')
  const optional = ['META_PIXEL_ID', 'GA4_MEASUREMENT_ID']
  optional.forEach(k => {
    if (env[k]) console.log(`   ${k}: configurado`)
    else         console.log(`   ${k}: não configurado (opcional)`)
  })
  process.exit(0)
}

// ── Gerar pp-config.js com os valores injetados ───────────
const supabaseUrl  = env['SUPABASE_URL']
const supabaseAnon = env['SUPABASE_ANON_KEY']
const metaPixelId  = env['META_PIXEL_ID']  || ''
const ga4Id        = env['GA4_MEASUREMENT_ID'] || ''

// Bloco Meta Pixel (omitido se META_PIXEL_ID não configurado)
const metaPixelBlock = metaPixelId ? `
  // ── Meta Pixel ────────────────────────────────────────────
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', '${metaPixelId}');
  fbq('track', 'PageView');` : '  // Meta Pixel: META_PIXEL_ID não configurado'

// Bloco GA4 (omitido se GA4_MEASUREMENT_ID não configurado)
const ga4Block = ga4Id ? `
  // ── Google Analytics 4 ───────────────────────────────────
  (function(){
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=${ga4Id}';
    document.head.appendChild(s);
  })();
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${ga4Id}');` : '  // GA4: GA4_MEASUREMENT_ID não configurado'

const configContent = `// pp-config.js — gerado automaticamente por inject-env.js
// NÃO edite este arquivo manualmente. Edite inject-env.js ou as env vars.
// Gerado em: ${new Date().toISOString()}

(function () {
${metaPixelBlock}

${ga4Block}

  // ── Config central ─────────────────────────────────────────
  window.PP = {
    // Supabase
    supabaseUrl: '${supabaseUrl}',
    supabaseKey: '${supabaseAnon}',

    // URLs do app
    appUrl:      'https://mestrepro.space',
    assinarPath: '/pintopro-assinar.html',
    planosPath:  '/pintopro-planos.html',

    // Links do Mercado Pago — atualize conforme pp-config.template.js
    mpBasico:      'https://mpago.la/19VUY91',
    mpBasicoAnual: 'https://mpago.la/2mBWE1i',
    mpPro:         'https://mpago.la/1ieWwdr',
    mpProAnual:    'https://mpago.la/2YpEhnF',
    mpEquipe:      'https://mpago.la/1YuzDuc',
    mpEquipeAnual: 'https://mpago.la/15PqKDb',
    mpIaPro:       'https://mpago.la/1iWJVWP',
    mpIaProAnual:  'https://mpago.la/119g9kC',

    precos: {
      basico:   { mensal: 49,  anual: 490,  eq: 41  },
      pro:      { mensal: 97,  anual: 970,  eq: 81  },
      equipe:   { mensal: 197, anual: 1970, eq: 164 },
      'ia-pro': { mensal: 297, anual: 2970, eq: 247 },
    },

    appNome:   'MestrePro',
    appSlogan: 'Plataforma do Profissional',
  };
})();
`

const outPath = path.join(__dirname, 'pp-config.js')
fs.writeFileSync(outPath, configContent, 'utf8')

console.log('✅  pp-config.js gerado com sucesso.')
console.log(`   SUPABASE_URL:       ${supabaseUrl.slice(0, 40)}...`)
console.log(`   SUPABASE_ANON_KEY:  ${supabaseAnon.slice(0, 20)}...`)
if (metaPixelId) console.log(`   META_PIXEL_ID:      ${metaPixelId}`)
if (ga4Id)       console.log(`   GA4_MEASUREMENT_ID: ${ga4Id}`)
