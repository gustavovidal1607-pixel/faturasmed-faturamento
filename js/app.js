const API = '/api';

const TEMPO_LIMITE_MS = 15000;

async function api(path, opts = {}){
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);
  let res;
  try{
    res = await fetch(API + path, { ...opts, headers, signal: controlador.signal });
  }catch(err){
    if (err.name === 'AbortError') throw new Error('A resposta demorou demais. Verifique sua conexão e tente de novo.');
    throw new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente de novo.');
  }finally{
    clearTimeout(limite);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401){
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    location.reload();
    throw new Error('Sessão expirada.');
  }
  if (!res.ok) throw new Error(data.erro || 'Erro na requisição.');
  return data;
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function formatarData(iso){
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function formatarDataHora(iso){
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function formatarHora(iso){
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}
// O sistema todo (prazos, competências, "hoje") se baseia sempre na data
// real de Brasília -- nunca no relógio/fuso local do navegador de quem
// está usando.
function competenciaAtualBrasil(){
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(partes.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}`;
}
const MESES_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// Máscara de moeda: digita só números, a vírgula dos centavos entra
// sozinha (ex: "150" -> "1,50", "15000" -> "150,00").
function aplicarMascaraMoeda(input){
  input.addEventListener('input', () => {
    let digitos = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!digitos){ input.value = ''; return; }
    while (digitos.length < 3) digitos = '0' + digitos;
    const inteiro = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = `${inteiro},${digitos.slice(-2)}`;
  });
}
function mascaraMoedaParaNumero(texto){
  if (!texto) return null;
  const numero = Number(texto.replace(/\./g, '').replace(',', '.'));
  return isNaN(numero) ? null : numero;
}
function numeroParaMascaraMoeda(numero){
  return numero == null ? '' : Number(numero).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatarCompetencia(comp){
  if (!comp) return '—';
  const [ano, mes] = String(comp).split('-');
  const nome = MESES_PT[Number(mes) - 1];
  return nome ? `${nome} de ${ano}` : comp;
}
const ROTULOS_STATUS = { pendente: 'Pendente', enviado_falta_anexo: 'Enviado - falta anexo', faturado: 'Faturado' };
function rotuloStatus(status){ return ROTULOS_STATUS[status] || status; }
function usuarioAtual(){
  return JSON.parse(localStorage.getItem('usuario'));
}

// ---------------- Login ----------------

document.getElementById('btn-login').addEventListener('click', fazerLogin);
document.getElementById('login-senha').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
document.getElementById('login-usuario').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });

async function fazerLogin(){
  const login = document.getElementById('login-usuario').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('erro-login');
  erroEl.textContent = '';
  if (!login || !senha){ erroEl.textContent = 'Informe usuário e senha.'; return; }
  try{
    const data = await api('/auth', { method: 'POST', body: JSON.stringify({ login, senha }) });
    localStorage.setItem('token', data.token);
    localStorage.setItem('usuario', JSON.stringify(data.usuario));
    iniciarApp(data.usuario);
  }catch(err){ erroEl.textContent = err.message; }
}

document.getElementById('btn-sair').addEventListener('click', async () => {
  try{ await api('/auth', { method: 'DELETE' }); }catch{}
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  location.reload();
});

// ---------------- Navegação ----------------

const ABAS = {
  painel: { label: 'Controle de faturamento', render: renderPainel },
  tarefas: { label: 'Tarefas', render: renderTarefas },
  cadastros: { label: 'Cadastros', render: renderCadastros, admin: true },
  atividades: { label: 'Atividades da equipe', render: renderAtividades, admin: true },
  usuarios: { label: 'Usuários', render: renderUsuarios, admin: true },
};

function montarNav(usuario){
  const nav = document.getElementById('nav-abas');
  nav.innerHTML = '';
  for (const [id, cfg] of Object.entries(ABAS)){
    if (cfg.admin && usuario.cargo !== 'administrador') continue;
    const btn = document.createElement('button');
    btn.textContent = cfg.label;
    btn.dataset.aba = id;
    btn.addEventListener('click', () => abrirAba(id));
    nav.appendChild(btn);
  }
}

function abrirAba(id){
  document.querySelectorAll('#nav-abas button').forEach(btn => btn.classList.toggle('ativa', btn.dataset.aba === id));
  ABAS[id].render();
  // A aba "painel" já busca /dashboard sozinha (buscarPainel) e usa a
  // mesma resposta pra preencher a barra -- evita pedir os mesmos dados
  // duas vezes de uma vez só.
  if (id !== 'painel') carregarBarraLembretes();
}

function preencherBarraLembretes(data){
  const barra = document.getElementById('barra-lembretes');
  if (!barra) return;
  let html = '<h3>Prazos chegando</h3>';
  if (!data.prazos_proximos.length){
    html += '<div class="vazio">Nenhum prazo próximo.</div>';
  }else{
    for (const c of data.prazos_proximos){
      html += `<div class="item-lembrete"><div class="titulo">${escapeHtml(c.nome)}</div><div class="detalhe">${c.dias_restantes === 0 ? 'fecha hoje' : 'fecha em ' + c.dias_restantes + ' dia(s)'}</div></div>`;
    }
  }
  html += '<h3>Mais pendências</h3>';
  if (!data.ranking_pendencias.length){
    html += '<div class="vazio">Nada pendente.</div>';
  }else{
    for (const r of data.ranking_pendencias){
      html += `<div class="item-lembrete"><div class="titulo">${escapeHtml(r.prestador_nome)}</div><div class="detalhe">${r.total} pendência(s)</div></div>`;
    }
  }
  barra.innerHTML = html;
}

async function carregarBarraLembretes(){
  const barra = document.getElementById('barra-lembretes');
  if (!barra) return;
  try{
    preencherBarraLembretes(await api('/dashboard'));
  }catch(err){
    barra.innerHTML = '';
  }
}

function iniciarApp(usuario){
  document.getElementById('tela-login').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('usuario-nome').textContent = usuario.nome;
  document.getElementById('usuario-papel').textContent = usuario.cargo;
  montarNav(usuario);
  abrirAba('painel');
}

(function(){
  const token = localStorage.getItem('token');
  const usuarioSalvo = localStorage.getItem('usuario');
  if (token && usuarioSalvo) iniciarApp(JSON.parse(usuarioSalvo));
})();

// ---------------- Painel (admin) ----------------

const PAINEL_ABAS = [
  { id: 'pendente', label: 'Pendentes' },
  { id: 'enviado_falta_anexo', label: 'Pendente anexo' },
  { id: 'faturado', label: 'Faturados' },
];
// No Controle de faturamento a sub-aba "pendente" virou a visão geral
// (mostra tudo, não só pendências) -- rótulo diferente só ali; em
// Atividades da equipe o rótulo "Pendente" continua fazendo sentido.
const CONTROLE_ABAS = PAINEL_ABAS.map(aba => aba.id === 'pendente' ? { ...aba, label: 'Geral' } : aba);
const ORDEM_TIPO = ['SADT', 'CONSULTA', 'GIH'];

let painelDados = null;
let painelSubaba = 'pendente';
let painelConvenios = [];
let painelPrestadores = [];
let painelFiltro = { competencia: '', convenio_id: '', prestador_id: '', data_de: '', data_ate: '' };

async function renderPainel(){
  const cont = document.getElementById('conteudo');
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  painelFiltro = { competencia: competenciaAtualBrasil(), convenio_id: '', prestador_id: '', data_de: '', data_ate: '' };
  painelSubaba = 'pendente';
  try{
    await buscarPainel();
  }catch(err){ cont.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

async function buscarDadosPainel(){
  const params = new URLSearchParams({ competencia: painelFiltro.competencia });
  if (painelFiltro.convenio_id) params.set('convenio_id', painelFiltro.convenio_id);
  if (painelFiltro.prestador_id) params.set('prestador_id', painelFiltro.prestador_id);
  // Uma chamada só (convênios e prestadores vêm junto), em vez de três
  // requisições separadas competindo por conexões frias na abertura da tela.
  painelDados = await api('/dashboard?' + params.toString());
  painelConvenios = painelDados.convenios;
  painelPrestadores = painelDados.prestadores;
  preencherBarraLembretes(painelDados);
}

async function buscarPainel(){
  await buscarDadosPainel();
  montarPainel();
}

function montarPainel(){
  const cont = document.getElementById('conteudo');
  const data = painelDados;
  let html = `<h1>Controle de faturamento</h1><p class="subtitulo">Competência ${formatarCompetencia(data.competencia)}</p>`;
  const contagens = { pendente: 0, enviado_falta_anexo: 0, faturado: 0 };
  for (const l of data.faturamentos) contagens[l.status] = (contagens[l.status] || 0) + 1;

  html += `
    <div class="cartao">
      <div class="linha-filtro-kpi">
        <div class="filtros">
          <div class="campo"><label>Competência</label><input type="month" id="pn-competencia" value="${painelFiltro.competencia}"></div>
          <div class="campo"><label>Convênio</label><select id="pn-convenio"><option value="">Todos</option>${painelConvenios.map(c => `<option value="${c.id}" ${String(c.id) === String(painelFiltro.convenio_id) ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Prestador</label><select id="pn-prestador"><option value="">Todos</option>${painelPrestadores.map(p => `<option value="${p.id}" ${String(p.id) === String(painelFiltro.prestador_id) ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Protocolos de</label><input type="date" id="pn-data-de" value="${painelFiltro.data_de || ''}"></div>
          <div class="campo"><label>até</label><input type="date" id="pn-data-ate" value="${painelFiltro.data_ate || ''}"></div>
          <button class="btn" id="pn-filtrar">Filtrar</button>
          <button class="btn secundario" id="pn-limpar">Limpar filtros</button>
        </div>
        <div class="grade-kpi compacta" id="painel-kpis">
          ${CONTROLE_ABAS.map(aba => `<div class="kpi compacto cor-${aba.id} ${painelSubaba === aba.id ? 'ativa' : ''}" data-sub="${aba.id}">
            <div class="rotulo">${aba.label}</div>
            <div class="numero">${contagens[aba.id] || 0}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
  `;
  if (data.prazos_proximos.length){
    html += '<div class="cartao"><h2>Prazos de fechamento chegando</h2>';
    for (const c of data.prazos_proximos){
      html += `<div class="alerta prazo">${escapeHtml(c.nome)} fecha dia ${c.prazo_dia} — ${c.dias_restantes === 0 ? 'hoje' : c.dias_restantes + ' dia(s)'}</div>`;
    }
    html += '</div>';
  }

  html += '<div id="painel-subconteudo"></div>';
  cont.innerHTML = html;

  document.getElementById('pn-filtrar').addEventListener('click', () => {
    painelFiltro = {
      competencia: document.getElementById('pn-competencia').value || painelFiltro.competencia,
      convenio_id: document.getElementById('pn-convenio').value,
      prestador_id: document.getElementById('pn-prestador').value,
      data_de: document.getElementById('pn-data-de').value || '',
      data_ate: document.getElementById('pn-data-ate').value || '',
    };
    painelSubaba = 'pendente';
    buscarPainel();
  });

  document.getElementById('pn-limpar').addEventListener('click', () => {
    painelFiltro = { competencia: competenciaAtualBrasil(), convenio_id: '', prestador_id: '', data_de: '', data_ate: '' };
    painelSubaba = 'pendente';
    buscarPainel();
  });

  document.querySelectorAll('#painel-kpis .kpi').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => { painelSubaba = card.dataset.sub; montarPainel(); });
  });

  renderPainelLinhas();
}

let painelLinhasCache = [];

function renderPainelLinhas(){
  const alvo = document.getElementById('painel-subconteudo');
  // "pendente" e a visao principal (mostra tudo, cada card com seu
  // proprio status) -- so "enviado_falta_anexo" e "faturado" filtram de
  // verdade, isolando quem esta em cada uma dessas etapas.
  const linhas = painelSubaba === 'pendente'
    ? painelDados.faturamentos
    : painelDados.faturamentos.filter(l => l.status === painelSubaba);
  painelLinhasCache = linhas;
  if (!linhas.length){ alvo.innerHTML = '<div class="cartao"><div class="vazio">Nada aqui nessa competência.</div></div>'; return; }

  // Hierarquia: Convênio (card) -> Prestador (grupo expansível) -> Tipo (card clicável).
  const porConvenio = new Map();
  linhas.forEach((l, idx) => {
    if (!porConvenio.has(l.convenio_id)) porConvenio.set(l.convenio_id, { nome: l.convenio_nome, prestadores: new Map() });
    const conv = porConvenio.get(l.convenio_id);
    if (!conv.prestadores.has(l.prestador_id)) conv.prestadores.set(l.prestador_id, { nome: l.prestador_nome, idxs: [] });
    conv.prestadores.get(l.prestador_id).idxs.push(idx);
  });
  const conveniosOrdenados = [...porConvenio.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome));

  let html = '';
  for (const [convenioId, conv] of conveniosOrdenados){
    const totalConvenio = [...conv.prestadores.values()].reduce((s, p) => s + p.idxs.length, 0);
    html += `<details class="cartao expansivel">
      <summary>
        <span class="nome-prestador">${escapeHtml(conv.nome)}</span>
        <span class="resumo">${totalConvenio} lançamento(s) · ${conv.prestadores.size} prestador(es)</span>
      </summary>
      <div class="conteudo-cartao">`;
    const prestadoresOrdenados = [...conv.prestadores.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome));
    for (const [prestadorId, grupo] of prestadoresOrdenados){
      const protocolosMes = (painelDados.protocolos_faturados_mes || {})[prestadorId] || 0;
      html += `<details class="grupo-prestador">
        <summary>
          <span class="nome-prestador">${escapeHtml(grupo.nome)}</span>
          <span class="resumo">${grupo.idxs.length} tipo(s) · ${protocolosMes} protocolo(s) faturado(s) em ${formatarCompetencia(painelDados.competencia_atual)}</span>
        </summary>
        <div class="conteudo-grupo">
          <div class="grade-tipos">`;
      for (const idx of grupo.idxs){
        const l = linhas[idx];
        html += `<details class="cartao expansivel tipo-clicavel" id="tipo-card-${idx}" data-idx="${idx}">
          <summary>
            <span class="nome-prestador">${l.tipo}</span>
            <span class="selo ${l.status}">${rotuloStatus(l.status)}</span>
            <span class="resumo">${l.protocolos_faturados || 0} protocolo(s) faturado(s)${l.protocolos_quantidade ? ` de ${l.protocolos_quantidade} lançado(s)` : ''}${l.protocolos_total != null ? ' · R$ ' + numeroParaMascaraMoeda(l.protocolos_total) : ''}</span>
          </summary>
          <div class="conteudo-cartao" id="tipo-conteudo-${idx}"><div class="vazio">Carregando...</div></div>
        </details>`;
      }
      html += '</div></div></details>';
    }
    html += '</div></details>';
  }
  alvo.innerHTML = html;

  alvo.querySelectorAll('.tipo-clicavel').forEach(det => {
    let carregado = false;
    det.addEventListener('toggle', () => {
      if (det.open && !carregado){
        carregado = true;
        renderConteudoTipo(Number(det.dataset.idx));
      }
    });
  });
}

async function renderConteudoTipo(idx, filtro){
  const linha = painelLinhasCache[idx];
  const alvo = document.getElementById(`tipo-conteudo-${idx}`);
  if (!linha || !alvo) return;
  // Sem filtro explícito (primeira vez que abre), usa o período global
  // do filtro principal -- assim não precisa configurar De/Até um a um
  // em cada prestador.
  filtro = filtro || { de: painelFiltro.data_de || null, ate: painelFiltro.data_ate || null };
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  try{
    const params = new URLSearchParams({ convenio_id: linha.convenio_id, prestador_id: linha.prestador_id, tipo: linha.tipo });
    if (filtro.de) params.set('data_de', filtro.de);
    if (filtro.ate) params.set('data_ate', filtro.ate);
    const { protocolos } = await api('/protocolos?' + params.toString());
    const total = protocolos.reduce((soma, p) => soma + (p.valor != null ? Number(p.valor) : 0), 0);

    let html = `
      <p class="subtitulo" style="margin:0 0 10px;">Histórico completo desse prestador+tipo, em qualquer competência.</p>
      <div class="linha-form">
        <div class="campo"><label>De</label><input type="date" id="pf-de-${idx}" value="${filtro.de || ''}"></div>
        <div class="campo"><label>Até</label><input type="date" id="pf-ate-${idx}" value="${filtro.ate || ''}"></div>
        <button class="btn secundario pequeno" id="pf-filtrar-${idx}">Filtrar</button>
      </div>
    `;
    if (protocolos.length){
      html += '<table><thead><tr><th>Protocolo</th><th>Competência</th><th>Data</th><th>Guias</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>';
      for (const p of protocolos){
        html += `<tr>
          <td>${escapeHtml(p.protocolo)}${p.observacao ? `<div class="particularidade-txt">${escapeHtml(p.observacao)}</div>` : ''}</td>
          <td>${formatarCompetencia(p.competencia)}</td>
          <td>${p.data ? formatarData(p.data) : '—'}</td>
          <td>${p.quantidade_guias ?? '—'}</td>
          <td>${p.valor != null ? 'R$ ' + numeroParaMascaraMoeda(p.valor) : '—'}</td>
          <td><select data-status-protocolo="${p.id}">${Object.entries(ROTULOS_STATUS).map(([v, l]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><button class="btn perigo pequeno" data-remover-protocolo="${p.id}">Remover</button></td>
        </tr>`;
      }
      html += `</tbody></table><p class="subtitulo" style="margin:10px 0 0;">Total no filtro: <strong>R$ ${numeroParaMascaraMoeda(total)}</strong></p>`;
    }else{
      html += '<div class="vazio">Nenhum protocolo encontrado.</div>';
    }

    html += `
      <div class="linha-form" style="margin-top:16px;">
        <div class="campo"><label>Protocolo</label><input type="text" id="np-protocolo-${idx}"></div>
        <div class="campo"><label>Data</label><input type="date" id="np-data-${idx}"></div>
        <div class="campo"><label>Qtd. guias</label><input type="number" min="1" id="np-guias-${idx}" style="width:80px;"></div>
        <div class="campo"><label>Valor (R$)</label><input type="text" inputmode="numeric" id="np-valor-${idx}"></div>
        <div class="campo"><label>Status</label>
          <select id="np-status-${idx}">${Object.entries(ROTULOS_STATUS).map(([v, l]) => `<option value="${v}" ${v === 'enviado_falta_anexo' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
      </div>
      <div class="campo" id="np-obs-wrap-${idx}" hidden style="margin-bottom:10px;max-width:400px;">
        <label>Observação desse protocolo</label>
        <textarea id="np-observacao-${idx}" rows="2" style="width:100%;"></textarea>
      </div>
      <button class="btn secundario pequeno" id="np-toggle-obs-${idx}">Adicionar observação</button>
      <button class="btn secundario" id="np-adicionar-${idx}">Adicionar protocolo</button>
      <div class="erro-login" id="np-erro-${idx}"></div>
    `;

    alvo.innerHTML = html;

    document.getElementById(`pf-filtrar-${idx}`).addEventListener('click', () => {
      renderConteudoTipo(idx, {
        de: document.getElementById(`pf-de-${idx}`).value || null,
        ate: document.getElementById(`pf-ate-${idx}`).value || null,
      });
    });

    document.getElementById(`np-toggle-obs-${idx}`).addEventListener('click', () => {
      document.getElementById(`np-obs-wrap-${idx}`).hidden = false;
      document.getElementById(`np-toggle-obs-${idx}`).hidden = true;
    });

    alvo.querySelectorAll('[data-status-protocolo]').forEach(sel => sel.addEventListener('change', async () => {
      try{
        await api(`/protocolos?id=${sel.dataset.statusProtocolo}`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) });
        await renderConteudoTipo(idx, filtro);
        await atualizarContextoAposMudanca(idx);
      }catch(err){ alert(err.message); }
    }));
    alvo.querySelectorAll('[data-remover-protocolo]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Remover esse protocolo?')) return;
      await api(`/protocolos?id=${btn.dataset.removerProtocolo}`, { method: 'DELETE' });
      await renderConteudoTipo(idx, filtro);
      await atualizarContextoAposMudanca(idx);
    }));
    document.getElementById(`np-adicionar-${idx}`).addEventListener('click', async () => {
      const erroEl = document.getElementById(`np-erro-${idx}`);
      erroEl.textContent = '';
      const protocolo = document.getElementById(`np-protocolo-${idx}`).value.trim();
      if (!protocolo){ erroEl.textContent = 'Informe o protocolo.'; return; }
      try{
        const resposta = await api('/protocolos', { method: 'POST', body: JSON.stringify({
          faturamento_id: linha.faturamento_id,
          convenio_id: linha.convenio_id,
          prestador_id: linha.prestador_id,
          tipo: linha.tipo,
          competencia: linha.competencia,
          protocolo,
          data: document.getElementById(`np-data-${idx}`).value || null,
          quantidade_guias: document.getElementById(`np-guias-${idx}`).value ? Number(document.getElementById(`np-guias-${idx}`).value) : null,
          valor: mascaraMoedaParaNumero(document.getElementById(`np-valor-${idx}`).value),
          status: document.getElementById(`np-status-${idx}`).value,
          observacao: document.getElementById(`np-observacao-${idx}`).value.trim() || null,
        }) });
        linha.faturamento_id = resposta.faturamento_id;
        await renderConteudoTipo(idx, filtro);
        await atualizarContextoAposMudanca(idx);
      }catch(err){ erroEl.textContent = err.message; }
    });
    aplicarMascaraMoeda(document.getElementById(`np-valor-${idx}`));
  }catch(err){ alvo.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

async function atualizarContextoAposMudanca(idx){
  const linha = painelLinhasCache[idx];
  await buscarDadosPainel();
  const atualizada = painelDados.faturamentos.find(f =>
    f.convenio_id === linha.convenio_id && f.prestador_id === linha.prestador_id && f.tipo === linha.tipo
  );
  if (!atualizada) return;

  // Se a linha não pertence mais à sub-aba filtrada (ex: acabou de virar
  // "faturado" enquanto via "Pendente anexo"), refaz a árvore inteira --
  // senão, só atualiza o cabeçalho desse card, sem fechar os accordions
  // abertos.
  if (painelSubaba !== 'pendente' && atualizada.status !== painelSubaba){
    renderPainelLinhas();
    return;
  }

  Object.assign(linha, atualizada);
  const card = document.getElementById(`tipo-card-${idx}`);
  if (card){
    const selo = card.querySelector('summary .selo');
    if (selo){ selo.className = `selo ${linha.status}`; selo.textContent = rotuloStatus(linha.status); }
    const resumo = card.querySelector('summary .resumo');
    if (resumo){
      resumo.textContent = `${linha.protocolos_faturados || 0} protocolo(s) faturado(s)${linha.protocolos_quantidade ? ` de ${linha.protocolos_quantidade} lançado(s)` : ''}${linha.protocolos_total != null ? ' · R$ ' + numeroParaMascaraMoeda(linha.protocolos_total) : ''}`;
    }
  }
  const contagens = { pendente: 0, enviado_falta_anexo: 0, faturado: 0 };
  for (const l of painelDados.faturamentos) contagens[l.status] = (contagens[l.status] || 0) + 1;
  for (const aba of PAINEL_ABAS){
    const numeroEl = document.querySelector(`#painel-kpis .kpi.cor-${aba.id} .numero`);
    if (numeroEl) numeroEl.textContent = contagens[aba.id] || 0;
  }
}

// ---------------- Tarefas ----------------

async function renderTarefas(){
  const cont = document.getElementById('conteudo');
  const usuario = usuarioAtual();
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  let usuarios = [];
  if (usuario.cargo === 'administrador') usuarios = await api('/usuarios').then(d => d.usuarios).catch(() => []);

  let html = '<h1>Tarefas</h1><p class="subtitulo">Designadas pelo administrador, com confirmação de recebimento e finalização.</p>';
  html += '<div class="grade-kpi" id="tarefas-kpis"></div>';
  if (usuario.cargo === 'administrador'){
    html += `
      <div class="cartao">
        <h2>Nova tarefa</h2>
        <div class="linha-form">
          <div class="campo"><label>Responsável</label><select id="t-responsavel">${usuarios.filter(u => u.ativo).map(u => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Prazo</label><input type="date" id="t-prazo"></div>
          <div class="campo" style="flex:1;"><label>Descrição</label><textarea id="t-descricao" rows="1" style="width:100%;"></textarea></div>
        </div>
        <button class="btn" id="t-criar">Criar tarefa</button>
        <div class="erro-login" id="t-erro"></div>
      </div>
    `;
  }
  html += '<div class="cartao" id="lista-tarefas"><div class="vazio">Carregando...</div></div>';
  cont.innerHTML = html;

  if (usuario.cargo === 'administrador'){
    document.getElementById('t-criar').addEventListener('click', async () => {
      const descricao = document.getElementById('t-descricao').value.trim();
      const prazo = document.getElementById('t-prazo').value || null;
      const responsavel_usuario_id = Number(document.getElementById('t-responsavel').value);
      const erroEl = document.getElementById('t-erro');
      erroEl.textContent = '';
      if (!descricao){ erroEl.textContent = 'Descreva a tarefa.'; return; }
      try{
        await api('/tarefas', { method: 'POST', body: JSON.stringify({ descricao, prazo, responsavel_usuario_id }) });
        document.getElementById('t-descricao').value = '';
        await carregarTarefas();
      }catch(err){ erroEl.textContent = err.message; }
    });
  }

  await carregarTarefas();
}

const TAREFAS_ABAS = [
  { id: 'aguardando', label: 'Aguardando' },
  { id: 'recebida', label: 'Recebida' },
  { id: 'finalizada', label: 'Finalizada' },
];

async function carregarTarefas(){
  const usuario = usuarioAtual();
  const alvo = document.getElementById('lista-tarefas');
  try{
    const data = await api('/tarefas');
    const contagens = { aguardando: 0, recebida: 0, finalizada: 0 };
    for (const t of data.tarefas) contagens[t.status] = (contagens[t.status] || 0) + 1;
    document.getElementById('tarefas-kpis').innerHTML = TAREFAS_ABAS.map(aba => `<div class="kpi cor-${aba.id}"><div class="rotulo">${aba.label}</div><div class="numero">${contagens[aba.id] || 0}</div></div>`).join('');
    if (!data.tarefas.length){ alvo.innerHTML = '<div class="vazio">Nenhuma tarefa.</div>'; return; }
    let html = '<table><thead><tr><th>Descrição</th><th>Prazo</th>' + (usuario.cargo === 'administrador' ? '<th>Responsável</th>' : '') + '<th>Status</th><th></th></tr></thead><tbody>';
    for (const t of data.tarefas){
      html += `<tr>
        <td>${escapeHtml(t.descricao)}${t.observacao_final ? `<div class="particularidade-txt">Obs: ${escapeHtml(t.observacao_final)}</div>` : ''}</td>
        <td>${t.prazo ? formatarData(t.prazo) : '—'}</td>
        ${usuario.cargo === 'administrador' ? `<td>${escapeHtml(t.responsavel_nome)}</td>` : ''}
        <td><span class="selo ${t.status}">${t.status}</span></td>
        <td class="acoes-linha">
          ${t.status === 'aguardando' && t.responsavel_usuario_id === usuario.id ? `<button class="btn pequeno" data-receber="${t.id}">Confirmar recebimento</button>` : ''}
          ${t.status === 'recebida' && t.responsavel_usuario_id === usuario.id ? `<button class="btn pequeno" data-finalizar="${t.id}">Finalizar</button>` : ''}
          ${usuario.cargo === 'administrador' ? `<button class="btn perigo pequeno" data-excluir-tarefa="${t.id}">Excluir</button>` : ''}
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    alvo.innerHTML = html;
    alvo.querySelectorAll('[data-receber]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/tarefas?id=${btn.dataset.receber}&acao=receber`, { method: 'PATCH', body: '{}' });
      carregarTarefas();
    }));
    alvo.querySelectorAll('[data-finalizar]').forEach(btn => btn.addEventListener('click', async () => {
      const observacao_final = prompt('Observação final (opcional):') || null;
      await api(`/tarefas?id=${btn.dataset.finalizar}&acao=finalizar`, { method: 'PATCH', body: JSON.stringify({ observacao_final }) });
      carregarTarefas();
    }));
    alvo.querySelectorAll('[data-excluir-tarefa]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Excluir essa tarefa?')) return;
      await api(`/tarefas?id=${btn.dataset.excluirTarefa}`, { method: 'DELETE' });
      carregarTarefas();
    }));
  }catch(err){ alvo.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

// ---------------- Cadastros (admin) ----------------

let cadastrosSubaba = 'prestadores';

async function renderCadastros(){
  const cont = document.getElementById('conteudo');
  cont.innerHTML = `
    <h1>Cadastros</h1>
    <p class="subtitulo">Prestadores, convênios, vínculos e atribuições de responsabilidade.</p>
    <div class="subabas" id="cadastros-subabas">
      <button data-sub="prestadores">Prestadores</button>
      <button data-sub="convenios">Convênios</button>
      <button data-sub="vinculos">Vínculos</button>
      <button data-sub="atribuicoes">Atribuições</button>
    </div>
    <div id="cadastros-conteudo"></div>
  `;
  document.querySelectorAll('#cadastros-subabas button').forEach(btn => {
    btn.addEventListener('click', () => { cadastrosSubaba = btn.dataset.sub; renderSubabaCadastros(); });
  });
  renderSubabaCadastros();
}

function renderSubabaCadastros(){
  document.querySelectorAll('#cadastros-subabas button').forEach(btn => btn.classList.toggle('ativa', btn.dataset.sub === cadastrosSubaba));
  const mapa = { prestadores: renderPrestadores, convenios: renderConveniosCad, vinculos: renderVinculos, atribuicoes: renderAtribuicoes };
  mapa[cadastrosSubaba]();
}

async function renderPrestadores(){
  const alvo = document.getElementById('cadastros-conteudo');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  const prestadores = await api('/prestadores').then(d => d.prestadores).catch(() => []);
  alvo.innerHTML = `
    <div class="cartao">
      <div class="linha-form">
        <div class="campo"><label>Nome</label><input type="text" id="pr-nome"></div>
        <div class="campo"><label>Especialidade</label><input type="text" id="pr-especialidade"></div>
        <button class="btn" id="pr-criar">Adicionar</button>
      </div>
      <div class="erro-login" id="pr-erro"></div>
      <table><thead><tr><th>Nome</th><th>Especialidade</th><th>Status</th><th></th></tr></thead><tbody>
        ${prestadores.map(p => `
          <tr>
            <td>${escapeHtml(p.nome)}</td>
            <td>${escapeHtml(p.especialidade || '—')}</td>
            <td><span class="selo ${p.ativo ? 'faturado' : 'pendente'}">${p.ativo ? 'ativo' : 'inativo'}</span></td>
            <td class="acoes-linha"><button class="btn secundario pequeno" data-toggle-prestador="${p.id}" data-ativo="${p.ativo}">${p.ativo ? 'Desativar' : 'Ativar'}</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;
  document.getElementById('pr-criar').addEventListener('click', async () => {
    const nome = document.getElementById('pr-nome').value.trim();
    const especialidade = document.getElementById('pr-especialidade').value.trim();
    const erroEl = document.getElementById('pr-erro');
    erroEl.textContent = '';
    if (!nome){ erroEl.textContent = 'Informe o nome.'; return; }
    try{
      await api('/prestadores', { method: 'POST', body: JSON.stringify({ nome, especialidade: especialidade || null }) });
      renderPrestadores();
    }catch(err){ erroEl.textContent = err.message; }
  });
  alvo.querySelectorAll('[data-toggle-prestador]').forEach(btn => btn.addEventListener('click', async () => {
    const ativo = btn.dataset.ativo === 'true';
    await api(`/prestadores?id=${btn.dataset.togglePrestador}`, { method: 'PATCH', body: JSON.stringify({ ativo: !ativo }) });
    renderPrestadores();
  }));
}

async function renderConveniosCad(){
  const alvo = document.getElementById('cadastros-conteudo');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  const convenios = await api('/convenios').then(d => d.convenios).catch(() => []);
  const tiposTodos = ['SADT', 'CONSULTA', 'GIH'];
  alvo.innerHTML = `
    <div class="cartao">
      <div class="linha-form">
        <div class="campo"><label>Nome</label><input type="text" id="cv-nome"></div>
        <div class="campo"><label>Tipos</label>
          <div>${tiposTodos.map(t => `<label style="margin-right:8px;font-size:13px;font-weight:400;"><input type="checkbox" class="cv-tipo" value="${t}" checked> ${t}</label>`).join('')}</div>
        </div>
        <div class="campo"><label>Prazo (dia do mês)</label><input type="number" id="cv-prazo" min="1" max="31" style="width:70px;"></div>
        <button class="btn" id="cv-criar">Adicionar</button>
      </div>
      <div class="erro-login" id="cv-erro"></div>
      <table><thead><tr><th>Nome</th><th>Tipos</th><th>Prazo</th><th>Status</th><th></th></tr></thead><tbody>
        ${convenios.map(c => `
          <tr>
            <td>${escapeHtml(c.nome)}</td>
            <td>${c.tipos.join(', ')}</td>
            <td>${c.prazo_dia ? 'dia ' + c.prazo_dia : '—'}</td>
            <td><span class="selo ${c.ativo ? 'faturado' : 'pendente'}">${c.ativo ? 'ativo' : 'inativo'}</span></td>
            <td class="acoes-linha"><button class="btn secundario pequeno" data-toggle-convenio="${c.id}" data-ativo="${c.ativo}">${c.ativo ? 'Desativar' : 'Ativar'}</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;
  document.getElementById('cv-criar').addEventListener('click', async () => {
    const nome = document.getElementById('cv-nome').value.trim();
    const tipos = Array.from(alvo.querySelectorAll('.cv-tipo:checked')).map(c => c.value);
    const prazo_dia = document.getElementById('cv-prazo').value ? Number(document.getElementById('cv-prazo').value) : null;
    const erroEl = document.getElementById('cv-erro');
    erroEl.textContent = '';
    if (!nome){ erroEl.textContent = 'Informe o nome.'; return; }
    try{
      await api('/convenios', { method: 'POST', body: JSON.stringify({ nome, tipos, prazo_dia }) });
      renderConveniosCad();
    }catch(err){ erroEl.textContent = err.message; }
  });
  alvo.querySelectorAll('[data-toggle-convenio]').forEach(btn => btn.addEventListener('click', async () => {
    const ativo = btn.dataset.ativo === 'true';
    await api(`/convenios?id=${btn.dataset.toggleConvenio}`, { method: 'PATCH', body: JSON.stringify({ ativo: !ativo }) });
    renderConveniosCad();
  }));
}

async function renderVinculos(){
  const alvo = document.getElementById('cadastros-conteudo');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [vinculos, prestadores, convenios] = await Promise.all([
    api('/vinculos').then(d => d.vinculos).catch(() => []),
    api('/prestadores').then(d => d.prestadores).catch(() => []),
    api('/convenios').then(d => d.convenios).catch(() => []),
  ]);
  alvo.innerHTML = `
    <div class="cartao">
      <h2>Novo vínculo</h2>
      <div class="linha-form">
        <div class="campo"><label>Prestador</label><select id="vc-prestador">${prestadores.map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Convênio</label><select id="vc-convenio">${convenios.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Login do portal</label><input type="text" id="vc-login"></div>
        <div class="campo"><label>Senha do portal</label><input type="text" id="vc-senha"></div>
      </div>
      <div class="linha-form">
        <div class="campo" style="flex:1;"><label>Particularidades (como faturar esse prestador nesse convênio)</label><textarea id="vc-particularidades" rows="2" style="width:100%;"></textarea></div>
      </div>
      <button class="btn" id="vc-criar">Vincular</button>
      <div class="erro-login" id="vc-erro"></div>
    </div>
    <div id="vinculo-edicao"></div>
    <div class="cartao">
      <table><thead><tr><th>Prestador</th><th>Convênio</th><th>Login</th><th>Particularidades</th><th>Status</th><th></th></tr></thead><tbody>
        ${vinculos.map(v => `
          <tr>
            <td>${escapeHtml(v.prestador_nome)}</td>
            <td>${escapeHtml(v.convenio_nome)}</td>
            <td>${escapeHtml(v.login_portal || '—')}</td>
            <td class="particularidade-txt">${escapeHtml(v.particularidades || '—')}</td>
            <td><span class="selo ${v.ativo ? 'faturado' : 'pendente'}">${v.ativo ? 'ativo' : 'inativo'}</span></td>
            <td class="acoes-linha">
              <button class="btn secundario pequeno" data-editar-vinculo="${v.id}">Editar</button>
              <button class="btn perigo pequeno" data-excluir-vinculo="${v.id}">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;

  document.getElementById('vc-criar').addEventListener('click', async () => {
    const erroEl = document.getElementById('vc-erro');
    erroEl.textContent = '';
    try{
      await api('/vinculos', { method: 'POST', body: JSON.stringify({
        prestador_id: Number(document.getElementById('vc-prestador').value),
        convenio_id: Number(document.getElementById('vc-convenio').value),
        login_portal: document.getElementById('vc-login').value.trim() || null,
        senha_portal: document.getElementById('vc-senha').value || null,
        particularidades: document.getElementById('vc-particularidades').value.trim() || null,
      }) });
      renderVinculos();
    }catch(err){ erroEl.textContent = err.message; }
  });

  alvo.querySelectorAll('[data-excluir-vinculo]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Excluir esse vínculo?')) return;
    try{ await api(`/vinculos?id=${btn.dataset.excluirVinculo}`, { method: 'DELETE' }); renderVinculos(); }
    catch(err){ alert(err.message); }
  }));

  alvo.querySelectorAll('[data-editar-vinculo]').forEach(btn => btn.addEventListener('click', () => {
    const v = vinculos.find(x => x.id === Number(btn.dataset.editarVinculo));
    const painel = document.getElementById('vinculo-edicao');
    painel.innerHTML = `
      <div class="cartao" style="background:#F8FAFC;">
        <h2>Editar vínculo</h2>
        <div class="linha-form">
          <div class="campo"><label>Prestador</label><select id="ve-prestador">${prestadores.map(p => `<option value="${p.id}" ${p.id === v.prestador_id ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Convênio</label><select id="ve-convenio">${convenios.map(c => `<option value="${c.id}" ${c.id === v.convenio_id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Status</label><select id="ve-ativo"><option value="true" ${v.ativo ? 'selected' : ''}>Ativo</option><option value="false" ${!v.ativo ? 'selected' : ''}>Desativado</option></select></div>
        </div>
        <div class="linha-form">
          <div class="campo"><label>Login do portal</label><input type="text" id="ve-login" value="${escapeHtml(v.login_portal || '')}"></div>
          <div class="campo"><label>Senha do portal</label><input type="text" id="ve-senha" value="${escapeHtml(v.senha_portal || '')}"></div>
        </div>
        <div class="linha-form">
          <div class="campo" style="flex:1;"><label>Particularidades</label><textarea id="ve-particularidades" rows="2" style="width:100%;">${escapeHtml(v.particularidades || '')}</textarea></div>
        </div>
        <button class="btn" id="ve-salvar">Salvar</button>
        <button class="btn secundario" id="ve-cancelar">Cancelar</button>
        <div class="erro-login" id="ve-erro"></div>
      </div>
    `;
    painel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('ve-cancelar').addEventListener('click', () => { painel.innerHTML = ''; });
    document.getElementById('ve-salvar').addEventListener('click', async () => {
      try{
        await api(`/vinculos?id=${v.id}`, { method: 'PATCH', body: JSON.stringify({
          prestador_id: Number(document.getElementById('ve-prestador').value),
          convenio_id: Number(document.getElementById('ve-convenio').value),
          ativo: document.getElementById('ve-ativo').value === 'true',
          login_portal: document.getElementById('ve-login').value.trim() || null,
          senha_portal: document.getElementById('ve-senha').value || null,
          particularidades: document.getElementById('ve-particularidades').value.trim() || null,
        }) });
        painel.innerHTML = '';
        renderVinculos();
      }catch(err){ document.getElementById('ve-erro').textContent = err.message; }
    });
  }));
}

async function renderAtribuicoes(){
  const alvo = document.getElementById('cadastros-conteudo');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  const [vinculos, atribuicoes, usuarios, prestadores, convenios] = await Promise.all([
    api('/vinculos').then(d => d.vinculos).catch(() => []),
    api('/atribuicoes').then(d => d.atribuicoes).catch(() => []),
    api('/usuarios').then(d => d.usuarios).catch(() => []),
    api('/prestadores').then(d => d.prestadores).catch(() => []),
    api('/convenios').then(d => d.convenios).catch(() => []),
  ]);
  const faturistas = usuarios.filter(u => u.ativo);
  const responsavelPorPar = new Map(atribuicoes.map(a => [`${a.prestador_id}:${a.convenio_id}`, a]));

  alvo.innerHTML = `
    <div class="cartao">
      <h2>Nova atribuição</h2>
      <p class="subtitulo">Marque um ou mais prestadores/convênios e escolha o faturista responsável.</p>
      <div class="filtros">
        <div class="campo"><label>Filtrar por prestador</label><select id="na-filtro-prestador"><option value="">Todos</option>${prestadores.map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Filtrar por convênio</label><select id="na-filtro-convenio"><option value="">Todos</option>${convenios.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Atribuir a</label><select id="na-usuario">${faturistas.map(u => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}</select></div>
        <button class="btn" id="na-atribuir">Atribuir selecionados</button>
      </div>
      <div class="erro-login" id="na-erro"></div>
      <table>
        <thead><tr><th><input type="checkbox" id="na-marcar-todos"></th><th>Prestador</th><th>Convênio</th><th>Responsável atual</th></tr></thead>
        <tbody id="na-corpo"></tbody>
      </table>
    </div>
    <div class="cartao">
      <h2>Atribuições atuais</h2>
      <table><thead><tr><th>Faturista</th><th>Prestador</th><th>Convênio</th><th></th></tr></thead><tbody>
        ${atribuicoes.map(a => `
          <tr>
            <td>${escapeHtml(a.usuario_nome)}</td>
            <td>${escapeHtml(a.prestador_nome)}</td>
            <td>${escapeHtml(a.convenio_nome)}</td>
            <td><button class="btn perigo pequeno" data-excluir-atribuicao="${a.id}">Remover</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;

  function renderLinhasVinculos(){
    const fPrestador = document.getElementById('na-filtro-prestador').value;
    const fConvenio = document.getElementById('na-filtro-convenio').value;
    const corpo = document.getElementById('na-corpo');
    const filtrados = vinculos.filter(v =>
      (!fPrestador || v.prestador_id === Number(fPrestador)) &&
      (!fConvenio || v.convenio_id === Number(fConvenio))
    );
    if (!filtrados.length){ corpo.innerHTML = '<tr><td colspan="4" class="vazio">Nenhum vínculo encontrado pra esse filtro.</td></tr>'; return; }
    corpo.innerHTML = filtrados.map(v => {
      const resp = responsavelPorPar.get(`${v.prestador_id}:${v.convenio_id}`);
      return `<tr>
        <td><input type="checkbox" class="na-check" data-prestador="${v.prestador_id}" data-convenio="${v.convenio_id}"></td>
        <td>${escapeHtml(v.prestador_nome)}</td>
        <td>${escapeHtml(v.convenio_nome)}</td>
        <td>${resp ? escapeHtml(resp.usuario_nome) : '—'}</td>
      </tr>`;
    }).join('');
    document.getElementById('na-marcar-todos').checked = false;
  }
  renderLinhasVinculos();
  document.getElementById('na-filtro-prestador').addEventListener('change', renderLinhasVinculos);
  document.getElementById('na-filtro-convenio').addEventListener('change', renderLinhasVinculos);
  document.getElementById('na-marcar-todos').addEventListener('change', (e) => {
    document.querySelectorAll('.na-check').forEach(chk => { chk.checked = e.target.checked; });
  });

  document.getElementById('na-atribuir').addEventListener('click', async () => {
    const erroEl = document.getElementById('na-erro');
    erroEl.textContent = '';
    const usuario_id = Number(document.getElementById('na-usuario').value);
    const selecionados = [...document.querySelectorAll('.na-check:checked')].map(chk => ({
      prestador_id: Number(chk.dataset.prestador),
      convenio_id: Number(chk.dataset.convenio),
    }));
    if (!selecionados.length){ erroEl.textContent = 'Selecione ao menos um prestador/convênio.'; return; }
    try{
      for (const par of selecionados){
        await api('/atribuicoes', { method: 'POST', body: JSON.stringify({ usuario_id, ...par }) });
      }
      renderAtribuicoes();
    }catch(err){ erroEl.textContent = err.message; }
  });

  alvo.querySelectorAll('[data-excluir-atribuicao]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remover essa atribuição?')) return;
    await api(`/atribuicoes?id=${btn.dataset.excluirAtribuicao}`, { method: 'DELETE' });
    renderAtribuicoes();
  }));
}

