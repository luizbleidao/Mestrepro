import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://mestrepro.com.br',
  'https://www.mestrepro.com.br',
  'https://mestrepro.vercel.app',
];

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Normaliza número brasileiro para formato internacional (55XXXXXXXXXXX)
function normalizarTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  return digits;
}

// Gera HMAC-SHA256 do código + telefone + secret
async function hmacSHA256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

  try {
    const { telefone } = await req.json();
    if (!telefone) return new Response(JSON.stringify({ erro: 'telefone_obrigatorio' }), { status: 400, headers });

    const telNorm = normalizarTelefone(telefone);
    if (telNorm.length < 12 || telNorm.length > 13) {
      return new Response(JSON.stringify({ erro: 'telefone_invalido' }), { status: 400, headers });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Rate limit: max 3 OTPs por número nos últimos 60 min
    const { count } = await sb
      .from('otp_verificacoes')
      .select('*', { count: 'exact', head: true })
      .eq('telefone', telNorm)
      .gte('criado_em', new Date(Date.now() - 60 * 60 * 1000).toISOString());

    if ((count ?? 0) >= 3) {
      return new Response(
        JSON.stringify({ erro: 'limite_atingido', mensagem: 'Muitas tentativas. Aguarde 1 hora.' }),
        { status: 429, headers }
      );
    }

    // Verificar se número já tem conta ativa
    const { data: contaExistente } = await sb
      .from('profiles')
      .select('id, plano')
      .eq('whatsapp', telNorm.replace(/^55/, ''))  // armazena sem código do país
      .eq('whatsapp_verificado', true)
      .maybeSingle();

    if (contaExistente) {
      return new Response(
        JSON.stringify({ erro: 'numero_ja_cadastrado', mensagem: 'Este número já está vinculado a uma conta MestrePro.' }),
        { status: 409, headers }
      );
    }

    // Gerar código de 6 dígitos
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const secret = Deno.env.get('OTP_SECRET') || 'mestrepro-otp-fallback-secret';
    const hash = await hmacSHA256(codigo + telNorm, secret);

    // Salvar OTP no banco (expira em 10 min)
    const expira = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: dbErr } = await sb.from('otp_verificacoes').insert({
      telefone: telNorm,
      codigo_hash: hash,
      expira_em: expira,
    });
    if (dbErr) throw dbErr;

    // Enviar via Meta Cloud API
    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN')!;
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_ID')!;

    const msgBody = `Seu código de verificação *MestrePro*: *${codigo}*\n\nVálido por 10 minutos. Não compartilhe este código com ninguém.`;

    const metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: telNorm,
          type: 'text',
          text: { body: msgBody, preview_url: false },
        }),
      }
    );

    if (!metaRes.ok) {
      const metaErr = await metaRes.json();
      console.error('[wpp-otp-send] Meta API error:', JSON.stringify(metaErr));
      return new Response(
        JSON.stringify({ erro: 'falha_envio', mensagem: 'Não foi possível enviar o código. Verifique o número e tente novamente.' }),
        { status: 502, headers }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, mensagem: 'Código enviado via WhatsApp.' }),
      { status: 200, headers }
    );

  } catch (e) {
    console.error('[wpp-otp-send] erro:', e);
    return new Response(JSON.stringify({ erro: 'erro_interno' }), { status: 500, headers });
  }
});
