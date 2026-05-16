// ═══════════════════════════════════════════════════════════════════
// PATCH: Correção do spinner eterno no login — pintopro-app.html
//
// DIAGNÓSTICO: 4 bugs empilhados
//
// Bug 1 ─ iframeReady não definida no momento certo
//   Os iframes (orc-fr, ldo-fr, posts-fr) carregam do cache e disparam
//   onload="iframeReady(...)" ANTES do bloco <script> principal ser
//   parseado (ele fica no final do body). Resultado: ReferenceError
//   que interrompe o processamento naquele ponto.
//
// Bug 2 ─ init() sem try/catch
//   Se qualquer linha de init() lançar (ex: sb.from('profiles')
//   retornar erro de rede ou RLS inesperado), a exceção vai para
//   um UnhandledPromiseRejection e o loading div NUNCA some.
//
// Bug 3 ─ loadDashboard() sem try/catch na query de laudos
//   A query de laudos NÃO tem try/catch (ao contrário da de orçamentos
//   que tem). Se falhar, lança dentro de init() → spinner eterno.
//
// Bug 4 ─ Sem feedback de erro para o usuário
//   Quando tudo dá errado, o usuário fica olhando o spinner para sempre,
//   sem saber se é erro de senha, rede, ou bug do app.
//
// ═══════════════════════════════════════════════════════════════════
//
// ONDE APLICAR CADA TRECHO:
//
// TRECHO A — Colar logo após <div class="loading" id="loading">
//            (antes de qualquer iframe no body)
//
// TRECHO B — Substituir a linha   const {data:laudos}=await sb.from...
//            dentro de loadDashboard() (sem try/catch hoje)
//
// TRECHO C — Substituir as últimas linhas do arquivo:
//            init();
//            </script>
//            por este trecho
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// TRECHO A — Colar no <body>, logo após a div#loading
// Define iframeReady como global ANTES dos iframes tentarem chamá-la
// ─────────────────────────────────────────────────────────────────
/*
<script>
// Stub antecipado de iframeReady — evita ReferenceError quando iframes
// carregam do cache antes do script principal ser parseado.
// A implementação real no script principal sobrescreve esta ao ser carregada.
window.iframeReady = function(ifrId, loaderId) {
  // Agenda nova tentativa para quando o script principal tiver carregado
  setTimeout(function() {
    if (typeof window._iframeReadyFull === 'function') {
      window._iframeReadyFull(ifrId, loaderId);
    }
  }, 200);
};
</script>
*/

// ─────────────────────────────────────────────────────────────────
// TRECHO B — Substituir o bloco de query de laudos em loadDashboard()
//
// ANTES (remover):
//   const {data:laudos}=await sb.from('laudos').select('id,cliente,criticidade,data').eq('user_id',USER.id).order('data',{ascending:false}).limit(5);
//   const laudoCount=laudos?.length||0;
//   ... (resto do bloco de laudos até renderDashLaudos)
//
// DEPOIS (inserir):
// ─────────────────────────────────────────────────────────────────
/*
  // Laudos — com try/catch (igual ao bloco de orçamentos acima)
  let laudos = [];
  try {
    const {data:laudosDb} = await sb.from('laudos')
      .select('id,cliente,criticidade,data')
      .eq('user_id',USER.id)
      .order('data',{ascending:false})
      .limit(5);
    laudos = laudosDb || [];
  } catch(e) {
    console.warn('[MestrePro] Erro ao carregar laudos:', e?.message);
  }

  const laudoCount = laudos.length;
  const _limLdo = cfg.laudoLim < 9999;

  let laudoMes = laudoCount;
  if (_limLdo && laudos.length) {
    const agora = new Date();
    laudoMes = laudos.filter(l => {
      if (!l.data) return false;
      const d = new Date(l.data);
      return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
    }).length;
  }
  document.getElementById('d-ldo').textContent  = _limLdo ? `${laudoMes}/${cfg.laudoLim}` : laudoCount;
  document.getElementById('d-ldo-s').textContent = _limLdo
    ? `${Math.max(0,cfg.laudoLim-laudoMes)} restante${(cfg.laudoLim-laudoMes)!==1?'s':''} este mês`
    : 'laudos emitidos';

  renderDashLaudos(laudos);
*/

// ─────────────────────────────────────────────────────────────────
// TRECHO C — Substituir o final do arquivo (últimas ~5 linhas do <script>)
//
// ANTES (remover as últimas linhas antes de </script>):
//   init();
//
// DEPOIS (inserir):
// ─────────────────────────────────────────────────────────────────
/*

// Registrar implementação completa de iframeReady para o stub do Trecho A
window._iframeReadyFull = iframeReady;

// Guard: credenciais do Supabase vazias → mostrar erro imediato sem spinner eterno
function _verificarCredenciais() {
  if (!window.PP?.supabaseUrl || window.PP.supabaseUrl === '') {
    _mostrarErroCritico(
      'Configuração ausente',
      'As credenciais do Supabase não foram injetadas no build. ' +
      'Verifique as Environment Variables no Netlify (SUPABASE_URL e SUPABASE_ANON_KEY) ' +
      'e faça um novo deploy.'
    );
    return false;
  }
  return true;
}

// Exibe tela de erro no lugar do spinner (nunca deixa o usuário preso)
function _mostrarErroCritico(titulo, detalhe) {
  const el = document.getElementById('loading');
  if (el) {
    el.innerHTML = `
      <div style="text-align:center;padding:2rem;max-width:400px">
        <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--acc);margin-bottom:1rem">MestrePro</div>
        <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:8px">${titulo}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:1.5rem">${detalhe}</div>
        <a href="pintopro-login.html"
           style="display:inline-block;padding:10px 24px;background:var(--acc);color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">
          Voltar ao login
        </a>
        <div style="margin-top:12px;font-size:11px;color:var(--text3)">
          Se o problema persistir, limpe o cache do navegador (Ctrl+Shift+R)
        </div>
      </div>`;
  }
}

// Ponto de entrada protegido — SUBSTITUI o simples init() no final do arquivo
async function _iniciarApp() {
  // 1. Verificar credenciais antes de qualquer coisa
  if (!_verificarCredenciais()) return;

  // 2. Rodar init() com proteção total
  try {
    await init();
  } catch (erro) {
    console.error('[MestrePro] Erro crítico na inicialização:', erro);

    // Detectar tipos de erro comuns para mensagem útil
    const msg = erro?.message || '';
    let detalhe = 'Ocorreu um erro inesperado ao carregar o aplicativo.';

    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      detalhe = 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
    } else if (msg.includes('JWT') || msg.includes('token') || msg.includes('session')) {
      detalhe = 'Sessão expirada ou inválida. Faça login novamente.';
      setTimeout(() => { window.location.href = 'pintopro-login.html'; }, 2000);
    } else if (msg.includes('supabase') || msg.includes('relation')) {
      detalhe = 'Erro ao conectar com o banco de dados. Tente recarregar a página.';
    }

    _mostrarErroCritico('Erro ao carregar', detalhe);
  }
}

_iniciarApp();
*/
