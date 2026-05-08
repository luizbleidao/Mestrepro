/**
 * MestrePro — Webhook Mercado Pago
 * Supabase Edge Function
 *
 * Deploy:
 *   supabase functions deploy webhook-mp --no-verify-jwt
 *
 * Configurar no painel do MP:
 *   URL: https://<seu-projeto>.supabase.co/functions/v1/webhook-mp
 *   Eventos: payment (todos os status)
 *
 * Env vars necessárias (supabase secrets set):
 *   MP_ACCESS_TOKEN   → token de acesso do Mercado Pago
 *   MP_WEBHOOK_SECRET → segredo de verificação (opcional mas recomendado)
 *   SUPABASE_URL      → preenchido automaticamente pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY → preenchido automaticamente
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hmac } from 'https://deno.land/x/hmac@v2.0.1/mod.ts';

// ── Validação de assinatura HMAC do Mercado Pago ───────────────────────────
// Docs: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
async function validarAssinaturaMP(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get('MP_WEBHOOK_SECRET');
  if (!secret) {
    // Se a variável não foi configurada, bloqueia por segurança (fail-closed)
    console.error('[webhook-mp] MP_WEBHOOK_SECRET não configurada — requisição rejeitada.');
    return false;
  }

  // O MP envia: x-signature: ts=<timestamp>,v1=<hash>
  const xSignature = req.headers.get('x-signature') || '';
  const xRequestId = req.headers.get('x-request-id') || '';
  const dataId     = new URL(req.url).searchParams.get('data.id') || '';

  // Extrair ts e v1 do header
  const parts: Record<string, string> = {};
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const { ts, v1 } = parts;
  if (!ts || !v1) {
    console.error('[webhook-mp] Header x-signature ausente ou malformado.');
    return false;
  }

  // Montar o template exato que o MP assina: id:dataId;request-id:xRequestId;ts:ts;
  const template = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calcular HMAC-SHA256
  const calculado = hmac('sha256', secret, template, 'utf8', 'hex') as string;

  if (calculado !== v1) {
    console.error('[webhook-mp] Assinatura HMAC inválida. Possível requisição forjada.');
    return false;
  }

  // Proteção anti-replay: rejeitar notificações com timestamp > 5 minutos de diferença
  const agora = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  if (Math.abs(agora - tsNum) > 300) {
    console.error('[webhook-mp] Timestamp fora da janela de 5 min — possível replay attack.');
    return false;
  }

  return true;
}

// ── Mapa de planos MP → MestrePro ──────────────────────────────────────────
// Preencha com os seus IDs de plano no painel do Mercado Pago
const PLANO_MAP: Record<string, { plano: string; dias: number }> = {
  // Mensais
  'mestrepro_basico_mensal':  { plano: 'basico',  dias: 30  },
  'mestrepro_pro_mensal':     { plano: 'pro',     dias: 30  },
  'mestrepro_equipe_mensal':  { plano: 'equipe',  dias: 30  },
  'mestrepro_iapro_mensal':   { plano: 'ia-pro',  dias: 30  },
  // Anuais
  'mestrepro_basico_anual':   { plano: 'basico',  dias: 365 },
  'mestrepro_pro_anual':      { plano: 'pro',     dias: 365 },
  'mestrepro_equipe_anual':   { plano: 'equipe',  dias: 365 },
  'mestrepro_iapro_anual':    { plano: 'ia-pro',  dias: 365 },
};

// ── Preços (centavos) para conferência anti-fraude ─────────────────────────
const VALOR_MINIMO: Record<string, number> = {
  basico: 4900, pro: 9700, equipe: 19700, 'ia-pro': 29700,
};

// ──────────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  // Supabase faz health check com GET
  if (req.method === 'GET') return new Response('MestrePro webhook OK', { status: 200 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    // Ler o body como texto primeiro (necessário para validar o HMAC)
    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response('Body inválido', { status: 400 });
    }

    // ── Validar assinatura HMAC antes de qualquer processamento ───────────
    const assinaturaValida = await validarAssinaturaMP(req, rawBody);
    if (!assinaturaValida) {
      return new Response('Assinatura inválida', { status: 401 });
    }

    console.log('[webhook-mp] recebido e validado:', JSON.stringify(body));

    // O MP envia notificações de dois tipos:
    // 1. { type: "payment", data: { id: "..." } }
    // 2. { action: "payment.created", data: { id: "..." } } (v2 IPN)
    const paymentId = body?.data?.id ?? body?.id;
    const eventType = body?.type ?? body?.action ?? '';

    if (!paymentId || !eventType.includes('payment')) {
      return new Response('Evento ignorado', { status: 200 });
    }

    // ── Buscar detalhes do pagamento no MP ─────────────────────────────────
    const mpToken = Deno.env.get('MP_ACCESS_TOKEN') ?? '';
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });

    if (!mpRes.ok) {
      console.error('[webhook-mp] MP retornou', mpRes.status);
      return new Response('MP API error', { status: 502 });
    }

    const payment = await mpRes.json();
    console.log('[webhook-mp] payment status:', payment.status, 'external_ref:', payment.external_reference);

    // ── Só processa pagamentos aprovados ──────────────────────────────────
    if (payment.status !== 'approved') {
      // Cancela plano se for recusa de recorrente / chargeback
      if (['cancelled', 'charged_back', 'refunded'].includes(payment.status)) {
        await handleCancelamento(payment);
      }
      return new Response('Status não é approved', { status: 200 });
    }

    // ── Extrair dados ─────────────────────────────────────────────────────
    // external_reference deve ser setado pelo front como: "userId:planoKey"
    const [userId, planoKey] = (payment.external_reference ?? '').split(':');

    if (!userId || !planoKey) {
      console.error('[webhook-mp] external_reference inválido:', payment.external_reference);
      return new Response('external_reference inválido', { status: 422 });
    }

    const planoInfo = PLANO_MAP[planoKey];
    if (!planoInfo) {
      console.error('[webhook-mp] planoKey não mapeado:', planoKey);
      return new Response('planoKey desconhecido', { status: 422 });
    }

    // Anti-fraude: conferir valor mínimo
    const valorCentavos = Math.round((payment.transaction_amount ?? 0) * 100);
    const minimo = VALOR_MINIMO[planoInfo.plano] ?? 0;
    if (valorCentavos < minimo) {
      console.error('[webhook-mp] valor suspeito', valorCentavos, '<', minimo);
      return new Response('Valor suspeito', { status: 422 });
    }

    // ── Ativar plano no Supabase ───────────────────────────────────────────
    const sbUrl  = Deno.env.get('SUPABASE_URL') ?? '';
    const sbKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const sb     = createClient(sbUrl, sbKey);

    const agora  = new Date();
    const fim    = new Date(agora.getTime() + planoInfo.dias * 24 * 60 * 60 * 1000);

    // Chama a função SQL ativar_plano() definida nas migrations
    const { error: fnErr } = await sb.rpc('ativar_plano', {
      p_user_id:          userId,
      p_plano:            planoInfo.plano,
      p_mp_payment_id:    String(paymentId),
      p_valor:            payment.transaction_amount,
      p_metodo:           payment.payment_type_id ?? 'outros',
      p_periodo_inicio:   agora.toISOString(),
      p_periodo_fim:      fim.toISOString(),
      p_mp_subscription_id: payment.id,
    });

    if (fnErr) {
      console.error('[webhook-mp] ativar_plano() erro:', fnErr);
      return new Response('DB error: ' + fnErr.message, { status: 500 });
    }

    console.log(`[webhook-mp] ✅ Plano ${planoInfo.plano} ativado para user ${userId} até ${fim.toISOString()}`);

    // ── Registrar pagamento na tabela pagamentos ───────────────────────────
    await sb.from('pagamentos').upsert({
      mp_payment_id: String(paymentId),
      user_id: userId,
      valor: payment.transaction_amount,
      status: 'aprovado',
      metodo: payment.payment_type_id ?? 'outros',
      plano: planoInfo.plano,
      criado_em: agora.toISOString(),
    }, { onConflict: 'mp_payment_id' });

    return new Response(JSON.stringify({ ok: true, plano: planoInfo.plano, userId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[webhook-mp] Erro inesperado:', err);
    return new Response('Internal error: ' + String(err), { status: 500 });
  }
});

// ── Cancela/rebaixa plano por chargeback ou cancelamento ──────────────────
async function handleCancelamento(payment: Record<string, unknown>) {
  const [userId] = (String(payment.external_reference ?? '')).split(':');
  if (!userId) return;

  const sbUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb    = createClient(sbUrl, sbKey);

  // Rebaixa para gratuito
  await sb.from('profiles').update({ plano: 'gratuito' }).eq('id', userId);
  await sb.from('subscriptions').update({ status: 'cancelada' }).eq('user_id', userId).eq('status', 'ativa');

  console.log(`[webhook-mp] ⚠️ Plano de ${userId} cancelado/rebaixado para gratuito`);
}
