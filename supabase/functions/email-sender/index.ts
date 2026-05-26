// MestrePro — Edge Function: email-sender v17
// Processa a fila email_queue e envia via Resend
//
// Chamado por:
//   - pg_cron: todo dia às 9h e 12h UTC
//   - Admin manual: POST /email-sender  (sem JWT — verify_jwt: false)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://mestrepro.space',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CTA = 'display:inline-block;background:#185FA5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700';

function baseTemplate(content: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#185FA5;padding:20px 24px"><span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.5px">MestrePro</span></div>
    <div style="padding:28px 28px 20px">${content}</div>
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#9ca3af;text-align:center">MestrePro · mestrepro.space</div>
  </div>
</body></html>`;
}

const APP_URL = Deno.env.get('APP_URL') || 'https://mestrepro.space';

const TEMPLATES: Record<string, (d: Record<string, string>) => { subject: string; html: string }> = {

  boas_vindas: (d) => ({
    subject: `Bem-vindo ao MestrePro, ${d.nome}! 🎨`,
    html: baseTemplate(`
      <h1 style="color:#185FA5;font-size:22px;margin-bottom:8px">Olá, ${d.nome}! 👋</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Sua conta no <strong>MestrePro</strong> foi criada com sucesso. Você tem <strong>7 dias grátis</strong> para explorar tudo.</p>
      <div style="background:#f0f7ff;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;font-weight:600;color:#185FA5;margin-bottom:8px">🚀 Por onde começar:</p>
        <ul style="font-size:14px;line-height:2;margin:0;padding-left:20px;color:#374151">
          <li>Crie seu primeiro orçamento em menos de 5 minutos</li>
          <li>Configure o nome da sua empresa no perfil</li>
          <li>Experimente o gerador de laudos técnicos</li>
        </ul>
      </div>
      <a href="${APP_URL}/pintopro-app.html" style="${CTA}">Acessar minha conta →</a>
    `),
  }),

  engajamento_d3: (d) => ({
    subject: `${d.nome}, já criou seu primeiro orçamento? 📋`,
    html: baseTemplate(`
      <h1 style="color:#185FA5;font-size:20px;margin-bottom:8px">Oi, ${d.nome}! Tudo certo por aí?</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Você se cadastrou no MestrePro há 3 dias. Criar orçamentos profissionais leva menos de 5 minutos!</p>
      <a href="${APP_URL}/pintopro-app.html" style="${CTA}">Criar meu primeiro orçamento →</a>
    `),
  }),

  dica_d3: (d) => ({
    subject: `${d.nome}, uma dica para turbinar seus orçamentos 💡`,
    html: baseTemplate(`
      <h1 style="color:#185FA5;font-size:20px;margin-bottom:8px">Dica do MestrePro para você, ${d.nome}!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Sabia que pintores que usam orçamentos detalhados fecham <strong>3x mais serviços</strong>? Com o MestrePro você cria propostas profissionais em minutos.</p>
      <div style="background:#f0f7ff;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;line-height:1.7;margin:0;color:#374151">✅ Calculadora de tinta inclusa<br>✅ Contrato e recibo automáticos<br>✅ Link de aprovação para o cliente</p>
      </div>
      <a href="${APP_URL}/pintopro-app.html" style="${CTA}">Experimentar agora →</a>
    `),
  }),

  trial_expirando: (d) => ({
    subject: `⚠️ Seu período grátis acaba em breve, ${d.nome}`,
    html: baseTemplate(`
      <h1 style="color:#d97706;font-size:20px;margin-bottom:8px">⚠️ Atenção, ${d.nome}!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Seu período de teste gratuito está chegando ao fim. Assine um plano a partir de <strong>R$ 29,90/mês</strong> para continuar.</p>
      <a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Ver planos e preços →</a>
    `),
  }),

  trial_d10: (d) => ({
    subject: `${d.nome}, como está indo? Seu trial termina em breve 🕐`,
    html: baseTemplate(`
      <h1 style="color:#d97706;font-size:20px;margin-bottom:8px">Olá, ${d.nome}!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Você já está há 10 dias no MestrePro. Seu período gratuito está quase no fim — não perca o acesso às suas ferramentas!</p>
      <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;color:#92400e">🎯 Assine agora e mantenha todos os seus orçamentos, contratos e clientes salvos.</p>
      </div>
      <a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Garantir minha conta →</a>
    `),
  }),

  ultima_chance_d14: (d) => ({
    subject: `🚨 Última chance! Seu trial expira hoje, ${d.nome}`,
    html: baseTemplate(`
      <h1 style="color:#dc2626;font-size:20px;margin-bottom:8px">🚨 Hoje é o último dia, ${d.nome}!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Seu período gratuito expira hoje. Assine agora para não perder o acesso aos seus dados e ferramentas.</p>
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:14px;margin:0;color:#7f1d1d">💳 Plano Pintor Pro por apenas <strong>R$ 29,90/mês</strong>. Cancele quando quiser.</p>
      </div>
      <a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Assinar agora →</a>
    `),
  }),

  confirmacao_assinatura: (d) => ({
    subject: `✅ Assinatura confirmada! Bem-vindo ao plano ${d.plano_nome || 'Pro'}`,
    html: baseTemplate(`
      <h1 style="color:#16a34a;font-size:20px;margin-bottom:8px">✅ Pagamento confirmado!</h1>
      <p style="font-size:15px;line-height:1.7;margin-bottom:16px">Obrigado, ${d.nome}! Seu plano <strong>${d.plano_nome || 'Pro'}</strong> foi ativado.</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;margin:0;color:#374151">
          <strong>Plano:</strong> ${d.plano_nome || 'Pro'}<br>
          <strong>Valor:</strong> ${d.valor || 'R$ 29,90/mês'}
        </p>
      </div>
      <a href="${APP_URL}/pintopro-app.html" style="${CTA}">Acessar minha conta →</a>
    `),
  }),

};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('EMAIL_FROM') || 'MestrePro <noreply@mestrepro.space>';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!resendKey) {
    console.error('[email-sender] RESEND_API_KEY não configurada');
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  // Busca itens pendentes (máx 50 por execução)
  const { data: fila, error: filaErr } = await sb
    .from('email_queue')
    .select('*')
    .eq('status', 'pendente')
    .lt('tentativas', 3)
    .order('criado_em', { ascending: true })
    .limit(50);

  if (filaErr) {
    console.error('[email-sender] Erro ao ler fila:', filaErr.message);
    return new Response(JSON.stringify({ error: filaErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!fila?.length) {
    return new Response(JSON.stringify({ ok: true, enviados: 0, mensagem: 'Fila vazia' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let enviados = 0, erros = 0;

  for (const item of fila) {
    // Marca como processando para evitar processamento duplo
    await sb.from('email_queue')
      .update({ status: 'processando', tentativas: (item.tentativas || 0) + 1 })
      .eq('id', item.id);

    try {
      const template = TEMPLATES[item.tipo];
      if (!template) {
        await sb.from('email_queue').update({
          status: 'erro',
          erro_msg: `Tipo desconhecido: ${item.tipo}`,
        }).eq('id', item.id);
        erros++;
        continue;
      }

      const dados = item.dados || {};
      const { subject, html } = template({ nome: item.nome || item.email.split('@')[0], ...dados });

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: fromEmail, to: [item.email], subject, html }),
      });

      if (res.ok) {
        const result = await res.json();
        await sb.from('email_queue').update({
          status: 'enviado',
          enviado_em: new Date().toISOString(),
          resend_id: result.id,
          erro_msg: null,
        }).eq('id', item.id);

        // Registra no email_log — try/catch (não usar .catch() no QueryBuilder)
        try {
          await sb.from('email_log').insert({
            tipo: item.tipo,
            email: item.email,
            nome: item.nome,
            resend_id: result.id,
            enviado_em: new Date().toISOString(),
          });
        } catch (_logErr) {
          // Log falhou mas email foi enviado — não reverter
          console.warn('[email-sender] email_log insert falhou (não crítico)');
        }

        enviados++;
      } else {
        const errText = await res.text();
        console.error(`[email-sender] Resend error para ${item.email}:`, errText);
        const novoStatus = (item.tentativas || 0) >= 2 ? 'erro' : 'pendente';
        await sb.from('email_queue').update({
          status: novoStatus,
          erro_msg: errText.slice(0, 500),
        }).eq('id', item.id);
        erros++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[email-sender] Exception para ${item.email}:`, msg);
      const novoStatus = (item.tentativas || 0) >= 2 ? 'erro' : 'pendente';
      await sb.from('email_queue').update({
        status: novoStatus,
        erro_msg: msg.slice(0, 500),
      }).eq('id', item.id);
      erros++;
    }
  }

  console.log(`[email-sender] Processados: ${fila.length}, enviados: ${enviados}, erros: ${erros}`);
  return new Response(JSON.stringify({ ok: true, processados: fila.length, enviados, erros }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
