const { pool } = require('./db');

// Porte Node dos templates/lógica de supabase/functions/email-sender (v19) e
// emails-automaticos (v4). Bug corrigido na porta: o email-sender deployado
// lia `item.tipo`, mas quem enfileira (agendar_sequencia_email / aqui
// provision_new_user) sempre gravou na coluna `template` — `tipo` nunca era
// populada em produção, então os emails agendados (dica_d3/trial_d10/...)
// provavelmente nunca saíam. Aqui usamos `template` de forma consistente.

const APP_URL = process.env.APP_URL || 'https://mestrepro.space';
const CTA = 'display:inline-block;background:#185FA5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700';

function base(content) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,sans-serif"><div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:#185FA5;padding:20px 24px"><span style="font-size:20px;font-weight:800;color:#fff">MestrePro</span></div><div style="padding:28px 28px 20px">${content}</div><div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 28px;font-size:11px;color:#9ca3af;text-align:center">MestrePro · mestrepro.space</div></div></body></html>`;
}

const TEMPLATES = {
  boas_vindas: (d) => ({
    subject: `Bem-vindo ao MestrePro, ${d.nome}! 🎨`,
    html: base(`<h1 style="color:#185FA5;font-size:22px">Olá, ${d.nome}! 👋</h1><p style="font-size:15px;line-height:1.7">Sua conta foi criada. Você tem <strong>7 dias grátis</strong>!</p><a href="${APP_URL}/pintopro-app.html" style="${CTA}">Acessar minha conta →</a>`),
  }),
  engajamento_d3: (d) => ({
    subject: `${d.nome}, já criou seu primeiro orçamento? 📋`,
    html: base(`<h1 style="color:#185FA5;font-size:20px">Oi, ${d.nome}!</h1><p style="font-size:15px;line-height:1.7">Criar orçamentos leva menos de 5 minutos!</p><a href="${APP_URL}/pintopro-app.html" style="${CTA}">Criar agora →</a>`),
  }),
  dica_d3: (d) => ({
    subject: `${d.nome}, uma dica para turbinar seus orçamentos 💡`,
    html: base(`<h1 style="color:#185FA5;font-size:20px">Dica para você, ${d.nome}!</h1><p style="font-size:15px">Pintores com orçamentos detalhados fecham 3x mais. <a href="${APP_URL}/pintopro-app.html">Experimente agora</a>.</p>`),
  }),
  trial_expirando: (d) => ({
    subject: `⚠️ Seu período grátis acaba em breve, ${d.nome}`,
    html: base(`<h1 style="color:#d97706;font-size:20px">⚠️ Atenção, ${d.nome}!</h1><p style="font-size:15px">Assine a partir de <strong>R$ 29,90/mês</strong>.</p><a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Ver planos →</a>`),
  }),
  trial_d10: (d) => ({
    subject: `${d.nome}, seu trial termina em breve 🕐`,
    html: base(`<h1 style="color:#d97706;font-size:20px">Olá, ${d.nome}!</h1><p style="font-size:15px">Seu período gratuito está quase no fim.</p><a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Garantir minha conta →</a>`),
  }),
  ultima_chance_d14: (d) => ({
    subject: `🚨 Última chance! Seu trial expira hoje, ${d.nome}`,
    html: base(`<h1 style="color:#dc2626;font-size:20px">🚨 Hoje é o último dia, ${d.nome}!</h1><p style="font-size:15px">Assine agora para não perder o acesso.</p><a href="${APP_URL}/pintopro-planos.html" style="${CTA}">Assinar agora →</a>`),
  }),
  confirmacao_assinatura: (d) => ({
    subject: `✅ Assinatura confirmada! Bem-vindo ao plano ${d.plano_nome || 'Pro'}`,
    html: base(`<h1 style="color:#16a34a;font-size:20px">✅ Pagamento confirmado!</h1><p style="font-size:15px">Obrigado, ${d.nome}! Plano <strong>${d.plano_nome || 'Pro'}</strong> ativado.</p><a href="${APP_URL}/pintopro-app.html" style="${CTA}">Acessar minha conta →</a>`),
  }),
};

// Processa até 50 emails pendentes da fila (chamado pelo cron em api/cron/email-sender.js).
async function processarFilaEmails() {
  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'MestrePro <noreply@mestrepro.space>';
  const replyTo = process.env.EMAIL_REPLY_TO || fromEmail;
  if (!resendKey) return { ok: false, error: 'RESEND_API_KEY não configurada' };

  const { rows: fila } = await pool.query(
    `SELECT * FROM email_queue WHERE status = 'pendente' AND tentativas < 3 AND agendado_para <= now()
     ORDER BY criado_em ASC LIMIT 50`
  );
  if (!fila.length) return { ok: true, enviados: 0, mensagem: 'Fila vazia' };

  let enviados = 0, erros = 0;
  for (const item of fila) {
    await pool.query('UPDATE email_queue SET status = $2, tentativas = tentativas + 1 WHERE id = $1', [item.id, 'processando']);
    try {
      const template = TEMPLATES[item.template];
      if (!template) {
        await pool.query("UPDATE email_queue SET status = 'erro', erro_msg = $2 WHERE id = $1", [item.id, `Template desconhecido: ${item.template}`]);
        erros++;
        continue;
      }
      const dados = item.dados || {};
      const { subject, html } = template({ nome: item.nome || item.email.split('@')[0], ...dados });
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: [item.email], subject, html, reply_to: replyTo }),
      });
      if (res.ok) {
        const result = await res.json();
        await pool.query(
          "UPDATE email_queue SET status = 'enviado', enviado_em = now(), resend_id = $2, erro_msg = NULL WHERE id = $1",
          [item.id, result.id]
        );
        try { await pool.query('INSERT INTO email_log (tipo, email, nome, resend_id) VALUES ($1,$2,$3,$4)', [item.template, item.email, item.nome, result.id]); } catch {}
        enviados++;
      } else {
        const errText = (await res.text()).slice(0, 500);
        const novoStatus = item.tentativas >= 2 ? 'erro' : 'pendente';
        await pool.query('UPDATE email_queue SET status = $2, erro_msg = $3 WHERE id = $1', [item.id, novoStatus, errText]);
        erros++;
      }
    } catch (e) {
      const novoStatus = item.tentativas >= 2 ? 'erro' : 'pendente';
      await pool.query('UPDATE email_queue SET status = $2, erro_msg = $3 WHERE id = $1', [item.id, novoStatus, String(e.message).slice(0, 500)]);
      erros++;
    }
  }
  return { ok: true, processados: fila.length, enviados, erros };
}

module.exports = { TEMPLATES, processarFilaEmails };
