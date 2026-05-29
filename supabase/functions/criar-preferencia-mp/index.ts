/**
 * MestrePro — criar-preferencia-mp
 * Cria uma preferência de pagamento no Mercado Pago de forma dinâmica,
 * com external_reference=userId:planoKey embutido na preferência.
 *
 * Isso garante que o webhook receba o external_reference corretamente,
 * diferente de links estáticos mpago.la que não repassam query params.
 *
 * Deploy:
 *   supabase functions deploy criar-preferencia-mp
 *
 * Env vars necessárias (supabase secrets set):
 *   MP_ACCESS_TOKEN       → token de acesso do Mercado Pago
 *   SUPABASE_URL          → preenchido automaticamente
 *   SUPABASE_ANON_KEY     → preenchido automaticamente
 *   APP_URL               → ex: https://mestrepro.space
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://mestrepro.space',
  'https://www.mestrepro.space',
  'http://localhost:3000',
  'http://localhost:5173',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// ── Catálogo de planos ────────────────────────────────────────────────────────
const PLANOS: Record<string, {
  nome: string;
  descricao: string;
  mensal: number;
  anual: number;
  planoKey_mensal: string;
  planoKey_anual: string;
}> = {
  basico: {
    nome: 'MestrePro Básico',
    descricao: 'Plano Básico MestrePro — orçamentos, contratos e recibos',
    mensal: 49.00,
    anual: 490.00,
    planoKey_mensal: 'mestrepro_basico_mensal',
    planoKey_anual:  'mestrepro_basico_anual',
  },
  pro: {
    nome: 'MestrePro Pro',
    descricao: 'Plano Pro MestrePro — tudo ilimitado',
    mensal: 97.00,
    anual: 970.00,
    planoKey_mensal: 'mestrepro_pro_mensal',
    planoKey_anual:  'mestrepro_pro_anual',
  },
  equipe: {
    nome: 'MestrePro Equipe',
    descricao: 'Plano Equipe MestrePro — gestão de times',
    mensal: 197.00,
    anual: 1970.00,
    planoKey_mensal: 'mestrepro_equipe_mensal',
    planoKey_anual:  'mestrepro_equipe_anual',
  },
  'ia-pro': {
    nome: 'MestrePro IA Pro',
    descricao: 'Plano IA Pro MestrePro — inteligência artificial completa',
    mensal: 297.00,
    anual: 2970.00,
    planoKey_mensal: 'mestrepro_iapro_mensal',
    planoKey_anual:  'mestrepro_iapro_anual',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }

  try {
    // ── Autenticar usuário via JWT ───────────────────────────────────────────
    const authHeader = req.headers.get('authorization') ?? '';
    const sbUrl  = Deno.env.get('SUPABASE_URL') ?? '';
    const sbAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const sb = createClient(sbUrl, sbAnon, {
      global: { headers: { authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: 'Não autenticado. Faça login para assinar.' }),
        { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── Validar body ─────────────────────────────────────────────────────────
    let body: { plano_id?: string; periodo?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Body inválido.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const planoId = (body.plano_id ?? '').toLowerCase().trim();
    const periodo = (body.periodo ?? 'mensal').toLowerCase().trim();

    if (!planoId || !PLANOS[planoId]) {
      return new Response(
        JSON.stringify({ error: `Plano inválido: "${planoId}". Use: basico, pro, equipe, ia-pro` }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    if (!['mensal', 'anual'].includes(periodo)) {
      return new Response(
        JSON.stringify({ error: 'Período inválido. Use: mensal ou anual' }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── Montar external_reference ────────────────────────────────────────────
    const plano     = PLANOS[planoId];
    const planoKey  = periodo === 'anual' ? plano.planoKey_anual : plano.planoKey_mensal;
    const valor     = periodo === 'anual' ? plano.anual : plano.mensal;
    const extRef    = `${user.id}:${planoKey}`;
    const appUrl    = Deno.env.get('APP_URL') ?? 'https://mestrepro.space';
    const mpToken   = Deno.env.get('MP_ACCESS_TOKEN') ?? '';

    if (!mpToken) {
      console.error('[criar-preferencia-mp] MP_ACCESS_TOKEN não configurado.');
      return new Response(
        JSON.stringify({ error: 'Configuração de pagamento indisponível.' }),
        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    // ── Criar preferência no Mercado Pago ────────────────────────────────────
    const preference = {
      items: [
        {
          id: planoKey,
          title: plano.nome,
          description: plano.descricao,
          quantity: 1,
          unit_price: valor,
          currency_id: 'BRL',
        },
      ],
      external_reference: extRef,
      payer: {
        email: user.email ?? '',
      },
      back_urls: {
        success: `${appUrl}/pintopro-app.html?pagamento=sucesso&plano=${planoId}`,
        failure: `${appUrl}/pintopro-planos.html?pagamento=falhou`,
        pending: `${appUrl}/pintopro-planos.html?pagamento=pendente`,
      },
      auto_return: 'approved',
      statement_descriptor: 'MESTREPRO',
      notification_url: `${sbUrl}/functions/v1/webhook-mp`,
      // Expiração de 30 minutos para a preferência
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    });

    if (!mpRes.ok) {
      const mpErr = await mpRes.text();
      console.error('[criar-preferencia-mp] MP API error:', mpRes.status, mpErr);
      return new Response(
        JSON.stringify({ error: 'Erro ao criar preferência de pagamento. Tente novamente.' }),
        { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    }

    const mpData = await mpRes.json();

    console.log(`[criar-preferencia-mp] ✅ Preferência criada: ${mpData.id} | user: ${user.id} | plano: ${planoKey}`);

    return new Response(
      JSON.stringify({
        preference_id: mpData.id,
        init_point: mpData.init_point,         // URL de checkout (produção)
        sandbox_init_point: mpData.sandbox_init_point, // URL de teste
        plano_key: planoKey,
        valor,
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('[criar-preferencia-mp] Erro inesperado:', err);
    return new Response(
      JSON.stringify({ error: 'Erro interno. Tente novamente.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
