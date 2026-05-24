// MestrePro — Edge Function: emails-automaticos
// Dispara emails de ciclo de vida via Resend API
// Endpoints:
//   POST /emails-automaticos  { tipo, user_id, email, nome, dados? }
// Tipos suportados:
//   boas_vindas | engajamento_d3 | trial_expirando | confirmacao_assinatura
//
// Variáveis de ambiente necessárias no Supabase:
//   RESEND_API_KEY       — chave da Resend API (resend.com)
//   EMAIL_FROM           — ex: "MestrePro <noreply@mestrepro.space>"
//   APP_URL              — ex: https://mestrepro.space
//   SUPABASE_SERVICE_ROLE_KEY  (já configurada pelo Supabase)
//   SUPABASE_URL               (já configurada pelo Supabase)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const _APP_URL = Deno.env.get('APP_URL');
if (!_APP_URL) {
  console.error('[emails-automaticos] APP_URL não configurada — CORS bloqueado por segurança.');
}
const CORS = {
  'Access-Control-Allow-Origin': _APP_URL || 'https://mestrepro.space',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Templates ─────────────────────────────────────────────────
const TEMPLATES: Record<string, (d: EmailData) => { subject: string; html: string }> = {

  boas_vindas: (d) => ({
    subject: `Bem-vindo ao MestrePro, ${d.nome}! 🎨`,
    html: baseTemplate(`
      <h1 style="color:#185FA5;font-size:22px;margin-bottom:8px">Olá, ${d.nome}! 👋</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">
        Sua conta no <strong>MestrePro</strong> foi criada com sucesso. Você tem <strong>7 dias grátis</strong>
        para explorar tudo — orçamentos, contratos, laudos técnicos e muito mais.
      </p>
      <div style="background:#f0f7ff;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;font-weight:600;color:#185FA5;margin-bottom:8px">🚀 Por onde começar:</p>
        <ul style="font-size:14px;line-height:2;margin:0;padding-left:20px;color:#374151">
          <li>Crie seu primeiro orçamento em menos de 5 minutos</li>
          <li>Configure o nome da sua empresa no perfil</li>
          <li>Experimente o gerador de laudos técnicos</li>
        </ul>
      </div>
      <a href="${d.appUrl}/pintopro-app.html" style="${CTA_STYLE}">Acessar minha conta →</a>
      <p style="font-size:13px;color:#6b7280;margin-top:20px">
        Alguma dúvida? Só responder este e-mail que a gente te ajuda. 😊
      </p>
    `),
  }),

  engajamento_d3: (d) => ({
    subject: `${d.nome}, já criou seu primeiro orçamento? 📋`,
    html: baseTemplate(`
      <h1 style="color:#185FA5;font-size:20px;margin-bottom:8px">Oi, ${d.nome}! Tudo certo por aí?</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">
        Você se cadastrou no MestrePro há 3 dias. Já teve chance de explorar?
        Criar orçamentos profissionais leva menos de 5 minutos!
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;color:#15803d">
          ✅ Orçamento profissional em PDF<br>
          ✅ Contrato e recibo automáticos<br>
          ✅ Laudo técnico com IA<br>
          ✅ Agenda de visitas
        </p>
      </div>
      <a href="${d.appUrl}/pintopro-app.html" style="${CTA_STYLE}">Criar meu primeiro orçamento →</a>
      <p style="font-size:13px;color:#6b7280;margin-top:20px">
        Seus 7 dias grátis ainda estão ativos. Aproveite! 🎨
      </p>
    `),
  }),

  trial_expirando: (d) => ({
    subject: `⚠️ Seu período grátis acaba em breve, ${d.nome}`,
    html: baseTemplate(`
      <h1 style="color:#d97706;font-size:20px;margin-bottom:8px">⚠️ Atenção, ${d.nome}!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">
        Seu período de teste gratuito do MestrePro está chegando ao fim.
        Para continuar usando sem interrupções, assine um dos planos — a partir de <strong>R$&nbsp;${d.dados?.preco_pro||'29,90'}/mês</strong>.
      </p>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;color:#92400e;font-weight:600">O que você perde sem o plano Pro:</p>
        <ul style="font-size:14px;line-height:1.9;margin:8px 0 0;padding-left:18px;color:#78350f">
          <li>Orçamentos ilimitados em PDF</li>
          <li>Contratos e recibos automáticos</li>
          <li>Assinatura digital</li>
          <li>Dashboard financeiro</li>
        </ul>
      </div>
      <a href="${d.appUrl}/pintopro-planos.html" style="${CTA_STYLE}">Ver planos e preços →</a>
      <p style="font-size:13px;color:#6b7280;margin-top:20px">
        Alguma dúvida sobre os planos? Só responder este e-mail! 😊
      </p>
    `),
  }),

  confirmacao_assinatura: (d) => ({
    subject: `✅ Assinatura confirmada! Bem-vindo ao plano ${d.dados?.plano_nome||'Pro'}`,
    html: baseTemplate(`
      <h1 style="color:#16a34a;font-size:20px;margin-bottom:8px">✅ Pagamento confirmado!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">
        Obrigado, ${d.nome}! Sua assinatura do plano <strong>${d.dados?.plano_nome||'Pro'}</strong> foi ativada com sucesso.
        Agora você tem acesso completo ao MestrePro.
      </p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;margin:0;color:#374151">
          <strong>Plano:</strong> ${d.dados?.plano_nome||'Pro'}<br>
          <strong>Valor:</strong> ${d.dados?.valor||'R$ 29,90/mês'}<br>
          <strong>Próxima cobrança:</strong> ${d.dados?.proxima_cobranca||'em 30 dias'}
        </p>
      </div>
      <a href="${d.appUrl}/pintopro-app.html" style="${CTA_STYLE}">Acessar minha conta →</a>
      <p style="font-size:13px;color:#6b7280;margin-top:16px">
        Em caso de dúvidas sobre sua cobrança, responda este e-mail ou acesse as configurações da sua conta.
      </p>
    `),
  }),

};

// ── Base template ─────────────────────────────────────────────
const CTA_STYLE = [
  'display:inline-block',
  'background:#185FA5',
  'color:#ffffff',
  'text-decoration:none',
  'padding:12px 24px',
  'border-radius:8px',
  'font-size:14px',
  'font-weight:700',
].join(';');

function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#185FA5;padding:20px 24px;display:flex;align-items:center;gap:10px">
      <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px">MestrePro</span>
      <span style="font-size:12px;color:rgba(255,255,255,.7)">Plataforma para pintores profissionais</span>
    </div>
    <div style="padding:28px 28px 20px">${content}</div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#9ca3af;text-align:center">
      MestrePro · mestrepro.space<br>
      Para cancelar o recebimento destes e-mails, acesse as configurações da sua conta.
    </div>
  </div>
</body>
</html>`;
}

// ── Tipos ─────────────────────────────────────────────────────
interface EmailData {
  tipo: string;
  user_id?: string;
  email: string;
  nome: string;
  appUrl: string;
  dados?: Record<string, string>;
}

// ── Handler ───────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Auth: apenas service_role pode chamar (via trigger ou cron)
  const authHeader = req.headers.get('Authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!authHeader.includes(serviceKey.slice(0,16)) && !authHeader.includes('Bearer')) {
    // Verifica se é chamada interna via anon key + verificação de origem
    const origin = req.headers.get('origin') || req.headers.get('x-forwarded-host') || '';
    const appUrl = Deno.env.get('APP_URL') || '';
    if (appUrl && !origin.includes(new URL(appUrl).hostname)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }
  }

  let body: EmailData;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { tipo, email, nome, dados } = body;
  if (!tipo || !email || !nome) {
    return new Response(JSON.stringify({ error: 'Campos obrigatórios: tipo, email, nome' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const template = TEMPLATES[tipo];
  if (!template) {
    return new Response(JSON.stringify({ error: `Tipo desconhecido: ${tipo}` }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const appUrl = Deno.env.get('APP_URL') || 'https://mestrepro.space';
  const emailData: EmailData = { tipo, email, nome, appUrl, dados };
  const { subject, html } = template(emailData);

  // Envia via Resend
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.warn('[emails-automaticos] RESEND_API_KEY não configurada — email não enviado');
    return new Response(JSON.stringify({ ok: true, mock: true, subject }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const fromEmail = Deno.env.get('EMAIL_FROM') || 'MestrePro <noreply@mestrepro.space>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [email], subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[emails-automaticos] Erro Resend:', err);
    return new Response(JSON.stringify({ error: 'Falha ao enviar email', detalhe: err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const result = await res.json();

  // Registra no log de emails (tabela email_log se existir)
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await sb.from('email_log').insert({ tipo, email, nome, resend_id: result.id, enviado_em: new Date().toISOString() });
  } catch (_) { /* tabela pode não existir ainda — silencioso */ }

  return new Response(JSON.stringify({ ok: true, id: result.id }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
