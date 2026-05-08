// ─────────────────────────────────────────────────────────────────────────────
// valorExtenso — converte número para texto em PT-BR (até R$ 999.999.999,99)
// Extraída como utilitária global para evitar duplicação.
// ─────────────────────────────────────────────────────────────────────────────
function valorExtenso(n) {
  const v      = Math.round(n * 100);
  const reais  = Math.floor(v / 100);
  const cts    = v % 100;
  const nums   = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove',
    'dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const dezenas  = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  // centenas[1] = 'cento' para compostos (101-199); 'cem' exato é tratado separadamente
  const centenas = ['','cento','duzentos','trezentos','quatrocentos','quinhentos',
                    'seiscentos','setecentos','oitocentos','novecentos'];

  function ext(n) {
    if (n === 0)   return '';
    if (n < 20)    return nums[n];
    if (n < 100)   { const d=Math.floor(n/10); const u=n%10; return dezenas[d]+(u?' e '+nums[u]:''); }
    if (n < 1000)  {
      if (n === 100) return 'cem';
      const c=Math.floor(n/100); const r=n%100;
      return centenas[c]+(r?' e '+ext(r):'');
    }
    if (n < 1000000) {
      const m=Math.floor(n/1000); const r=n%1000;
      const sep = r ? (r < 100 ? ' e ' : ' ') : '';
      return ext(m)+' mil'+sep+(r?ext(r):'');
    }
    if (n < 1000000000) {
      const m=Math.floor(n/1000000); const r=n%1000000;
      const palavra = m === 1 ? ' milhão' : ' milhões';
      // 'de' antes de reais quando é múltiplo exato de milhão (ex: "dois milhões de reais")
      // tratado na linha abaixo via flag; aqui só monta o extenso numérico
      const sep = r ? ' e ' : '';  // sempre 'e' entre milhões e o restante (PT-BR)
      return ext(m)+palavra+sep+(r?ext(r):'');
    }
    return n.toLocaleString('pt-BR') + ' (extenso indisponível)';
  }

  // Casos especiais de concordância em PT-BR
  let sufixoReais;
  if (reais === 0)                        sufixoReais = ' reais';
  else if (reais === 1)                   sufixoReais = ' real';
  else if (reais % 1000000 === 0)         sufixoReais = ' de reais';   // "dois milhões de reais"
  else                                    sufixoReais = ' reais';

  let s = ext(reais) + sufixoReais;
  if (s.startsWith(' ')) s = 'Zero' + s;  // caso reais === 0
  if (cts > 0) s += ' e ' + ext(cts) + (cts === 1 ? ' centavo' : ' centavos');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ═══════════════════════════════════════════════════════════════
// MestrePro — Módulos: Contratos, Recibos, Agenda
// ═══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// CONTRATOS
// ──────────────────────────────────────────────────────────────
let _contratos = [];

async function loadContratos() {
  const el = document.getElementById('s-contratos');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">Carregando...</div>';

  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    const { data } = await sb.from('contratos').select('*').eq('user_id', uid).order('criado_em', { ascending: false });
    _contratos = data || [];
  } else {
    try { _contratos = JSON.parse(localStorage.getItem('pp_contratos') || '[]'); } catch { _contratos = []; }
  }
  renderContratos();
}

function renderContratos() {
  const el = document.getElementById('s-contratos');
  if (!el) return;

  const statusColor = { rascunho: '#8899bb', ativo: '#5b7fff', concluido: '#22c55e', cancelado: '#ef4444' };
  const statusLabel = { rascunho: 'Rascunho', ativo: 'Ativo', concluido: 'Concluído', cancelado: 'Cancelado' };

  const rows = _contratos.length ? _contratos.map(c => `
    <div class="list-card" onclick="editContrato('${c.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <div style="font-size:13px;font-weight:700">${c.cliente || '—'}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">#${c.numero} · ${c.endereco || '—'}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:${statusColor[c.status]}22;color:${statusColor[c.status]}">${statusLabel[c.status]}</span>
          <span style="font-size:12px;font-weight:700">R$ ${Number(c.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="tbtn" onclick="event.stopPropagation();gerarPDFContrato('${c.id}')" style="font-size:11px;padding:4px 10px">📄 PDF</button>
        <button class="tbtn" onclick="event.stopPropagation();gerarLinkContratoAssinatura('${c.id}')" style="font-size:11px;padding:4px 10px">🔗 Assinar</button>
        <button class="tbtn" onclick="event.stopPropagation();gerarReciboDeContrato('${c.id}')" style="font-size:11px;padding:4px 10px">🧾 Recibo</button>
        <button class="tbtn" onclick="event.stopPropagation();confirmarExcluirContrato('${c.id}')" style="font-size:11px;padding:4px 10px;color:var(--text3)">🗑</button>
      </div>
      ${c.sig_cli_base64 ? '<div style="font-size:10px;color:#22c55e;margin-top:6px">✅ Assinado pelo cliente</div>' :
        c.sig_token ? '<div style="font-size:10px;color:#f59e0b;margin-top:6px">⏳ Aguardando assinatura</div>' : ''}
    </div>`).join('') :
    '<div style="text-align:center;padding:60px 20px;color:var(--text2)"><div style="font-size:48px;margin-bottom:12px">📋</div><div style="font-size:14px;font-weight:600">Nenhum contrato ainda</div><div style="font-size:12px;margin-top:6px">Clique em "+ Novo contrato" para criar seu primeiro contrato de serviço.</div></div>';

  el.innerHTML = rows;
}

