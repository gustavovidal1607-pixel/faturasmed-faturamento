const API = '/api';

async function api(path, opts = {}){
  const token = localStorage.getItem('token');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
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
  painel: { label: 'Painel', render: renderPainel, admin: true },
  faturamentos: { label: 'Faturamentos', render: renderFaturamentos },
  tarefas: { label: 'Tarefas', render: renderTarefas },
  cadastros: { label: 'Cadastros', render: renderCadastros, admin: true },
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
}

function iniciarApp(usuario){
  document.getElementById('tela-login').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('usuario-nome').textContent = usuario.nome;
  document.getElementById('usuario-papel').textContent = usuario.cargo;
  montarNav(usuario);
  abrirAba(usuario.cargo === 'administrador' ? 'painel' : 'faturamentos');
}

(function(){
  const token = localStorage.getItem('token');
  const usuarioSalvo = localStorage.getItem('usuario');
  if (token && usuarioSalvo) iniciarApp(JSON.parse(usuarioSalvo));
})();

// ---------------- Painel (admin) ----------------

async function renderPainel(){
  const cont = document.getElementById('conteudo');
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  try{
    const data = await api('/dashboard');
    let html = `<h1>Painel</h1><p class="subtitulo">Competência ${data.competencia}</p>`;
    if (data.prazos_proximos.length){
      html += '<div class="cartao"><h2>Prazos de fechamento chegando</h2>';
      for (const c of data.prazos_proximos){
        html += `<div class="alerta prazo">${escapeHtml(c.nome)} fecha dia ${c.prazo_dia} — ${c.dias_restantes === 0 ? 'hoje' : c.dias_restantes + ' dia(s)'}</div>`;
      }
      html += '</div>';
    }
    html += `<div class="cartao"><h2>Pendentes de faturamento (${data.total_pendentes})</h2>`;
    if (!data.pendentes.length){
      html += '<div class="vazio">Nada pendente nessa competência.</div>';
    }else{
      html += '<table><thead><tr><th>Convênio</th><th>Prestador</th><th>Tipo</th></tr></thead><tbody>';
      for (const l of data.pendentes){
        html += `<tr><td>${escapeHtml(l.convenio_nome)}</td><td>${escapeHtml(l.prestador_nome)}</td><td>${l.tipo}</td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '</div>';
    cont.innerHTML = html;
  }catch(err){ cont.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

// ---------------- Faturamentos ----------------

let faturamentosCache = [];

async function renderFaturamentos(){
  const cont = document.getElementById('conteudo');
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  const hoje = new Date();
  const competenciaPadrao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const [convenios, prestadores] = await Promise.all([
    api('/convenios').then(d => d.convenios).catch(() => []),
    api('/prestadores').then(d => d.prestadores).catch(() => []),
  ]);

  cont.innerHTML = `
    <h1>Faturamentos</h1>
    <p class="subtitulo">Marque o que já foi faturado por competência.</p>
    <div class="cartao">
      <div class="filtros">
        <div class="campo"><label>Competência</label><input type="month" id="f-competencia" value="${competenciaPadrao}"></div>
        <div class="campo"><label>Convênio</label><select id="f-convenio"><option value="">Todos</option>${convenios.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Prestador</label><select id="f-prestador"><option value="">Todos</option>${prestadores.map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Status</label><select id="f-status"><option value="">Todos</option><option value="pendente">Pendente</option><option value="faturado">Faturado</option></select></div>
        <button class="btn" id="f-buscar">Filtrar</button>
      </div>
      <div id="painel-lancamento"></div>
      <div id="tabela-faturamentos"></div>
    </div>
  `;
  document.getElementById('f-buscar').addEventListener('click', carregarFaturamentos);
  await carregarFaturamentos();
}

async function carregarFaturamentos(){
  const competencia = document.getElementById('f-competencia').value;
  const convenio_id = document.getElementById('f-convenio').value;
  const prestador_id = document.getElementById('f-prestador').value;
  const status = document.getElementById('f-status').value;
  const params = new URLSearchParams({ competencia });
  if (convenio_id) params.set('convenio_id', convenio_id);
  if (prestador_id) params.set('prestador_id', prestador_id);
  if (status) params.set('status', status);
  const alvo = document.getElementById('tabela-faturamentos');
  alvo.innerHTML = '<div class="vazio">Carregando...</div>';
  try{
    const data = await api('/faturamentos?' + params.toString());
    faturamentosCache = data.faturamentos;
    if (!data.faturamentos.length){ alvo.innerHTML = '<div class="vazio">Nenhum lançamento encontrado para esse filtro.</div>'; return; }
    let html = '<table><thead><tr><th>Convênio</th><th>Prestador</th><th>Tipo</th><th>Status</th><th>Detalhe</th><th></th></tr></thead><tbody>';
    data.faturamentos.forEach((l, i) => {
      const detalhe = l.status === 'faturado'
        ? (l.mes_completo ? 'Mês completo' : (l.faturado_ate ? 'Até ' + formatarData(l.faturado_ate) : '—'))
        : '—';
      html += `<tr>
        <td>${escapeHtml(l.convenio_nome)}</td>
        <td>${escapeHtml(l.prestador_nome)}</td>
        <td>${l.tipo}</td>
        <td><span class="selo ${l.status}">${l.status}</span></td>
        <td>${detalhe}${l.observacao ? `<div class="particularidade-txt">${escapeHtml(l.observacao)}</div>` : ''}</td>
        <td class="acoes-linha">
          <button class="btn pequeno" data-editar="${i}">Lançar</button>
          ${l.faturamento_id ? `<button class="btn secundario pequeno" data-historico="${l.faturamento_id}">Histórico</button>` : ''}
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    alvo.innerHTML = html;
    alvo.querySelectorAll('[data-editar]').forEach(btn => btn.addEventListener('click', () => abrirFormLancamento(faturamentosCache[Number(btn.dataset.editar)])));
    alvo.querySelectorAll('[data-historico]').forEach(btn => btn.addEventListener('click', () => mostrarHistorico(Number(btn.dataset.historico))));
  }catch(err){ alvo.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

function abrirFormLancamento(linha){
  const painel = document.getElementById('painel-lancamento');
  painel.innerHTML = `
    <div class="cartao" style="background:#F8FAFC;">
      <h2>${escapeHtml(linha.convenio_nome)} · ${escapeHtml(linha.prestador_nome)} · ${linha.tipo} · ${linha.competencia}</h2>
      <div class="linha-form">
        <div class="campo"><label>Status</label>
          <select id="lf-status">
            <option value="pendente" ${linha.status === 'pendente' ? 'selected' : ''}>Pendente</option>
            <option value="faturado" ${linha.status === 'faturado' ? 'selected' : ''}>Faturado</option>
          </select>
        </div>
        <div class="campo"><label><input type="checkbox" id="lf-mes-completo" ${linha.mes_completo ? 'checked' : ''}> Mês completo</label></div>
        <div class="campo"><label>Faturado até</label><input type="date" id="lf-faturado-ate" value="${linha.faturado_ate ? String(linha.faturado_ate).slice(0, 10) : ''}"></div>
        <div class="campo" style="flex:1;"><label>Observação</label><textarea id="lf-observacao" rows="1" style="width:100%;">${escapeHtml(linha.observacao || '')}</textarea></div>
      </div>
      <button class="btn" id="lf-salvar">Salvar</button>
      <button class="btn secundario" id="lf-cancelar">Cancelar</button>
      <div class="erro-login" id="lf-erro"></div>
    </div>
  `;
  document.getElementById('lf-cancelar').addEventListener('click', () => { painel.innerHTML = ''; });
  document.getElementById('lf-salvar').addEventListener('click', async () => {
    const corpo = {
      convenio_id: linha.convenio_id,
      prestador_id: linha.prestador_id,
      tipo: linha.tipo,
      competencia: linha.competencia,
      status: document.getElementById('lf-status').value,
      mes_completo: document.getElementById('lf-mes-completo').checked,
      faturado_ate: document.getElementById('lf-faturado-ate').value || null,
      observacao: document.getElementById('lf-observacao').value.trim() || null,
    };
    try{
      await api('/faturamentos', { method: 'POST', body: JSON.stringify(corpo) });
      painel.innerHTML = '';
      await carregarFaturamentos();
    }catch(err){ document.getElementById('lf-erro').textContent = err.message; }
  });
}

async function mostrarHistorico(faturamentoId){
  const painel = document.getElementById('painel-lancamento');
  painel.innerHTML = '<div class="vazio">Carregando histórico...</div>';
  try{
    const data = await api('/faturamentos?historico_de=' + faturamentoId);
    if (!data.historico.length){ painel.innerHTML = '<div class="vazio">Sem histórico.</div>'; return; }
    let html = '<div class="cartao"><h2>Histórico</h2><table><thead><tr><th>Quando</th><th>Status</th><th>Detalhe</th><th>Por</th></tr></thead><tbody>';
    for (const h of data.historico){
      const detalhe = h.status === 'faturado' ? (h.mes_completo ? 'Mês completo' : (h.faturado_ate ? 'Até ' + formatarData(h.faturado_ate) : '—')) : '—';
      html += `<tr><td>${formatarDataHora(h.criado_em)}</td><td><span class="selo ${h.status}">${h.status}</span></td><td>${detalhe}</td><td>${escapeHtml(h.alterado_por_nome || '—')}</td></tr>`;
    }
    html += '</tbody></table><button class="btn secundario" id="hist-fechar">Fechar</button></div>';
    painel.innerHTML = html;
    document.getElementById('hist-fechar').addEventListener('click', () => { painel.innerHTML = ''; });
  }catch(err){ painel.innerHTML = `<div class="alerta pendente">${escapeHtml(err.message)}</div>`; }
}

// ---------------- Tarefas ----------------

async function renderTarefas(){
  const cont = document.getElementById('conteudo');
  const usuario = usuarioAtual();
  cont.innerHTML = '<div class="vazio">Carregando...</div>';
  let usuarios = [];
  if (usuario.cargo === 'administrador') usuarios = await api('/usuarios').then(d => d.usuarios).catch(() => []);

  let html = '<h1>Tarefas</h1><p class="subtitulo">Designadas pelo administrador, com confirmação de recebimento e finalização.</p>';
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

async function carregarTarefas(){
  const usuario = usuarioAtual();
  const alvo = document.getElementById('lista-tarefas');
  try{
    const data = await api('/tarefas');
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
    <div id="vinculo-edicao"></div>
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
        <h2>Editar vínculo: ${escapeHtml(v.prestador_nome)} · ${escapeHtml(v.convenio_nome)}</h2>
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
    document.getElementById('ve-cancelar').addEventListener('click', () => { painel.innerHTML = ''; });
    document.getElementById('ve-salvar').addEventListener('click', async () => {
      try{
        await api(`/vinculos?id=${v.id}`, { method: 'PATCH', body: JSON.stringify({
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
  const [atribuicoes, usuarios, prestadores, convenios] = await Promise.all([
    api('/atribuicoes').then(d => d.atribuicoes).catch(() => []),
    api('/usuarios').then(d => d.usuarios).catch(() => []),
    api('/prestadores').then(d => d.prestadores).catch(() => []),
    api('/convenios').then(d => d.convenios).catch(() => []),
  ]);
  const faturistas = usuarios.filter(u => u.ativo);
  alvo.innerHTML = `
    <div class="cartao">
      <h2>Nova atribuição</h2>
      <div class="linha-form">
        <div class="campo"><label>Faturista</label><select id="at-usuario">${faturistas.map(u => `<option value="${u.id}">${escapeHtml(u.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Prestador</label><select id="at-prestador">${prestadores.map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Convênio</label><select id="at-convenio">${convenios.map(c => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`).join('')}</select></div>
        <button class="btn" id="at-criar">Atribuir</button>
      </div>
      <div class="erro-login" id="at-erro"></div>
    </div>
    <div class="cartao">
      <table><thead><tr><th>Funcionário</th><th>Prestador</th><th>Convênio</th><th></th></tr></thead><tbody>
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
  document.getElementById('at-criar').addEventListener('click', async () => {
    const erroEl = document.getElementById('at-erro');
    erroEl.textContent = '';
    try{
      await api('/atribuicoes', { method: 'POST', body: JSON.stringify({
        usuario_id: Number(document.getElementById('at-usuario').value),
        prestador_id: Number(document.getElementById('at-prestador').value),
        convenio_id: Number(document.getElementById('at-convenio').value),
      }) });
      renderAtribuicoes();
    }catch(err){ erroEl.textContent = err.message; }
  });
  alvo.querySelectorAll('[data-excluir-atribuicao]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remover essa atribuição?')) return;
    await api(`/atribuicoes?id=${btn.dataset.excluirAtribuicao}`, { method: 'DELETE' });
    renderAtribuicoes();
  }));
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
