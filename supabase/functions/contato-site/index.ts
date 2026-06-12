// MestrePro — Edge Function: contato-site
// Recebe o formulário público de contato da landing page e envia por email
// via Resend para a caixa do suporte, com reply-to do visitante.
//
// POST /contato-site  { nome, email, telefone?, mensagem, website? (honeypot) }
//
// Segurança:
//   - CORS restrito ao domínio do site
//   - Honeypot "website": bots que preenchem são descartados silenciosamente
//   - Rate limit: 5 mensagens/hora por IP (tabela contato_mensagens)
//   - Sanitização de HTML em todos os campos
//
// Env necessárias: RESEND_API_KEY, EMAIL_FROM, CONTATO_EMAIL (destino),
//                  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticas)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://mestrepro.space',
  'https://www.mestrepro.space',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, erro: 'Método não permitido' }), { status: 405, headers: CORS });
  }

  try {
    const body = await req.json();
    const nome = String(body.nome || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 200).toLowerCase();
    const telefone = String(body.telefone || '').trim().slice(0, 30);
    const mensagem = String(body.mensagem || '').trim().slice(0, 3000);
    const honeypot = String(body.website || '').trim();

    // Bot preencheu o campo invisível — responde ok sem fazer nada
    if (honeypot) return new Response(JSON.stringify({ ok: true }), { headers: CORS });

    if (!nome || nome.length < 2) {
      return new Response(JSON.stringify({ ok: false, erro: 'Informe seu nome.' }), { status: 400, headers: CORS });
    }
    if (!EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ ok: false, erro: 'Informe um e-mail válido.' }), { status: 400, headers: CORS });
    }
    if (!mensagem || mensagem.length < 10) {
      return new Response(JSON.stringify({ ok: false, erro: 'Escreva sua mensagem (mínimo 10 caracteres).' }), { status: 400, headers: CORS });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ip = (req.headers.get('x-forwarded-for') || 'desconhecido').split(',')[0].trim();

    // Rate limit: máx. 5 mensagens por IP na última hora
    const { count } = await sb.from('contato_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('criado_em', new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= 5) {
      return new Response(JSON.stringify({ ok: false, erro: 'Muitas mensagens enviadas. Tente novamente mais tarde.' }), { status: 429, headers: CORS });
    }

    const { error: insErr } = await sb.from('contato_mensagens').insert({
      nome, email, telefone: telefone || null, mensagem, ip,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
    });
    if (insErr) {
      console.error('[contato-site] erro ao salvar:', insErr.message);
      return new Response(JSON.stringify({ ok: false, erro: 'Erro ao registrar mensagem. Tente novamente.' }), { status: 500, headers: CORS });
    }

    const destino = Deno.env.get('CONTATO_EMAIL') || 'contatomestrepro@gmail.com';
    const from = Deno.env.get('EMAIL_FROM') || 'MestrePro <noreply@mestrepro.space>';
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      console.error('[contato-site] RESEND_API_KEY ausente — mensagem salva mas email não enviado.');
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
        <h2 style="color:#6172f3;margin-bottom:4px">📩 Novo contato pelo site</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0">mestrepro.space — formulário "Fale com a gente"</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#6b7280;width:90px">Nome</td><td style="padding:6px 0"><strong>${esc(nome)}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#6b7280">E-mail</td><td style="padding:6px 0">${esc(email)}</td></tr>
          ${telefone ? `<tr><td style="padding:6px 0;color:#6b7280">Telefone</td><td style="padding:6px 0">${esc(telefone)}</td></tr>` : ''}
        </table>
        <div style="background:#f4f6fc;border-radius:10px;padding:16px;margin-top:12px;font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(mensagem)}</div>
        <p style="color:#9aa6c2;font-size:12px;margin-top:16px">Responda este e-mail para falar direto com ${esc(nome)} (reply-to configurado).</p>
      </div>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [destino], reply_to: email,
        subject: `📩 Contato site: ${nome}`,
        html,
      }),
    });
    if (!r.ok) console.error('[contato-site] Resend falhou:', r.status, await r.text());

    return new Response(JSON.stringify({ ok: true }), { headers: CORS });
  } catch (e) {
    console.error('[contato-site] erro:', e?.message || e);
    return new Response(JSON.stringify({ ok: false, erro: 'Requisição inválida.' }), { status: 400, headers: corsHeaders(req) });
  }
});