// ---------------- Atividades da equipe (admin) ----------------

async function renderAtividades(){
  const cont = document.getElementById('conteudo');
  const anoAtual = Number(hojeBrasilAno());
  cont.innerHTML = `
    <h1>Atividades da equipe</h1>
    <p class="subtitulo">Produção individual no ano, organizada por mês (fuso de Brasília).</p>
    <div class="cartao">
      <div class="filtros">
        <div class="campo"><label>Ano</label>
          <select id="at-ano">
            ${[anoAtual, anoAtual - 1, anoAtual - 2].map(a => `<option value="${a}" ${a === anoAtual ? 'selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        <button class="btn" id="at-buscar">Atualizar</button>
      </div>
    </div>
    <div id="atividades-conteudo"><div class="vazio">Carregando...</div></div>
  `;
  document.getElementById('at-buscar').addEventListener('click', carregarAtividades);
  await carregarAtividades();
}

function hojeBrasilAno(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric' }).format(new Date());
}

async function carregarAtividades(){
  const ano = document.getElementById('at-ano').value;
  const alvo = document.getElementById('atividades-conteudo');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  try{
    const data = await api('/atividades?ano=' + ano);
    if (!data.usuarios.length){ alvo.innerHTML = '<div class="cartao"><div class="vazio">Nenhuma atividade registrada nesse ano.</div></div>'; return; }

    alvo.innerHTML = data.usuarios.map(u => `
      <div class="cartao">
        <h2>${escapeHtml(u.usuario_nome)} <span class="resumo">· ${u.total} ação(ões) em ${ano}</span></h2>
        <div class="grade-kpi">
          ${PAINEL_ABAS.map(aba => `<div class="kpi cor-${aba.id}"><div class="rotulo">${aba.label}</div><div class="numero">${u.total_por_status[aba.id] || 0}</div></div>`).join('')}
        </div>
        ${u.por_mes.length ? u.por_mes.slice().reverse().map(m => {
          const porDia = new Map();
          for (const it of m.itens){
            if (!porDia.has(it.dia)) porDia.set(it.dia, []);
            porDia.get(it.dia).push(it);
          }
          const dias = [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]));
          return `
          <details class="grupo-prestador">
            <summary>
              <span class="nome-prestador">${formatarCompetencia(m.mes)}</span>
              <span class="resumo">${m.total} ação(ões)</span>
            </summary>
            <div class="conteudo-grupo">
              ${dias.map(([dia, itens]) => `
                <details class="grupo-prestador">
                  <summary>
                    <span class="nome-prestador">${formatarData(dia)}</span>
                    <span class="resumo">${itens.length} ação(ões)</span>
                  </summary>
                  <div class="conteudo-grupo">
                    <table><thead><tr><th>Hora</th><th>Prestador</th><th>O que foi feito</th></tr></thead><tbody>
                      ${itens.map(it => `<tr><td>${formatarHora(it.criado_em)}</td><td>${escapeHtml(it.prestador_nome)}</td><td>${escapeHtml(it.convenio_nome)} · ${it.tipo} · <span class="selo ${it.status}">${rotuloStatus(it.status)}</span></td></tr>`).join('')}
                    </tbody></table>
                  </div>
                </details>
              `).join('')}
            </div>
          </details>
        `;
        }).join('') : '<div class="vazio">Nenhuma ação nesse ano.</div>'}
      </div>
    `).join('');
  }catch(err){ alvo.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

// ---------------- Usuários (admin) ----------------

async function renderUsuarios(){
  const cont = document.getElementById('conteudo');
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  const usuarios = await api('/usuarios').then(d => d.usuarios).catch(() => []);
  cont.innerHTML = `
    <h1>Usuários</h1>
    <p class="subtitulo">Contas de acesso ao sistema.</p>
    <div class="cartao">
      <h2>Novo usuário</h2>
      <div class="linha-form">
        <div class="campo"><label>Nome</label><input type="text" id="us-nome"></div>
        <div class="campo"><label>Login</label><input type="text" id="us-login" placeholder="opcional"></div>
        <div class="campo"><label>Cargo</label><select id="us-cargo"><option value="faturista">Faturista</option><option value="administrador">Administrador</option></select></div>
        <div class="campo"><label>Senha</label><input type="password" id="us-senha"></div>
        <button class="btn" id="us-criar">Criar</button>
      </div>
      <div class="erro-login" id="us-erro"></div>
    </div>
    <div class="cartao">
      <table><thead><tr><th>Nome</th><th>Login</th><th>Cargo</th><th>Status</th><th></th></tr></thead><tbody>
        ${usuarios.map(u => `
          <tr>
            <td>${escapeHtml(u.nome)}</td>
            <td>${escapeHtml(u.login)}</td>
            <td>${u.cargo}</td>
            <td><span class="selo ${u.ativo ? 'faturado' : 'pendente'}">${u.ativo ? 'ativo' : 'inativo'}</span></td>
            <td class="acoes-linha"><button class="btn secundario pequeno" data-toggle-usuario="${u.id}" data-ativo="${u.ativo}">${u.ativo ? 'Desativar' : 'Ativar'}</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;
  document.getElementById('us-criar').addEventListener('click', async () => {
    const erroEl = document.getElementById('us-erro');
    erroEl.textContent = '';
    const nome = document.getElementById('us-nome').value.trim();
    const login = document.getElementById('us-login').value.trim();
    const cargo = document.getElementById('us-cargo').value;
    const senha = document.getElementById('us-senha').value;
    if (!nome || !senha){ erroEl.textContent = 'Informe nome e senha.'; return; }
    try{
      await api('/usuarios', { method: 'POST', body: JSON.stringify({ nome, login: login || undefined, cargo, senha }) });
      renderUsuarios();
    }catch(err){ erroEl.textContent = err.message; }
  });
  cont.querySelectorAll('[data-toggle-usuario]').forEach(btn => btn.addEventListener('click', async () => {
    const ativo = btn.dataset.ativo === 'true';
    await api(`/usuarios?id=${btn.dataset.toggleUsuario}`, { method: 'PATCH', body: JSON.stringify({ ativo: !ativo }) });
    renderUsuarios();
  }));
}
