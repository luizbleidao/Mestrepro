import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://mestrepro.space',
  'https://www.mestrepro.space',
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

function normalizarTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return '55' + digits;
  return digits;
}

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

  // OTP_SECRET obrigatório — sem fallback inseguro
  const secret = Deno.env.get('OTP_SECRET');
  if (!secret) {
    console.error('[wpp-otp-verify] OTP_SECRET não configurada');
    return new Response(JSON.stringify({ erro: 'configuracao_ausente' }), { status: 500, headers });
  }

  try {
    const { telefone, codigo } = await req.json();
    if (!telefone || !codigo) {
      return new Response(JSON.stringify({ erro: 'campos_obrigatorios' }), { status: 400, headers });
    }

    const telNorm = normalizarTelefone(telefone);
    const codigoLimpo = String(codigo).replace(/\D/g, '').slice(0, 6);

    if (codigoLimpo.length !== 6) {
      return new Response(JSON.stringify({ erro: 'codigo_invalido' }), { status: 400, headers });
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Buscar OTP mais recente válido para esse telefone
    const { data: otp, error: otpErr } = await sb
      .from('otp_verificacoes')
      .select('id, codigo_hash, tentativas, expira_em, usado')
      .eq('telefone', telNorm)
      .eq('usado', false)
      .gte('expira_em', new Date().toISOString())
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (otpErr) throw otpErr;

    if (!otp) {
      return new Response(
        JSON.stringify({ erro: 'codigo_expirado', mensagem: 'Código expirado ou não encontrado. Solicite um novo.' }),
        { status: 400, headers }
      );
    }

    // Bloquear após 5 tentativas
    if (otp.tentativas >= 5) {
      await sb.from('otp_verificacoes').update({ usado: true }).eq('id', otp.id);
      return new Response(
        JSON.stringify({ erro: 'muitas_tentativas', mensagem: 'Código bloqueado por excesso de tentativas. Solicite um novo.' }),
        { status: 429, headers }
      );
    }

    // Validar hash
    const hashEsperado = await hmacSHA256(codigoLimpo + telNorm, secret);

    if (hashEsperado !== otp.codigo_hash) {
      await sb.from('otp_verificacoes').update({ tentativas: otp.tentativas + 1 }).eq('id', otp.id);
      const restantes = 4 - otp.tentativas;
      return new Response(
        JSON.stringify({ erro: 'codigo_incorreto', mensagem: `Código incorreto. ${restantes} tentativa${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}.` }),
        { status: 400, headers }
      );
    }

    // Código correto — marcar como usado
    await sb.from('otp_verificacoes').update({ usado: true }).eq('id', otp.id);

    // Token de verificação com expiração de 30 min
    const tokenPayload = {
      telefone: telNorm,
      verificado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    const tokenStr = btoa(JSON.stringify(tokenPayload));

    return new Response(
      JSON.stringify({
        ok: true,
        token_verificacao: tokenStr,
        mensagem: 'Número verificado com sucesso!',
      }),
      { status: 200, headers }
    );

  } catch (e) {
    console.error('[wpp-otp-verify] erro:', e);
    return new Response(JSON.stringify({ erro: 'erro_interno' }), { status: 500, headers });
  }
});
