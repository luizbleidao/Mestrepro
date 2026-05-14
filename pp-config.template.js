// ═══════════════════════════════════════════════════════════════════
// MestrePro — Configuração Centralizada
// Altere aqui para atualizar todas as páginas de uma vez.
// ═══════════════════════════════════════════════════════════════════
window.PP = {
  supabaseUrl: window.__SUPABASE_URL__  || '',
  supabaseKey: window.__SUPABASE_ANON__ || '',

  // ─── URLs do app ───────────────────────────────────────────────────
  appUrl:      'https://mestrepro.space',
  assinarPath: '/pintopro-assinar.html',
  planosPath:  '/pintopro-planos.html',

  // ─── Links Mercado Pago ────────────────────────────────────────────
  // Básico
  mpBasico:      'https://mpago.la/19VUY91',
  mpBasicoAnual: 'https://mpago.la/2mBWE1i',
  // Pro
  mpPro:         'https://mpago.la/1ieWwdr',
  mpProAnual:    'https://mpago.la/2YpEhnF',
  // Equipe
  mpEquipe:      'https://mpago.la/1YuzDuc',
  mpEquipeAnual: 'https://mpago.la/15PqKDb',
  // IA Pro
  mpIaPro:       'https://mpago.la/1iWJVWP',
  mpIaProAnual:  'https://mpago.la/119g9kC',

  // ─── Preços (usados nos modais e landing) ─────────────────────────
  precos: {
    basico:   { mensal: 49,  anual: 490,  eq: 41  },
    pro:      { mensal: 97,  anual: 970,  eq: 81  },
    equipe:   { mensal: 197, anual: 1970, eq: 164 },
    'ia-pro': { mensal: 297, anual: 2970, eq: 247 },
  },

  // ─── Marca ────────────────────────────────────────────────────────
  appNome:   'MestrePro',
  appSlogan: 'Plataforma do Profissional',

};
