// ═══════════════════════════════════════════════════════════════════
// pp-config.local.example.js — EXEMPLO PARA DESENVOLVIMENTO LOCAL
//
// Como usar:
//   1. Copie este arquivo:  cp pp-config.local.example.js pp-config.local.js
//   2. Preencha os valores abaixo com suas credenciais REAIS do Supabase
//   3. Inclua ANTES de pp-config.js em qualquer HTML que for testar:
//        <script src="pp-config.local.js"></script>
//        <script src="pp-config.js"></script>
//   4. pp-config.local.js já está no .gitignore — nunca será commitado
//
// Em produção (Netlify): as variáveis vêm de Environment Variables,
// não deste arquivo. Consulte SECRETS.md para o guia completo.
// ═══════════════════════════════════════════════════════════════════

// ── Supabase (obrigatório) ─────────────────────────────────────────
window.__SUPABASE_URL__  = 'https://SEU-PROJETO.supabase.co';
window.__SUPABASE_ANON__ = 'eyJ...sua-anon-key-aqui...';
//   Onde buscar: Supabase → Settings → API → Project URL / anon public key

// ── Analytics (opcional — só adicionar quando configurar) ──────────
// window.__META_PIXEL_ID__      = '1234567890123';
// window.__GA4_MEASUREMENT_ID__ = 'G-XXXXXXXXXX';

// ── ATENÇÃO: Segredos que NÃO entram aqui ─────────────────────────
// Os segredos abaixo são APENAS para Edge Functions (Supabase Secrets).
// Nunca coloque eles em nenhum arquivo JS do frontend:
//   - SUPABASE_SERVICE_ROLE_KEY
//   - MP_ACCESS_TOKEN
//   - MP_WEBHOOK_SECRET
//   - RESEND_API_KEY
// Consulte SECRETS.md para saber onde configurar cada um.
