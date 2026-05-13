// ═══════════════════════════════════════════════════════════════════
// MestrePro — Configuração Centralizada
// Altere aqui para atualizar todas as páginas de uma vez.
// ═══════════════════════════════════════════════════════════════════
window.PP = {
  supabaseUrl: 'https://ufdrxucvyukgzvenfuhj.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmZHJ4dWN2eXVrZ3p2ZW5mdWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDQ2NjksImV4cCI6MjA5MDYyMDY2OX0.AmnG0ECoAuSZg0a_kz2hOB98vbY5w6z8ziXBukP57dM',

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