function openContratoModal(contratoId) {
  const existing = contratoId ? _contratos.find(c => c.id === contratoId) : null;
  let orcOptions = '';
  try {
    const orcKey = 'orcamentos_' + (USER?.id || 'demo');
    const orcas = JSON.parse(localStorage.getItem(orcKey) || '[]');
    orcOptions = orcas.map(o => `<option value="${o.id}" ${existing?.orcamento_id === o.id ? 'selected' : ''}>#${o.numero} — ${o.cliente||'?'} (R$ ${Number(o.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})})</option>`).join('');
  } catch {}

  openModuleModal('Contrato de Serviço', `
    <div class="mf-grid">
      <div class="mf-field c2">
        <label>Orçamento de origem (opcional)</label>
        <select id="mc-orc"><option value="">— Selecionar —</option>${orcOptions}</select>
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">👤 Dados do Contratante (Cliente)</div>
    <div class="mf-grid">
      <div class="mf-field">
        <label>Nome completo *</label>
        <input id="mc-cliente" type="text" value="${existing?.cliente||''}" placeholder="Nome completo do cliente">
      </div>
      <div class="mf-field">
        <label>CPF / CNPJ do cliente</label>
        <input id="mc-cli-doc" type="text" value="${existing?.dados?.cli_doc||''}" placeholder="000.000.000-00">
      </div>
      <div class="mf-field">
        <label>Endereço do cliente</label>
        <input id="mc-cli-end-res" type="text" value="${existing?.dados?.cli_end_res||''}" placeholder="Rua, nº, bairro, cidade">
      </div>
      <div class="mf-field">
        <label>Endereço da obra *</label>
        <input id="mc-endereco" type="text" value="${existing?.endereco||''}" placeholder="Local de execução dos serviços">
      </div>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">📋 Serviços e Prazo</div>
    <div class="mf-grid">
      <div class="mf-field">
        <label>Data de início</label>
        <input id="mc-inicio" type="date" value="${existing?.data_inicio||''}">
      </div>
      <div class="mf-field">
        <label>Previsão de conclusão</label>
        <input id="mc-fim" type="date" value="${existing?.data_fim||''}">
      </div>
      <div class="mf-field">
        <label>Status</label>
        <select id="mc-status">
          ${['rascunho','ativo','concluido','cancelado'].map(s=>`<option value="${s}" ${(existing?.status||'rascunho')===s?'selected':''}>${{rascunho:'Rascunho',ativo:'Ativo',concluido:'Concluído',cancelado:'Cancelado'}[s]}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="mf-field" style="margin-bottom:12px">
      <label>Descrição detalhada dos serviços *</label>
      <textarea id="mc-escopo" rows="4" placeholder="Descreva todos os serviços a executar: ambientes, tipo de tinta, preparo de superfície, número de demãos...">${existing?.dados?.escopo||''}</textarea>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">💰 Valor e Pagamento</div>
    <div class="mf-grid">
      <div class="mf-field">
        <label>Valor total do contrato (R$) *</label>
        <input id="mc-valor" type="number" step="0.01" value="${existing?.valor||''}" placeholder="0,00">
      </div>
      <div class="mf-field">
        <label>Multa por rescisão (%)</label>
        <input id="mc-multa-rescisao" type="number" step="1" min="0" max="50" value="${existing?.dados?.multa_rescisao||'20'}" placeholder="20">
      </div>
    </div>
    <div class="mf-field" style="margin-bottom:12px">
      <label>Condições de pagamento</label>
      <textarea id="mc-pagamento" rows="2" placeholder="Ex: 50% na assinatura do contrato + 50% na conclusão dos serviços">${existing?.dados?.pagamento||''}</textarea>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">⚖️ Cláusulas Contratuais</div>
    <div class="mf-grid">
      <div class="mf-field">
        <label>Garantia da mão de obra</label>
        <select id="mc-garantia">
          ${['90 dias','6 meses','1 ano','2 anos','Conforme NBR'].map(g=>`<option value="${g}" ${(existing?.dados?.garantia||'1 ano')===g?'selected':''}>${g}</option>`).join('')}
        </select>
      </div>
      <div class="mf-field">
        <label>Foro competente (cidade)</label>
        <input id="mc-foro" type="text" value="${existing?.dados?.foro||''}" placeholder="Ex: Barretos / SP">
      </div>
    </div>
    <div class="mf-field" style="margin-bottom:12px">
      <label>Cláusulas adicionais (opcional)</label>
      <textarea id="mc-clausulas" rows="3" placeholder="Ex: O CONTRATADO poderá suspender os serviços após 5 dias de inadimplência...">${existing?.dados?.clausulas||''}</textarea>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;padding-bottom:5px;border-bottom:1px solid var(--border)">✍️ Testemunhas (opcional)</div>
    <div class="mf-grid">
      <div class="mf-field">
        <label>Testemunha 1 — Nome</label>
        <input id="mc-t1-nome" type="text" value="${existing?.dados?.t1_nome||''}" placeholder="Nome completo">
      </div>
      <div class="mf-field">
        <label>Testemunha 1 — CPF</label>
        <input id="mc-t1-cpf" type="text" value="${existing?.dados?.t1_cpf||''}" placeholder="000.000.000-00">
      </div>
      <div class="mf-field">
        <label>Testemunha 2 — Nome</label>
        <input id="mc-t2-nome" type="text" value="${existing?.dados?.t2_nome||''}" placeholder="Nome completo">
      </div>
      <div class="mf-field">
        <label>Testemunha 2 — CPF</label>
        <input id="mc-t2-cpf" type="text" value="${existing?.dados?.t2_cpf||''}" placeholder="000.000.000-00">
      </div>
    </div>
  `, () => salvarContrato(existing?.id));

  // Auto-fill from orcamento
  document.getElementById('mc-orc')?.addEventListener('change', function() {
    try {
      const orcKey = 'orcamentos_' + (USER?.id || 'demo');
      const orcas = JSON.parse(localStorage.getItem(orcKey) || '[]');
      const orc = orcas.find(o => o.id === this.value);
      if (!orc) return;
      const cli = document.getElementById('mc-cliente');
      const end = document.getElementById('mc-endereco');
      const val = document.getElementById('mc-valor');
      const doc = document.getElementById('mc-cli-doc');
      if (cli && !cli.value) cli.value = orc.cliente || '';
      if (end && !end.value) end.value = orc.endereco || '';
      if (val && !val.value) val.value = orc.total || '';
      if (doc && !doc.value) doc.value = orc.cliDoc || '';
    } catch {}
  });
}

function editContrato(id) { openContratoModal(id); }

async function salvarContrato(existingId) {
  const cliente = document.getElementById('mc-cliente')?.value?.trim();
  const endereco = document.getElementById('mc-endereco')?.value?.trim();
  const valor = parseFloat(document.getElementById('mc-valor')?.value) || 0;
  if (!cliente) { notif('⚠️ Informe o nome do cliente'); return; }

  const id = existingId || 'ct_' + Date.now();
  const numero = existingId ? (_contratos.find(c=>c.id===existingId)?.numero || id.slice(-6)) : String(Date.now()).slice(-6);
  const emp = JSON.parse(localStorage.getItem('empresaSalva') || '{}');

  const obj = {
    id, numero, cliente, endereco, valor,
    status: document.getElementById('mc-status')?.value || 'rascunho',
    orcamento_id: document.getElementById('mc-orc')?.value || null,
    data_inicio: document.getElementById('mc-inicio')?.value || null,
    data_fim: document.getElementById('mc-fim')?.value || null,
    dados: {
      escopo: document.getElementById('mc-escopo')?.value?.trim() || '',
      pagamento: document.getElementById('mc-pagamento')?.value?.trim() || '',
      clausulas: document.getElementById('mc-clausulas')?.value?.trim() || '',
      garantia: document.getElementById('mc-garantia')?.value || '1 ano',
      foro: document.getElementById('mc-foro')?.value?.trim() || '',
      multa_rescisao: document.getElementById('mc-multa-rescisao')?.value || '20',
      cli_doc: document.getElementById('mc-cli-doc')?.value?.trim() || '',
      cli_end_res: document.getElementById('mc-cli-end-res')?.value?.trim() || '',
      t1_nome: document.getElementById('mc-t1-nome')?.value?.trim() || '',
      t1_cpf: document.getElementById('mc-t1-cpf')?.value?.trim() || '',
      t2_nome: document.getElementById('mc-t2-nome')?.value?.trim() || '',
      t2_cpf: document.getElementById('mc-t2-cpf')?.value?.trim() || '',
      empresa: emp,
    },
    criado_em: existingId ? (_contratos.find(c=>c.id===existingId)?.criado_em || new Date().toISOString()) : new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };

  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    await sb.from('contratos').upsert({ ...obj, user_id: uid }, { onConflict: 'id' });
  }

  // Sempre atualiza o array em memória (necessário para renderização em ambos os modos)
  if (existingId) {
    const idx = _contratos.findIndex(c => c.id === id);
    if (idx >= 0) _contratos[idx] = obj;
  } else {
    _contratos.unshift(obj);
  }
  // Persiste no localStorage apenas no modo demo
  if (!uid || uid === 'demo') {
    localStorage.setItem('pp_contratos', JSON.stringify(_contratos));
  }

  closeModuleModal();
  renderContratos();
  notif('📋 Contrato salvo!');
}

async function confirmarExcluirContrato(id) {
  if (!confirm('Excluir este contrato?')) return;
  _contratos = _contratos.filter(c => c.id !== id);
  const uid = USER?.id;
  if (uid && uid !== 'demo') await sb.from('contratos').delete().eq('id', id).eq('user_id', uid);
  else localStorage.setItem('pp_contratos', JSON.stringify(_contratos));
  renderContratos();
  notif('🗑 Contrato excluído');
}

async function gerarLinkContratoAssinatura(contratoId) {
  const ct = _contratos.find(c => c.id === contratoId);
  if (!ct) return;
  let token = ct.sig_token;
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
    ct.sig_token = token;
    // Expiração de 30 dias a partir da geração do link
    const expires = new Date(Date.now() + 30*24*60*60*1000).toISOString();
    ct.sig_token_expires_at = expires;
    const uid = USER?.id;
    if (uid && uid !== 'demo') {
      await sb.from('contratos').update({ sig_token: token, sig_token_expires_at: expires }).eq('id', contratoId);
    } else {
      localStorage.setItem('pp_contratos', JSON.stringify(_contratos));
    }
  }
  const url     = `${window.PP.appUrl}/pintopro-assinar.html?token=${token}&tipo=contrato`;
  const wppMsg  = encodeURIComponent(`Olá ${ct.cliente}! Segue o link para assinar o Contrato de Serviço #${ct.numero} digitalmente:\n${url}`);
  const wppLink = `https://wa.me/?text=${wppMsg}`;

  notif('🔗 Link gerado!');

  // Modal com opções: copiar link ou abrir WhatsApp
  const modal = document.createElement('div');
  modal.id = 'sig-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);';
  modal.innerHTML = `
    <div style="background:var(--surf,#1a1a18);border:1px solid var(--border,#2a2a26);border-radius:14px;padding:28px 24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5);">
      <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;margin-bottom:6px;">🔗 Link de assinatura gerado</div>
      <div style="font-size:12px;color:var(--text2,#a09080);margin-bottom:16px;">
        Envie ao cliente para assinar digitalmente o Contrato #${ct.numero}<br>
        <span style="color:#f59e0b;">⏱ Válido por 30 dias · Expira em ${new Date(expires).toLocaleDateString('pt-BR')}</span>
      </div>
      <input id="sig-url-input" value="${url}" readonly
        style="width:100%;background:var(--surf2,#131311);border:1px solid var(--border,#2a2a26);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--text,#f2ede6);margin-bottom:14px;outline:none;" />
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button onclick="navigator.clipboard.writeText('${url}').then(()=>notif('✅ Link copiado!'))" 
          style="flex:1;padding:11px;background:var(--surf2,#131311);border:1px solid var(--border,#2a2a26);border-radius:9px;color:var(--text,#f2ede6);font-size:13px;font-weight:600;cursor:pointer;">
          📋 Copiar link
        </button>
        <a href="${wppLink}" target="_blank" rel="noopener"
          style="flex:1;padding:11px;background:#25d366;border:none;border-radius:9px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;gap:6px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </a>
      </div>
      <button onclick="document.getElementById('sig-modal')?.remove()" 
        style="width:100%;margin-top:12px;padding:9px;background:transparent;border:1px solid var(--border,#2a2a26);border-radius:9px;color:var(--text2,#a09080);font-size:12px;cursor:pointer;">
        Fechar
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}

async function gerarPDFContrato(contratoId) {
  const ct = _contratos.find(c => c.id === contratoId);
  if (!ct) return;
  const emp = ct.dados?.empresa || JSON.parse(localStorage.getItem('empresaSalva') || '{}');
  const profSig = localStorage.getItem('pp_sig_profissional') || '';
  const hoje = new Date().toLocaleDateString('pt-BR');
  const ini = ct.data_inicio ? new Date(ct.data_inicio + 'T12:00:00').toLocaleDateString('pt-BR') : '___/___/______';
  const fim = ct.data_fim ? new Date(ct.data_fim + 'T12:00:00').toLocaleDateString('pt-BR') : '___/___/______';
  const multa = ct.dados?.multa_rescisao || '20';
  const garantia = ct.dados?.garantia || '1 ano';
  const foro = ct.dados?.foro || emp.cidade || '___________';
  const cliDoc = ct.dados?.cli_doc || '';
  const cliEndRes = ct.dados?.cli_end_res || ct.endereco || '';
  const t1Nome = ct.dados?.t1_nome || '';
  const t1Cpf = ct.dados?.t1_cpf || '';
  const t2Nome = ct.dados?.t2_nome || '';
  const t2Cpf = ct.dados?.t2_cpf || '';

  // valorExtenso agora é função global (ver topo do arquivo)
  const valorFmt = 'R$ ' + Number(ct.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
  const valorExt = valorExtenso(Number(ct.valor||0));

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Contrato #${ct.numero}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#1a1a1a;padding:18mm 20mm;background:#fff;line-height:1.55}
h1{font-size:17px;font-weight:900;color:#0D2E6B;text-align:center;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.subtitle{text-align:center;font-size:9px;color:#888;letter-spacing:.5px;text-transform:uppercase;margin-bottom:18px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #0D2E6B;padding-bottom:10px;margin-bottom:16px}
.header-logo-text{font-size:22px;font-weight:900;color:#2563eb;letter-spacing:-0.5px}
.contract-num{text-align:right;font-size:9px;color:#888}
.contract-num strong{display:block;font-size:14px;font-weight:800;color:#0D2E6B}
.sec{margin-bottom:14px}
.sec-title{font-size:9px;font-weight:800;color:#fff;background:#0D2E6B;text-transform:uppercase;letter-spacing:.8px;padding:4px 10px;margin-bottom:8px;border-radius:2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px}
.field-row{margin-bottom:5px}
.field-lbl{font-size:8.5px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.3px;display:block}
.field-val{font-size:10.5px;font-weight:500;border-bottom:1px dotted #ccc;padding-bottom:1px;min-height:14px}
.clause-box{background:#f8f9fb;border-left:3.5px solid #0D2E6B;padding:9px 12px;margin-bottom:8px;border-radius:0 5px 5px 0;font-size:10px;line-height:1.6}
.clause-box.warning{border-left-color:#dc2626;background:#fef2f2}
.clause-box.success{border-left-color:#16a34a;background:#f0fdf4}
.total-strip{background:#0D2E6B;color:#fff;border-radius:6px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin:12px 0}
.total-strip .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;opacity:.8}
.total-strip .val{font-size:18px;font-weight:900}
.total-ext{font-size:9px;color:#555;text-align:right;margin-top:3px;font-style:italic}
.sig-section{margin-top:20px;padding-top:14px;border-top:1.5px solid #ddd}
.sig-title{font-size:9px;font-weight:800;color:#0D2E6B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;text-align:center}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sig-col{text-align:center}
.sig-img-wrap{height:58px;display:flex;align-items:flex-end;justify-content:center;margin-bottom:2px}
.sig-img{max-height:55px}
.sig-line{border-top:1px solid #333;padding-top:5px;font-size:8.5px;color:#444;text-align:center}
.sig-sub{font-size:8px;color:#888;margin-top:2px;text-align:center}
.witness-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px}
.witness-col{text-align:center}
.witness-line{border-top:1px solid #bbb;padding-top:4px;font-size:8.5px;color:#555;margin-top:48px}
.witness-sub{font-size:8px;color:#999;margin-top:1px}
.footer{margin-top:16px;font-size:9px;color:#888;text-align:center;border-top:1px solid #eee;padding-top:8px}
.tag{display:inline-block;background:#e0e7ff;color:#3730a3;font-size:8px;font-weight:700;padding:1px 6px;border-radius:3px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.4px}
@media print{body{padding:12mm 14mm}@page{margin:0}}
</style></head><body>

<div class="header">
  <div>
    <div class="header-logo-text">${emp.nome || 'Prestador de Serviços'}</div>
    <div style="font-size:9px;color:#666;margin-top:3px">${[emp.doc,emp.tel,emp.email,emp.cidade].filter(Boolean).join(' · ')}</div>
    ${emp.reg ? `<div style="font-size:8.5px;color:#888;margin-top:1px">Registro: ${emp.reg}</div>` : ''}
  </div>
  <div class="contract-num">
    <strong>CONTRATO DE SERVIÇO</strong>
    #${ct.numero} · Emitido em ${hoje}
  </div>
</div>

<!-- PARTES -->
<div class="sec">
  <div class="sec-title">1. Das Partes</div>
  <div class="grid2">
    <div>
      <div class="tag">Contratado (Prestador)</div>
      <div class="field-row"><span class="field-lbl">Nome / Razão Social</span><div class="field-val">${emp.nome||'—'}</div></div>
      <div class="field-row"><span class="field-lbl">CPF / CNPJ</span><div class="field-val">${emp.doc||'—'}</div></div>
      <div class="field-row"><span class="field-lbl">Endereço</span><div class="field-val">${emp.endereco||emp.cidade||'—'}</div></div>
      ${emp.reg ? `<div class="field-row"><span class="field-lbl">Registro Profissional</span><div class="field-val">${emp.reg}</div></div>` : ''}
    </div>
    <div>
      <div class="tag">Contratante (Cliente)</div>
      <div class="field-row"><span class="field-lbl">Nome completo</span><div class="field-val">${ct.cliente||'—'}</div></div>
      <div class="field-row"><span class="field-lbl">CPF / CNPJ</span><div class="field-val">${cliDoc||'—'}</div></div>
      <div class="field-row"><span class="field-lbl">Endereço residencial</span><div class="field-val">${cliEndRes||'—'}</div></div>
    </div>
  </div>
</div>

<!-- OBJETO -->
<div class="sec">
  <div class="sec-title">2. Do Objeto</div>
  <div class="field-row"><span class="field-lbl">Endereço de execução dos serviços</span><div class="field-val">${ct.endereco||'—'}</div></div>
  <div style="margin-top:7px">
    <span class="field-lbl">Descrição detalhada dos serviços</span>
    <div class="clause-box">${(ct.dados?.escopo||'Serviços de pintura conforme acordado.').replace(/\n/g,'<br>')}</div>
  </div>
</div>

<!-- PRAZO -->
<div class="sec">
  <div class="sec-title">3. Do Prazo de Execução</div>
  <div class="grid2">
    <div class="field-row"><span class="field-lbl">Data de início</span><div class="field-val">${ini}</div></div>
    <div class="field-row"><span class="field-lbl">Previsão de conclusão</span><div class="field-val">${fim}</div></div>
  </div>
  <div class="clause-box" style="margin-top:8px;font-size:9.5px">
    O prazo poderá ser prorrogado por motivos de força maior, condições climáticas adversas, atraso no fornecimento de materiais de responsabilidade do CONTRATANTE, ou quaisquer outros eventos fora do controle razoável das partes, mediante comunicação prévia por escrito.
  </div>
</div>

<!-- VALOR -->
<div class="sec">
  <div class="sec-title">4. Do Valor e Forma de Pagamento</div>
  <div class="total-strip">
    <div><div class="lbl">Valor Total</div><div style="font-size:9px;opacity:.7;margin-top:2px">Contrato #${ct.numero}</div></div>
    <div class="val">${valorFmt}</div>
  </div>
  <div class="total-ext">${valorExt}</div>
  ${ct.dados?.pagamento ? `<div class="clause-box" style="margin-top:8px">${ct.dados.pagamento.replace(/\n/g,'<br>')}</div>` : ''}
  <div class="clause-box warning" style="margin-top:6px;font-size:9.5px">
    <strong>Mora e juros (art. 394 do Código Civil):</strong> O não pagamento nas datas acordadas sujeitará o CONTRATANTE ao pagamento de multa de 2% (dois por cento) sobre o valor em atraso, acrescido de juros de mora de 1% (um por cento) ao mês, calculados pro rata die a partir do vencimento.
  </div>
  <div class="clause-box" style="margin-top:4px;font-size:9.5px">
    O CONTRATADO reserva-se o direito de suspender os serviços após 5 (cinco) dias de inadimplência, retomando-os somente após a regularização integral do débito, sem que tal suspensão implique quebra contratual.
  </div>
</div>

<!-- RESPONSABILIDADES -->
<div class="sec">
  <div class="sec-title">5. Das Responsabilidades e Garantia</div>
  <div class="clause-box success" style="font-size:9.5px">
    <strong>Garantia da mão de obra: ${garantia}.</strong> O CONTRATADO garante os serviços executados pelo período indicado, contado da data de conclusão, contra defeitos de execução comprovadamente decorrentes de falha técnica. A garantia não cobre danos causados por mau uso, infiltrações de origem estrutural, umidade ascendente ou quaisquer danos não relacionados aos serviços contratados.
  </div>
  <div class="clause-box" style="margin-top:4px;font-size:9.5px">
    O CONTRATANTE é responsável por garantir o acesso ao local de trabalho nos horários acordados, pelo fornecimento de energia elétrica e água quando necessário, e por proteger ou remover objetos de valor próximos ao local dos serviços. A negligência nessas obrigações isenta o CONTRATADO de responsabilidade por eventuais danos.
  </div>
</div>

<!-- RESCISÃO -->
<div class="sec">
  <div class="sec-title">6. Da Rescisão</div>
  <div class="clause-box warning" style="font-size:9.5px">
    <strong>Multa por rescisão imotivada:</strong> A rescisão deste contrato sem justo motivo, por qualquer das partes, implicará o pagamento de multa correspondente a <strong>${multa}% (${multa === '10' ? 'dez' : multa === '15' ? 'quinze' : multa === '20' ? 'vinte' : multa === '25' ? 'vinte e cinco' : multa + ' por cento'}) do valor total do contrato</strong> (${valorFmt}), em favor da parte não infratora, além do ressarcimento dos danos comprovados.
  </div>
  <div class="clause-box" style="margin-top:4px;font-size:9.5px">
    Constituem justa causa para rescisão sem penalidade: descumprimento reiterado das obrigações pela outra parte após notificação por escrito; caso fortuito ou força maior devidamente comprovados; e demais hipóteses previstas nos artigos 475 e seguintes do Código Civil Brasileiro (Lei nº 10.406/2002).
  </div>
</div>

${ct.dados?.clausulas ? `<div class="sec">
  <div class="sec-title">7. Disposições Adicionais</div>
  <div class="clause-box">${ct.dados.clausulas.replace(/\n/g,'<br>')}</div>
</div>` : ''}

<!-- FORO -->
<div class="sec">
  <div class="sec-title">${ct.dados?.clausulas ? '8' : '7'}. Do Foro</div>
  <div class="clause-box" style="font-size:9.5px">
    Fica eleito o foro da comarca de <strong>${foro}</strong> para dirimir quaisquer dúvidas ou litígios decorrentes deste contrato, com expressa renúncia a qualquer outro, por mais privilegiado que seja. As partes declaram ter lido e concordado com todas as cláusulas deste instrumento, assinando-o em 2 (duas) vias de igual teor.
  </div>
</div>

<div style="text-align:center;font-size:10px;color:#555;margin:12px 0 4px">
  ${foro}, ${hoje}
</div>

<!-- ASSINATURAS -->
<div class="sig-section">
  <div class="sig-title">Assinaturas</div>
  <div class="sig-grid">
    <div class="sig-col">
      <div class="sig-img-wrap">
        ${profSig ? `<img class="sig-img" src="${profSig}">` : '<div style="height:55px"></div>'}
      </div>
      <div class="sig-line">${emp.nome||'Contratado'}</div>
      ${emp.doc ? `<div class="sig-sub">CPF/CNPJ: ${emp.doc}</div>` : ''}
      ${profSig ? '<div class="sig-sub" style="color:#16a34a">✓ Assinatura digital</div>' : ''}
    </div>
    <div class="sig-col">
      <div class="sig-img-wrap">
        ${ct.sig_cli_base64 ? `<img class="sig-img" src="${ct.sig_cli_base64}">` : '<div style="height:55px"></div>'}
      </div>
      <div class="sig-line">${ct.cliente||'Contratante'}</div>
      ${cliDoc ? `<div class="sig-sub">CPF/CNPJ: ${cliDoc}</div>` : ''}
      ${ct.sig_cli_at ? `<div class="sig-sub" style="color:#16a34a">✓ Assinado em ${new Date(ct.sig_cli_at).toLocaleString('pt-BR')}</div>` : ''}
    </div>
  </div>

  ${(t1Nome || t2Nome) ? `
  <div class="witness-grid">
    <div class="witness-col">
      <div class="witness-line">${t1Nome || '________________________________________'}</div>
      <div class="witness-sub">Testemunha 1${t1Cpf ? ' · CPF: ' + t1Cpf : ''}</div>
    </div>
    <div class="witness-col">
      <div class="witness-line">${t2Nome || '________________________________________'}</div>
      <div class="witness-sub">Testemunha 2${t2Cpf ? ' · CPF: ' + t2Cpf : ''}</div>
    </div>
  </div>` : `
  <div class="witness-grid">
    <div class="witness-col">
      <div class="witness-line">________________________________________</div>
      <div class="witness-sub">Testemunha 1</div>
    </div>
    <div class="witness-col">
      <div class="witness-line">________________________________________</div>
      <div class="witness-sub">Testemunha 2</div>
    </div>
  </div>`}
</div>

<div class="footer">
  ${ct.sig_token ? `Cód. verificação: PP-${ct.sig_token.slice(0,8).toUpperCase()} · ` : ''}
  Gerado por MestrePro — Documento eletrônico com validade jurídica conforme MP nº 2.200-2/2001 e Lei nº 14.063/2020
</div>

<script>window.onload=()=>window.print();<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

async function gerarReciboDeContrato(contratoId) {
  const ct = _contratos.find(c => c.id === contratoId);
  if (!ct) return;
  // Open recibo modal pre-filled with contract data
  openReciboModal(null, ct);
}

// ──────────────────────────────────────────────────────────────
// RECIBOS
// ──────────────────────────────────────────────────────────────
let _recibos = [];

async function loadRecibos() {
  const el = document.getElementById('s-recibos');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text2)">Carregando...</div>';

  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    const { data } = await sb.from('recibos').select('*').eq('user_id', uid).order('criado_em', { ascending: false });
    _recibos = data || [];
  } else {
    try { _recibos = JSON.parse(localStorage.getItem('pp_recibos') || '[]'); } catch { _recibos = []; }
  }
  renderRecibos();
}

function renderRecibos() {
  const el = document.getElementById('s-recibos');
  if (!el) return;
  const fmtPgto = { pix:'PIX', dinheiro:'Dinheiro', transferencia:'Transferência', cartao:'Cartão' };
  const rows = _recibos.length ? _recibos.map(r => `
    <div class="list-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:13px;font-weight:700">${r.cliente||'—'}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">#${r.numero} · ${fmtPgto[r.forma_pgto]||r.forma_pgto} · ${r.parcela||'—'}</div>
          ${r.descricao?`<div style="font-size:11px;color:var(--text3);margin-top:2px">${r.descricao}</div>`:''}
        </div>
        <div style="font-size:16px;font-weight:800;color:var(--acc)">R$ ${Number(r.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="tbtn" onclick="gerarPDFRecibo('${r.id}')" style="font-size:11px;padding:4px 10px">📄 PDF</button>
        <button class="tbtn" onclick="excluirRecibo('${r.id}')" style="font-size:11px;padding:4px 10px;color:var(--text3)">🗑</button>
      </div>
    </div>`).join('') :
    '<div style="text-align:center;padding:60px 20px;color:var(--text2)"><div style="font-size:48px;margin-bottom:12px">🧾</div><div style="font-size:14px;font-weight:600">Nenhum recibo ainda</div><div style="font-size:12px;margin-top:6px">Clique em "+ Novo recibo" para registrar um pagamento.</div></div>';

  el.innerHTML = rows;
}

function openReciboModal(id, contratoPreFill) {
  const existing = id ? _recibos.find(r => r.id === id) : null;
  const ct = contratoPreFill || null;

  openModuleModal('Recibo de Pagamento', `
    <div class="mf-grid">
      <div class="mf-field">
        <label>Cliente *</label>
        <input id="mr-cliente" type="text" value="${ct?.cliente || existing?.cliente || ''}" placeholder="Nome completo do cliente">
      </div>
      <div class="mf-field">
        <label>CPF / CNPJ do cliente</label>
        <input id="mr-cli-doc" type="text" value="${existing?.cli_doc || ct?.dados?.cli_doc || ''}" placeholder="000.000.000-00">
      </div>
      <div class="mf-field">
        <label>Valor recebido (R$) *</label>
        <input id="mr-valor" type="number" step="0.01" value="${existing?.valor || ''}" placeholder="0,00">
      </div>
      <div class="mf-field">
        <label>Forma de pagamento</label>
        <select id="mr-forma">
          ${['pix','dinheiro','transferencia','cartao','cheque'].map(f=>`<option value="${f}" ${(existing?.forma_pgto||'pix')===f?'selected':''}>${{pix:'PIX',dinheiro:'Dinheiro em espécie',transferencia:'Transferência bancária',cartao:'Cartão',cheque:'Cheque'}[f]}</option>`).join('')}
        </select>
      </div>
      <div class="mf-field">
        <label>Parcela / referência</label>
        <input id="mr-parcela" type="text" value="${existing?.parcela || ''}" placeholder="Ex: Entrada, Saldo final, 1ª parcela...">
      </div>
      <div class="mf-field">
        <label>Data do recebimento</label>
        <input id="mr-data" type="date" value="${existing?.data_pgto || new Date().toISOString().split('T')[0]}">
      </div>
      <div class="mf-field c2">
        <label>Descrição dos serviços *</label>
        <textarea id="mr-desc" rows="2" placeholder="Descreva os serviços realizados (aparece no recibo)">${existing?.descricao || ct?.dados?.escopo?.split('\n')[0] || ''}</textarea>
      </div>
      <div class="mf-field c2">
        <label>Observação</label>
        <input id="mr-obs" type="text" value="${existing?.observacao || ''}" placeholder="Opcional — ex: pagamento referente à obra da Rua das Flores">
      </div>
    </div>
  `, () => salvarRecibo(existing?.id, ct?.id));
}

async function salvarRecibo(existingId, contratoId) {
  const cliente = document.getElementById('mr-cliente')?.value?.trim();
  const valor = parseFloat(document.getElementById('mr-valor')?.value) || 0;
  if (!cliente || !valor) { notif('⚠️ Preencha cliente e valor'); return; }

  const id = existingId || 'rb_' + Date.now();
  const numero = existingId ? (_recibos.find(r=>r.id===existingId)?.numero || id.slice(-6)) : String(Date.now()).slice(-6);

  const obj = {
    id, numero, cliente, valor,
    cli_doc: document.getElementById('mr-cli-doc')?.value?.trim() || '',
    forma_pgto: document.getElementById('mr-forma')?.value || 'pix',
    parcela: document.getElementById('mr-parcela')?.value?.trim() || '',
    data_pgto: document.getElementById('mr-data')?.value || new Date().toISOString().split('T')[0],
    descricao: document.getElementById('mr-desc')?.value?.trim() || '',
    observacao: document.getElementById('mr-obs')?.value?.trim() || '',
    contrato_id: contratoId || null,
    dados: { empresa: JSON.parse(localStorage.getItem('empresaSalva') || '{}') },
    criado_em: new Date().toISOString(),
  };

  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    await sb.from('recibos').upsert({ ...obj, user_id: uid, orc_id: null, data: new Date().toISOString().split('T')[0] }, { onConflict: 'id' });
  }

  // Sempre atualiza o array em memória (necessário para renderização em ambos os modos)
  if (existingId) {
    const idx = _recibos.findIndex(r => r.id === id);
    if (idx >= 0) _recibos[idx] = obj;
  } else {
    _recibos.unshift(obj);
  }
  // Persiste no localStorage apenas no modo demo
  if (!uid || uid === 'demo') {
    localStorage.setItem('pp_recibos', JSON.stringify(_recibos));
  }

  closeModuleModal();
  if (document.getElementById('s-recibos')) renderRecibos();
  notif('🧾 Recibo salvo!');
}

async function excluirRecibo(id) {
  if (!confirm('Excluir este recibo?')) return;
  _recibos = _recibos.filter(r => r.id !== id);
  const uid = USER?.id;
  if (uid && uid !== 'demo') await sb.from('recibos').delete().eq('id', id);
  else localStorage.setItem('pp_recibos', JSON.stringify(_recibos));
  renderRecibos();
}

function gerarPDFRecibo(reciboId) {
  const r = _recibos.find(x => x.id === reciboId);
  if (!r) return;
  const emp = r.dados?.empresa || JSON.parse(localStorage.getItem('empresaSalva') || '{}');
  const profSig = localStorage.getItem('pp_sig_profissional') || '';
  const dataPgto = r.data_pgto ? new Date(r.data_pgto + 'T12:00:00').toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');
  const hoje = new Date().toLocaleDateString('pt-BR');
  const fmtPgto = { pix:'PIX', dinheiro:'Dinheiro em espécie', transferencia:'Transferência bancária', cartao:'Cartão de crédito/débito', cheque:'Cheque' };
  const cliDoc = r.cli_doc || '';

  // valorExtenso agora é função global (ver topo do arquivo)
  const valorFmt = 'R$ ' + Number(r.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
  const valorExt = valorExtenso(Number(r.valor||0));
  const reciboCodigo = 'PP-RB-' + r.numero + '-' + String(r.id || '').slice(-6).toUpperCase();

  const bodyContent = `
  <!-- CABEÇALHO -->
  <div class="header">
    <div>
      <div class="logo-text">${emp.nome || 'Prestador de Serviços'}</div>
      <div class="header-sub">${[emp.doc,emp.tel,emp.email,emp.cidade].filter(Boolean).join(' · ')}</div>
      ${emp.reg ? `<div class="header-sub">Registro: ${emp.reg}</div>` : ''}
    </div>
    <div style="text-align:right">
      <div class="recibo-title">RECIBO</div>
      <div class="recibo-num">#${r.numero} · ${dataPgto}</div>
      <div class="recibo-cod">${reciboCodigo}</div>
    </div>
  </div>

  <!-- VALOR DESTAQUE -->
  <div class="value-box">
    <div class="value-label">Valor Recebido</div>
    <div class="value-main">${valorFmt}</div>
    <div class="value-ext">${valorExt}</div>
  </div>

  <!-- DADOS -->
  <div class="data-grid">
    <div>
      <div class="data-sec">Pagador (Cliente)</div>
      <div class="data-row"><span class="data-lbl">Nome</span><span class="data-val">${r.cliente||'—'}</span></div>
      ${cliDoc ? `<div class="data-row"><span class="data-lbl">CPF / CNPJ</span><span class="data-val">${cliDoc}</span></div>` : ''}
    </div>
    <div>
      <div class="data-sec">Recebedor (Prestador)</div>
      <div class="data-row"><span class="data-lbl">Nome</span><span class="data-val">${emp.nome||'—'}</span></div>
      ${emp.doc ? `<div class="data-row"><span class="data-lbl">CPF / CNPJ</span><span class="data-val">${emp.doc}</span></div>` : ''}
    </div>
  </div>

  <!-- DETALHES DO PAGAMENTO -->
  <div class="detail-sec">Detalhes do Pagamento</div>
  <div class="data-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
    <div class="data-row"><span class="data-lbl">Forma</span><span class="data-val">${fmtPgto[r.forma_pgto]||r.forma_pgto}</span></div>
    <div class="data-row"><span class="data-lbl">Data</span><span class="data-val">${dataPgto}</span></div>
    ${r.parcela ? `<div class="data-row"><span class="data-lbl">Referência</span><span class="data-val">${r.parcela}</span></div>` : '<div></div>'}
  </div>
  ${r.descricao ? `<div class="clause-box" style="margin-bottom:6px"><strong>Serviços:</strong> ${r.descricao}</div>` : ''}
  ${r.observacao ? `<div class="clause-box" style="margin-bottom:6px"><strong>Obs:</strong> ${r.observacao}</div>` : ''}

  <!-- DECLARAÇÃO FORMAL -->
  <div class="quitacao">
    Eu, <strong>${emp.nome||'_______________________'}</strong>${emp.doc ? ', CPF/CNPJ <strong>'+emp.doc+'</strong>' : ''}, declaro ter recebido de <strong>${r.cliente||'_______________________'}</strong>${cliDoc ? ', CPF/CNPJ <strong>'+cliDoc+'</strong>' : ''}, a quantia de <strong>${valorFmt} (${valorExt})</strong>, relativa a: <em>${r.descricao||'serviços prestados'}</em>. Dou plena, geral e irrevogável quitação do presente valor para todos os efeitos legais, nos termos do art. 320 do Código Civil Brasileiro (Lei nº 10.406/2002).
  </div>

  <!-- LOCAL/DATA E ASSINATURA -->
  <div class="local-data">${emp.cidade||'___________'}, ${hoje}</div>
  <div class="sig-wrap">
    <div class="sig-col">
      ${profSig ? `<img class="sig-img" src="${profSig}"><br>` : '<div style="height:48px"></div>'}
      <div class="sig-line">${emp.nome||'Prestador de Serviço'}</div>
      ${emp.doc ? `<div class="sig-sub">CPF/CNPJ: ${emp.doc}</div>` : ''}
    </div>
  </div>
  <div class="footer">${reciboCodigo} · Gerado por MestrePro · Documento com validade legal conforme CC/2002</div>
  `;

  // Gerar canhoto
  const canhotoBrief = `
  <div class="cut-line">✂&nbsp;&nbsp;&nbsp;CANHOTO DO RECIBO&nbsp;&nbsp;&nbsp;✂</div>
  <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
    <div><strong>${emp.nome||'Empresa'}</strong></div>
    <div style="text-align:right">
      <div style="font-weight:800;font-size:13px;color:#0D2E6B">RECIBO #${r.numero}</div>
      <div style="font-size:9px;color:#888">${dataPgto}</div>
    </div>
  </div>
  <div style="display:flex;gap:16px;font-size:9.5px;margin-top:4px;flex-wrap:wrap">
    <div><span style="color:#888;text-transform:uppercase;font-size:8.5px;font-weight:700">Cliente: </span>${r.cliente}</div>
    <div><span style="color:#888;text-transform:uppercase;font-size:8.5px;font-weight:700">Valor: </span><strong style="color:#0D2E6B">${valorFmt}</strong></div>
    ${r.parcela?`<div><span style="color:#888;font-size:8.5px;font-weight:700;text-transform:uppercase">Ref: </span>${r.parcela}</div>`:''}
    <div><span style="color:#888;font-size:8.5px;font-weight:700;text-transform:uppercase">Forma: </span>${fmtPgto[r.forma_pgto]||r.forma_pgto}</div>
  </div>
  <div style="font-size:8px;color:#bbb;margin-top:5px">${reciboCodigo}</div>
  `;

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo #${r.numero}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10.5px;color:#1a1a1a;padding:16mm 20mm;background:#fff;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #2563eb;padding-bottom:10px;margin-bottom:14px}
.logo-text{font-size:20px;font-weight:900;color:#2563eb}
.header-sub{font-size:9px;color:#888;margin-top:2px}
.recibo-title{font-size:22px;font-weight:900;color:#0D2E6B;letter-spacing:-0.5px}
.recibo-num{font-size:9.5px;color:#888;margin-top:2px}
.recibo-cod{font-size:8px;color:#bbb;margin-top:1px;font-family:monospace}
.value-box{background:#0D2E6B;color:#fff;border-radius:8px;padding:14px 20px;margin-bottom:14px;text-align:center}
.value-label{font-size:9px;text-transform:uppercase;letter-spacing:.8px;opacity:.7;font-weight:700}
.value-main{font-size:30px;font-weight:900;margin-top:3px;letter-spacing:-1px}
.value-ext{font-size:9.5px;opacity:.7;margin-top:3px;font-style:italic}
.data-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:12px}
.data-sec{font-size:8.5px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #eee}
.detail-sec{font-size:8.5px;font-weight:800;color:#0D2E6B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;padding-bottom:3px;border-bottom:1px solid #eee}
.data-row{margin-bottom:4px}
.data-lbl{font-size:8px;color:#888;text-transform:uppercase;font-weight:700;margin-right:4px}
.data-val{font-size:10.5px;font-weight:500}
.clause-box{background:#f8f9fb;border-left:3px solid #2563eb;padding:7px 11px;margin-bottom:6px;border-radius:0 4px 4px 0;font-size:9.5px}
.quitacao{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;padding:10px 14px;font-size:10px;line-height:1.65;margin:12px 0;color:#14532d}
.local-data{text-align:center;font-size:10px;color:#555;margin:10px 0 6px}
.sig-wrap{display:flex;justify-content:center;margin-bottom:6px}
.sig-col{text-align:center}
.sig-img{max-height:48px;margin-bottom:3px}
.sig-line{border-top:1px solid #333;padding-top:4px;font-size:9px;color:#444;min-width:180px;margin:0 auto;display:block}
.sig-sub{font-size:8px;color:#888;margin-top:1px;text-align:center}
.footer{font-size:8px;color:#bbb;text-align:center;margin-top:8px;font-family:monospace}
.cut-line{border-top:2px dashed #ccc;margin:18px 0 10px;text-align:center;font-size:9px;color:#bbb;padding-top:5px;letter-spacing:1px}
@media print{body{padding:12mm 14mm}@page{margin:0}}
</style></head><body>
${bodyContent}
${canhotoBrief}
<script>window.onload=()=>window.print();<\/script>
</body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// ──────────────────────────────────────────────────────────────
// AGENDA / CALENDÁRIO
// ──────────────────────────────────────────────────────────────
let _eventos = [];
let _agendaMes = new Date();
const _TIPO_COR = { servico:'#5b7fff', visita:'#3b82f6', reuniao:'#8b5cf6', prazo:'#ef4444', outro:'#6b7280' };
const _TIPO_IC  = { servico:'🔨', visita:'🔍', reuniao:'💬', prazo:'⏰', outro:'📌' };

async function loadAgenda() {
  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    const { data } = await sb.from('agenda').select('*').eq('user_id', uid).order('data_inicio');
    _eventos = (data || []).map(e => ({...e, inicio: e.data_inicio, fim: e.data_fim}));
  } else {
    try { _eventos = JSON.parse(localStorage.getItem('pp_agenda') || '[]'); } catch { _eventos = []; }
  }
  renderAgenda();
}

function renderAgenda() {
  const el = document.getElementById('s-agenda');
  if (!el) return;

  const hoje = new Date();
  const ano = _agendaMes.getFullYear();
  const mes = _agendaMes.getMonth();
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Build calendar grid
  let cells = '';
  for (let i = 0; i < primeiroDia; i++) cells += '<div class="ag-cell ag-empty"></div>';
  for (let d = 1; d <= diasNoMes; d++) {
    const dStr = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs = _eventos.filter(e => {
      if (!e.data_inicio && !e.inicio) return false;
      const ini = new Date(e.data_inicio || e.inicio);
      const fim = e.data_fim || e.fim ? new Date(e.data_fim || e.fim) : ini;
      const dDate = new Date(dStr + 'T12:00:00');
      return dDate >= new Date(ini.toDateString()) && dDate <= new Date(fim.toDateString());
    });
    const isHoje = hoje.getFullYear()===ano && hoje.getMonth()===mes && hoje.getDate()===d;
    const dots = evs.slice(0,3).map(e => `<div class="ag-dot" style="background:${_TIPO_COR[e.tipo]||'#5b7fff'}"></div>`).join('');
    cells += `<div class="ag-cell ${isHoje?'ag-hoje':''}" onclick="openEventoModal('${dStr}')">
      <div class="ag-day">${d}</div>
      <div class="ag-dots">${dots}${evs.length>3?`<div class="ag-dot-more">+${evs.length-3}</div>`:''}</div>
    </div>`;
  }

  // Upcoming events list
  const nowTs = Date.now();
  const upcoming = _eventos
    .filter(e => {
      const d = new Date(e.data_inicio || e.inicio || 0);
      return d >= new Date(hoje.toDateString());
    })
    .sort((a,b) => new Date(a.data_inicio||a.inicio) - new Date(b.data_inicio||b.inicio))
    .slice(0, 8);

  const upcomingHtml = upcoming.length ? upcoming.map(e => {
    const d = new Date(e.data_inicio || e.inicio);
    const dStr = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', weekday:'short' });
    const h = e.hora_inicio ? e.hora_inicio.slice(0,5) : '';
    return `<div class="ag-ev-item" onclick="editEvento('${e.id}')">
      <div class="ag-ev-stripe" style="background:${_TIPO_COR[e.tipo]||'#5b7fff'}"></div>
      <div class="ag-ev-body">
        <div class="ag-ev-titulo">${_TIPO_IC[e.tipo]||'📌'} ${e.titulo}</div>
        <div class="ag-ev-meta">${dStr}${h?' às '+h:''} ${e.cliente?'· '+e.cliente:''}</div>
      </div>
      <button class="ag-ev-del" onclick="event.stopPropagation();excluirEvento('${e.id}')">✕</button>
    </div>`;
  }).join('') : '<div style="text-align:center;padding:20px;font-size:12px;color:var(--text3)">Nenhum evento próximo</div>';

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 280px;gap:14px;align-items:start">
      <div class="card" style="padding:0;overflow:hidden">
        <div class="ag-header">
          <button class="ag-nav" onclick="_agendaMes=new Date(_agendaMes.getFullYear(),_agendaMes.getMonth()-1,1);renderAgenda()">‹</button>
          <div class="ag-month">${meses[mes]} ${ano}</div>
          <button class="ag-nav" onclick="_agendaMes=new Date(_agendaMes.getFullYear(),_agendaMes.getMonth()+1,1);renderAgenda()">›</button>
        </div>
        <div class="ag-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
        <div class="ag-grid">${cells}</div>
      </div>
      <div>
        <div class="card" style="margin-bottom:10px">
          <div class="ch"><div class="ct">Próximos eventos</div></div>
          <div class="ag-ev-list">${upcomingHtml}</div>
        </div>
        <div class="card">
          <div class="ch"><div class="ct">Legenda</div></div>
          ${Object.entries(_TIPO_COR).map(([k,v])=>`<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px"><div style="width:10px;height:10px;border-radius:50%;background:${v};flex-shrink:0"></div><div style="font-size:12px">${_TIPO_IC[k]} ${k.charAt(0).toUpperCase()+k.slice(1)}</div></div>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function openEventoModal(dataPre, eventoId) {
  const existing = eventoId ? _eventos.find(e => e.id === eventoId) : null;
  const hoje = dataPre || new Date().toISOString().split('T')[0];

  openModuleModal('Agendar Evento', `
    <div class="mf-grid">
      <div class="mf-field c2">
        <label>Título *</label>
        <input id="me-titulo" type="text" value="${existing?.titulo||''}" placeholder="Ex: Pintura apartamento João">
      </div>
      <div class="mf-field">
        <label>Tipo</label>
        <select id="me-tipo">
          ${Object.keys(_TIPO_COR).map(t=>`<option value="${t}" ${(existing?.tipo||'servico')===t?'selected':''}>${_TIPO_IC[t]} ${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="mf-field">
        <label>Cliente</label>
        <input id="me-cliente" type="text" value="${existing?.cliente||''}" placeholder="Nome do cliente">
      </div>
      <div class="mf-field">
        <label>Endereço</label>
        <input id="me-endereco" type="text" value="${existing?.endereco||''}" placeholder="Local do serviço">
      </div>
      <div class="mf-field">
        <label>Status</label>
        <select id="me-status">
          ${['agendado','em_andamento','concluido','cancelado'].map(s=>`<option value="${s}" ${(existing?.status||'agendado')===s?'selected':''}>${{agendado:'Agendado',em_andamento:'Em andamento',concluido:'Concluído',cancelado:'Cancelado'}[s]}</option>`).join('')}
        </select>
      </div>
      <div class="mf-field">
        <label>Data início *</label>
        <input id="me-inicio" type="date" value="${existing?.data_inicio?.split('T')[0] || existing?.inicio?.split('T')[0] || hoje}">
      </div>
      <div class="mf-field">
        <label>Data fim</label>
        <input id="me-fim" type="date" value="${existing?.data_fim?.split('T')[0] || existing?.fim?.split('T')[0] || ''}">
      </div>
      <div class="mf-field">
        <label>Hora início</label>
        <input id="me-hinicio" type="time" value="${existing?.hora_inicio||'08:00'}">
      </div>
      <div class="mf-field">
        <label>Hora fim</label>
        <input id="me-hfim" type="time" value="${existing?.hora_fim||'18:00'}">
      </div>
      <div class="mf-field c2">
        <label>Notas</label>
        <textarea id="me-notas" rows="2" placeholder="Observações do serviço...">${existing?.obs||existing?.notas||''}</textarea>
      </div>
    </div>
  `, () => salvarEvento(existing?.id));
}

function editEvento(id) { openEventoModal(null, id); }

async function salvarEvento(existingId) {
  const titulo = document.getElementById('me-titulo')?.value?.trim();
  const inicio = document.getElementById('me-inicio')?.value;
  if (!titulo || !inicio) { notif('⚠️ Preencha título e data de início'); return; }

  const id = existingId || 'ev_' + Date.now();
  const obj = {
    id, titulo,
    cliente: document.getElementById('me-cliente')?.value?.trim() || '',
    endereco: document.getElementById('me-endereco')?.value?.trim() || '',
    tipo: document.getElementById('me-tipo')?.value || 'servico',
    status: document.getElementById('me-status')?.value || 'agendado',
    data_inicio: inicio,
    data_fim: document.getElementById('me-fim')?.value || inicio,
    hora_inicio: document.getElementById('me-hinicio')?.value || '',
    hora_fim: document.getElementById('me-hfim')?.value || '',
    obs: document.getElementById('me-notas')?.value?.trim() || '',
    cor: _TIPO_COR[document.getElementById('me-tipo')?.value || 'servico'],
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };

  const uid = USER?.id;
  if (uid && uid !== 'demo') {
    await sb.from('agenda').upsert({ ...obj, user_id: uid }, { onConflict: 'id' });
  }

  // Sempre atualiza o array em memória (necessário para renderização em ambos os modos)
  if (existingId) {
    const idx = _eventos.findIndex(e => e.id === id);
    if (idx >= 0) _eventos[idx] = obj;
  } else {
    _eventos.push(obj);
  }
  // Persiste no localStorage apenas no modo demo
  if (!uid || uid === 'demo') {
    localStorage.setItem('pp_agenda', JSON.stringify(_eventos));
  }

  closeModuleModal();
  renderAgenda();
  notif('📅 Evento salvo!');
}

async function excluirEvento(id) {
  if (!confirm('Excluir este evento?')) return;
  _eventos = _eventos.filter(e => e.id !== id);
  const uid = USER?.id;
  if (uid && uid !== 'demo') await sb.from('agenda').delete().eq('id', id);
  else localStorage.setItem('pp_agenda', JSON.stringify(_eventos));
  renderAgenda();
}

// ──────────────────────────────────────────────────────────────
// MODAL COMPARTILHADO (módulos)
// ──────────────────────────────────────────────────────────────
function openModuleModal(title, bodyHtml, onSave) {
  let modal = document.getElementById('pp-module-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pp-module-modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="mm-overlay" onclick="closeModuleModal()"></div>
    <div class="mm-box">
      <div class="mm-header">
        <div class="mm-title">${title}</div>
        <button class="mm-close" onclick="closeModuleModal()">✕</button>
      </div>
      <div class="mm-body">${bodyHtml}</div>
      <div class="mm-footer">
        <button class="tbtn" onclick="closeModuleModal()">Cancelar</button>
        <button class="tbtn tbtn-a" id="mm-save-btn">💾 Salvar</button>
      </div>
    </div>`;
  modal.style.cssText = 'display:flex;position:fixed;inset:0;z-index:7000;align-items:center;justify-content:center;';
  document.getElementById('mm-save-btn').onclick = onSave;
}
function closeModuleModal() {
  const m = document.getElementById('pp-module-modal'); if (m) m.style.display = 'none';
}
