/**
 * MestrePro — criar-preferencia-mp v3
 * verify_jwt: false — auth manual via getUser() (igual às funções IA)
 * Preços lidos da tabela planos_config (editável pelo admin).
 * Aplica desconto percentual se promoção ativa.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const PLANOS_FALLBACK: Record<string, { nome: string; descricao: string; mensal: number; anual: number }> = {
  basico:   { nome: 'MestrePro Básico',  descricao: 'Plano Básico',  mensal: 49,  anual: 490  },
  pro:      { nome: 'MestrePro Pro',     descricao: 'Tudo ilimitado', mensal: 97,  anual: 970  },
  equipe:   { nome: 'MestrePro Equipe',  descricao: 'Pro + equipe',   mensal: 197, anual: 1970 },
  'ia-pro': { nome: 'MestrePro IA Pro',  descricao: 'Equipe + IA',    mensal: 297, anual: 2970 },
};

const PLANO_KEY: Record<string, { mensal: string; anual: string }> = {
  basico:   { mensal: 'mestrepro_basico_mensal',  anual: 'mestrepro_basico_anual' },
  pro:      { mensal: 'mestrepro_pro_mensal',     anual: 'mestrepro_pro_anual' },
  equipe:   { mensal: 'mestrepro_equipe_mensal',  anual: 'mestrepro_equipe_anual' },
  'ia-pro': { mensal: 'mestrepro_iapro_mensal',   anual: 'mestrepro_iapro_anual' },
};

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const sbUrl  = Deno.env.get('SUPABASE_URL') ?? '';
    const sbAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const sbSvc  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // ── Auth manual (verify_jwt: false — igual às funções IA) ──────────────────
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Não autenticado. Faça login para assinar.' }, 401);
    }

    const sbUser = createClient(sbUrl, sbAnon, {
      global: { headers: { authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await sbUser.auth.getUser();
    if (authErr || !user) {
      console.warn('[criar-preferencia-mp] Auth falhou:', authErr?.message);
      return json({ error: 'Não autenticado. Faça login para assinar.' }, 401);
    }

    // ── Validar body ────────────────────────────────────────────────────────────
    let body: { plano_id?: string; periodo?: string };
    try { body = await req.json(); }
    catch { return json({ error: 'Body inválido.' }, 400); }

    const planoId = (body.plano_id ?? '').toLowerCase().trim();
    const periodo = (body.periodo ?? 'mensal').toLowerCase().trim();

    if (!planoId) return json({ error: 'plano_id é obrigatório.' }, 422);
    if (!['mensal', 'anual'].includes(periodo)) return json({ error: 'Período inválido. Use: mensal ou anual' }, 422);

    const keys = PLANO_KEY[planoId];
    if (!keys) return json({ error: `Plano inválido: "${planoId}"` }, 422);

    // ── Buscar preços do banco ──────────────────────────────────────────────────
    const sbAdmin = createClient(sbUrl, sbSvc);
    const { data: planosData, error: dbErr } = await sbAdmin.rpc('get_planos_config');

    let nomePlano: string;
    let descricao: string;
    let valorFinal: number;

    if (dbErr || !planosData) {
      console.warn('[criar-preferencia-mp] DB indisponível, usando fallback:', dbErr?.message);
      const fb = PLANOS_FALLBACK[planoId];
      if (!fb) return json({ error: `Plano não encontrado: "${planoId}"` }, 422);
      nomePlano  = fb.nome;
      descricao  = fb.descricao;
      valorFinal = periodo === 'anual' ? fb.anual : fb.mensal;
    } else {
      const plano = (planosData as Array<Record<string, unknown>>).find(
        (p) => p.id === planoId && p.ativo
      );
      if (!plano) return json({ error: `Plano inativo ou não encontrado: "${planoId}"` }, 422);

      nomePlano  = String(plano.nome);
      descricao  = String(plano.descricao || plano.nome);
      valorFinal = periodo === 'anual'
        ? Number(plano.preco_anual_final)
        : Number(plano.preco_mensal_final);

      if (plano.tem_promo && plano.promo_label) {
        nomePlano = `${plano.nome} — ${plano.promo_label}`;
      }
    }

    const planoKey = periodo === 'anual' ? keys.anual : keys.mensal;
    const mpToken  = Deno.env.get('MP_ACCESS_TOKEN') ?? '';
    if (!mpToken) {
      console.error('[criar-preferencia-mp] MP_ACCESS_TOKEN não configurado.');
      return json({ error: 'Configuração de pagamento indisponível.' }, 500);
    }

    const appUrl = Deno.env.get('APP_URL') ?? 'https://mestrepro.space';
    const extRef = `${user.id}:${planoKey}`;

    const preference = {
      items: [{
        id: planoKey,
        title: nomePlano,
        description: descricao,
        quantity: 1,
        unit_price: valorFinal,
        currency_id: 'BRL',
      }],
      external_reference: extRef,
      payer: { email: user.email ?? '' },
      back_urls: {
        success: `${appUrl}/pintopro-app.html?pagamento=sucesso&plano=${planoId}`,
        failure: `${appUrl}/pintopro-planos.html?pagamento=falhou`,
        pending: `${appUrl}/pintopro-planos.html?pagamento=pendente`,
      },
      auto_return: 'approved',
      statement_descriptor: 'MESTREPRO',
      notification_url: `${sbUrl}/functions/v1/webhook-mp`,
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(preference),
    });

    if (!mpRes.ok) {
      const mpErr = await mpRes.text();
      console.error('[criar-preferencia-mp] MP API error:', mpRes.status, mpErr);
      return json({ error: 'Erro ao criar preferência de pagamento.' }, 502);
    }

    const mpData = await mpRes.json();
    console.log(`[criar-preferencia-mp] ✅ ${mpData.id} | user:${user.id} | plano:${planoKey} | valor:${valorFinal}`);

    return json({
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      plano_key: planoKey,
      valor: valorFinal,
    });

  } catch (err) {
    console.error('[criar-preferencia-mp] Erro inesperado:', err);
    return json({ error: 'Erro interno. Tente novamente.' }, 500);
  }
});
