/**
 * MestrePro — Edge Function: pagar-comissao
 *
 * Dispara um PIX automático para o referrer após uma venda confirmada.
 * Chamada internamente pelo webhook-mp (não exposta ao público).
 *
 * Env vars necessárias (supabase secrets set):
 *   MP_ACCESS_TOKEN           → token da conta MestrePro no MP
 *   SUPABASE_URL              → preenchido automaticamente
 *   SUPABASE_SERVICE_ROLE_KEY → preenchido automaticamente
 *
 * Requisito na conta MP:
 *   Ativar "Transferências" em mercadopago.com.br → Seu negócio → Transferências
 *   (ou solicitar acesso ao endpoint de Payouts via suporte MP)
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Valor mínimo para disparar o PIX (evita transferências de centavos)
const PAYOUT_MINIMO_BRL = 5.00;

interface PayoutRequest {
  indicacao_id: string;
  referrer_id:  string;
  comissao_brl: number;
}

serve(async (req: Request) => {
  // Só aceita POST interno (sem JWT público — chamado pelo webhook-mp)
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verificar origem interna (header secreto simples)
  const internalSecret = Deno.env.get('INTERNAL_SECRET') ?? '';
  if (internalSecret && req.headers.get('x-internal-secret') !== internalSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: PayoutRequest;
  try {
    body = await req.json();
  } catch {
    return new Response('Body inválido', { status: 400 });
  }

  const { indicacao_id, referrer_id, comissao_brl } = body;

  if (!indicacao_id || !referrer_id || !comissao_brl) {
    return new Response('Parâmetros ausentes', { status: 422 });
  }

  const sbUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const sb    = createClient(sbUrl, sbKey);

  // ── Valor mínimo ──────────────────────────────────────────────────────────
  if (comissao_brl < PAYOUT_MINIMO_BRL) {
    console.log(`[pagar-comissao] Comissão R$ ${comissao_brl} abaixo do mínimo — marcando como não aplicável.`);
    await sb.rpc('marcar_payout', {
      p_indicacao_id: indicacao_id,
      p_status:       'nao_aplicavel',
      p_erro:         `Valor R$ ${comissao_brl} abaixo do mínimo de R$ ${PAYOUT_MINIMO_BRL}`,
    });
    return new Response(JSON.stringify({ ok: false, motivo: 'abaixo_do_minimo' }), { status: 200 });
  }

  // ── Buscar chave PIX e email do referrer ──────────────────────────────────
  const { data: profile, error: profErr } = await sb
    .from('profiles')
    .select('empresa_data, id')
    .eq('id', referrer_id)
    .single();

  if (profErr || !profile) {
    console.error('[pagar-comissao] Perfil não encontrado:', profErr?.message);
    await sb.rpc('marcar_payout', {
      p_indicacao_id: indicacao_id,
      p_status: 'falhou',
      p_erro: 'Perfil do referrer não encontrado',
    });
    return new Response(JSON.stringify({ ok: false, motivo: 'perfil_nao_encontrado' }), { status: 200 });
  }

  const pixChave = (profile.empresa_data as Record<string, string>)?.pixChave?.trim();

  if (!pixChave) {
    console.warn('[pagar-comissao] Referrer sem chave PIX cadastrada:', referrer_id);
    await sb.rpc('marcar_payout', {
      p_indicacao_id: indicacao_id,
      p_status: 'falhou',
      p_erro: 'Referrer não tem chave PIX cadastrada no perfil',
    });
    return new Response(JSON.stringify({ ok: false, motivo: 'sem_chave_pix' }), { status: 200 });
  }

  // ── Buscar email do referrer (para o campo payer do MP) ───────────────────
  const { data: { users }, error: userErr } = await sb.auth.admin.listUsers();
  const referrerUser = users?.find(u => u.id === referrer_id);
  const referrerEmail = referrerUser?.email ?? 'referrer@mestrepro.space';

  if (userErr) {
    console.warn('[pagar-comissao] Erro ao buscar email do referrer (não crítico):', userErr.message);
  }

  // ── Chamar API do Mercado Pago — PIX Payout ───────────────────────────────
  // Documentação: https://www.mercadopago.com.br/developers/pt/reference/transfers/_transfers/post
  const mpToken = Deno.env.get('MP_ACCESS_TOKEN') ?? '';
  const idempotencyKey = `mestrepro-comissao-${indicacao_id}`;

  // Detectar tipo de chave PIX automaticamente
  const pixType = detectarTipoChavePix(pixChave);

  const payloadMP = {
    transaction_amount: comissao_brl,
    description:        `Comissão MestrePro — indicação ${indicacao_id.slice(0, 8).toUpperCase()}`,
    payment_method_id:  'pix',
    external_reference: `comissao:${indicacao_id}`,
    payer: {
      email: 'pagamentos@mestrepro.space', // email da conta MestrePro que envia
    },
    receiver: {
      email: referrerEmail,
    },
    point_of_interaction: {
      type: 'PIX',
      pix_data: {
        key_type: pixType,
        key:      pixChave,
      },
    },
  };

  console.log(`[pagar-comissao] Enviando PIX R$ ${comissao_brl} → chave ${pixType}:${pixChave}`);

  let mpResponse: Response;
  try {
    mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization':    `Bearer ${mpToken}`,
        'Content-Type':     'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payloadMP),
    });
  } catch (fetchErr) {
    console.error('[pagar-comissao] Erro de rede ao chamar MP:', String(fetchErr));
    await sb.rpc('marcar_payout', {
      p_indicacao_id: indicacao_id,
      p_status: 'falhou',
      p_erro: `Erro de rede: ${String(fetchErr)}`,
    });
    return new Response(JSON.stringify({ ok: false, motivo: 'erro_rede' }), { status: 200 });
  }

  const mpData = await mpResponse.json();

  if (!mpResponse.ok || !['approved', 'pending', 'in_process'].includes(mpData.status)) {
    const erro = mpData?.message ?? mpData?.error ?? `HTTP ${mpResponse.status}`;
    console.error('[pagar-comissao] MP recusou o payout:', erro, JSON.stringify(mpData));
    await sb.rpc('marcar_payout', {
      p_indicacao_id: indicacao_id,
      p_status: 'falhou',
      p_mp_id:  String(mpData.id ?? ''),
      p_erro:   erro,
    });
    return new Response(JSON.stringify({ ok: false, motivo: erro }), { status: 200 });
  }

  // ── Sucesso ───────────────────────────────────────────────────────────────
  console.log(`[pagar-comissao] ✅ PIX enviado! MP ID: ${mpData.id}, status: ${mpData.status}`);
  await sb.rpc('marcar_payout', {
    p_indicacao_id: indicacao_id,
    p_status: 'enviado',
    p_mp_id:  String(mpData.id),
  });

  return new Response(JSON.stringify({
    ok: true,
    mp_id:  mpData.id,
    status: mpData.status,
    valor:  comissao_brl,
    chave:  pixChave,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── Detectar tipo de chave PIX ────────────────────────────────────────────
function detectarTipoChavePix(chave: string): string {
  const limpa = chave.replace(/\D/g, '');
  // CPF: 11 dígitos
  if (/^\d{11}$/.test(limpa)) return 'CPF';
  // CNPJ: 14 dígitos
  if (/^\d{14}$/.test(limpa)) return 'CNPJ';
  // Telefone: começa com + ou tem 10-11 dígitos com DDD
  if (/^\+?\d{10,13}$/.test(limpa)) return 'PHONE';
  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) return 'EMAIL';
  // Chave aleatória (UUID)
  return 'EVP';
}
