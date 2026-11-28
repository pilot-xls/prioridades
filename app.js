'use strict';

const $view = document.getElementById('view');
const $top = document.getElementById('top');
const $bottom = document.getElementById('bottom');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

let data = { active: [], archive: [], settings: {} };
let view = { name: 'list', id: null, search: '' };
let syncInfo = { configured: false, status: 'off', repo: '', path: 'tarefas.json', branch: '', lastOk: null, error: null };
let cloudBtn = null;
let syncRedraw = null;
const DEFAULT_REPO = 'pilot-xls/prioridades-dados';

// ---------- utilidades ----------
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

const p2 = n => String(n).padStart(2, '0');
function toInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function fromInput(s) {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : null;
}
const fmt = ms => new Date(ms).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });

function group(t) {
  if (t.due !== null) return t.importance === 'alta' ? 0 : 1;
  return t.importance === 'alta' ? 2 : 3;
}
const urgent = t => t.due !== null && t.due - Date.now() < 86400e3;

function alertText(a) {
  const u = { min: 'min', h: 'h', d: a.amount === 1 ? 'dia' : 'dias' }[a.unit];
  return `${a.amount} ${u} antes`;
}
function repeatText(r) {
  const u = { min: 'min', h: 'h', d: 'dias' }[r.unit];
  return `a partir de ${fmt(r.startAt)}, a cada ${r.every} ${u}`;
}
function meta(t) {
  const imp = t.importance === 'alta' ? 'alta' : 'baixa';
  if (t.due !== null) return `${t.due < Date.now() ? 'Em atraso · ' : ''}${fmt(t.due)} · ${imp}`;
  return `Sem data · ${imp}`;
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 3000);
}

async function run(p) {
  try {
    data = await p;
    render();
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''));
  }
}

function closeModal() {
  syncRedraw = null;
  $modal.classList.add('hidden');
  $modal.replaceChildren();
  if (view.name === 'list' && !!cloudBtn !== syncInfo.configured) render();
}
function openModal(box) {
  $modal.replaceChildren(el('div', { class: 'box' }, box));
  $modal.classList.remove('hidden');
}
$modal.addEventListener('mousedown', e => { if (e.target === $modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- vistas ----------
let render = function () {
  if (view.name === 'detail' && !find(view.id)) view = { name: 'list', id: null, search: '' };
  $top.replaceChildren();
  $view.replaceChildren();
  $bottom.replaceChildren();
  $bottom.classList.add('hidden');
  if (view.name === 'list') renderList();
  else if (view.name === 'archive') renderArchive();
  else renderDetail();
};

function find(id) {
  return data.active.find(t => t.id === id) || data.archive.find(t => t.id === id);
}

function syncText(i) {
  if (i.status === 'syncing') return 'A sincronizar…';
  if (i.status === 'ok') return 'Sincronizado às ' + new Date(i.lastOk).toLocaleTimeString('pt-PT', { timeStyle: 'short' });
  if (i.status === 'offline') return 'Sem ligação. Tenta de novo automaticamente.';
  if (i.status === 'error') return i.error || 'Erro de sincronização.';
  return 'A aguardar a primeira sincronização';
}

function updateCloud() {
  if (!cloudBtn) return;
  const i = syncInfo;
  cloudBtn.textContent = i.status === 'syncing' ? '⟳' : (i.status === 'error' || i.status === 'offline') ? '⚠' : '☁';
  cloudBtn.className = 'icon ' + (i.status === 'ok' ? 'sync-ok' : (i.status === 'error' || i.status === 'offline') ? 'sync-err' : '');
  cloudBtn.title = syncText(i);
  cloudBtn.setAttribute('aria-label', 'Sincronização: ' + syncText(i));
}

function renderList() {
  cloudBtn = syncInfo.configured ? el('button', { onclick: openSettings }) : null;
  updateCloud();
  $top.append(
    el('span', { class: 'grow' }, 'Tarefas'),
    ...(cloudBtn ? [cloudBtn] : []),
    el('button', { class: 'icon', title: 'Arquivo', 'aria-label': 'Arquivo', onclick: () => { view = { name: 'archive', search: '' }; render(); } }, '🗄'),
    el('button', { class: 'icon', title: 'Definições', 'aria-label': 'Definições', onclick: openSettings }, '⚙')
  );
  if (!data.active.length) {
    $view.append(el('div', { class: 'empty' }, el('b', {}, 'Comece a sua lista'), 'Crie a primeira tarefa ou nota.'));
  }
  for (const t of data.active) {
    const row = el('div', { class: `task g${group(t)}${urgent(t) ? ' urgent' : ''}` },
      el('span', { class: 'dot' }),
      el('div', { class: 'info' }, el('div', { class: 'name', title: t.name }, t.name), el('div', { class: 'meta' }, meta(t) + (t.notes.length ? ` · ${t.notes.length} nota${t.notes.length > 1 ? 's' : ''}` : ''))),
      el('button', { onclick: () => { view = { name: 'detail', id: t.id }; render(); } }, 'Detalhes'),
      el('button', { class: 'danger', title: 'Enviar para o arquivo', onclick: () => {
        row.classList.add('out');
        setTimeout(() => run(window.api.archive(t.id)), 230);
      } }, 'Apagar')
    );
    $view.append(row);
  }
  $bottom.classList.remove('hidden');
  $bottom.append(el('button', { class: 'primary big', onclick: () => openForm(null) }, '+ Nova tarefa'));
}

function renderArchive() {
  $top.append(
    el('button', { class: 'icon', 'aria-label': 'Voltar', onclick: () => { view = { name: 'list' }; render(); } }, '←'),
    el('span', { class: 'grow' }, `Arquivo (${data.archive.length})`)
  );
  const search = el('input', { type: 'text', placeholder: 'Pesquisar no arquivo (nome ou notas)', value: view.search || '' });
  const list = el('div');
  const draw = () => {
    view.search = search.value;
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const items = data.archive.filter(t => !q || t.name.toLowerCase().includes(q) || t.notes.some(n => n.text.toLowerCase().includes(q)));
    if (!items.length) list.append(el('div', { class: 'empty' }, q ? 'Nada encontrado.' : 'O arquivo está vazio.'));
    for (const t of items) {
      list.append(el('div', { class: `task g${group(t)}` },
        el('span', { class: 'dot' }),
        el('div', { class: 'info' },
          el('div', { class: 'name', title: t.name }, t.name),
          el('div', { class: 'meta' }, `${meta(t)} · arquivada ${fmt(t.archivedAt)}`)),
        el('button', { onclick: () => { view = { name: 'detail', id: t.id }; render(); } }, 'Ver'),
        el('button', { onclick: () => run(window.api.restore(t.id)) }, 'Restaurar')));
    }
  };
  search.addEventListener('input', draw);
  $view.append(el('div', { style: 'margin-bottom:10px' }, search), list);
  draw();
}

function renderDetail() {
  const t = find(view.id);
  const archived = t.archivedAt !== null;
  $top.append(
    el('button', { class: 'icon', 'aria-label': 'Voltar', onclick: () => { view = { name: archived ? 'archive' : 'list', search: '' }; render(); } }, '←'),
    el('span', { class: 'grow' }, archived ? 'Detalhes (arquivada)' : 'Detalhes')
  );
  const g = group(t);
  const chips = el('div', { class: `g${g}` },
    el('span', { class: 'chip' }, t.importance === 'alta' ? 'Importância alta' : 'Importância baixa'),
    el('span', { class: 'chip soft' }, t.due !== null ? fmt(t.due) : 'Sem data'));
  const info = [];
  if (t.alerts.length) info.push(el('div', { class: 'meta' }, 'Avisos: ' + t.alerts.map(alertText).join(', ')));
  if (t.repeat) info.push(el('div', { class: 'meta' }, 'Lembrete ' + repeatText(t.repeat)));

  const input = el('textarea', { placeholder: 'Escreva uma nota…', maxlength: '2000', rows: '2' });
  const err = el('div', { class: 'err' });
  const add = () => {
    if (!input.value.trim()) { err.textContent = 'Escreva alguma coisa primeiro.'; return; }
    run(window.api.addNote(t.id, input.value));
  };
  input.addEventListener('input', () => { err.textContent = ''; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); });

  const notes = el('div');
  if (!t.notes.length) notes.append(el('div', { class: 'meta' }, 'Ainda sem notas.'));
  for (const n of t.notes) {
    notes.append(el('div', { class: 'note' },
      el('div', { class: 't' }, n.text, el('small', {}, fmt(n.ts))),
      el('button', { class: 'icon danger', 'aria-label': 'Apagar nota', title: 'Apagar nota', onclick: () => run(window.api.delNote(t.id, n.id)) }, '✕')));
  }

  $view.append(
    el('h2', {}, t.name), chips, ...info,
    el('h3', {}, 'Notas'), notes,
    el('div', { style: 'margin-top:8px' }, input, err, el('button', { onclick: add }, 'Adicionar nota')),
    el('div', { class: 'row', style: 'margin-top:16px' },
      archived
        ? el('button', { class: 'primary', style: 'flex:1', onclick: () => { view = { name: 'list' }; run(window.api.restore(t.id)); } }, 'Restaurar')
        : [el('button', { style: 'flex:1', onclick: () => openForm(t) }, 'Editar'),
           el('button', { class: 'danger', style: 'flex:1', onclick: () => { view = { name: 'list' }; run(window.api.archive(t.id)); } }, 'Apagar')]));
}

// ---------- formulário ----------
function openForm(task) {
  const editing = !!task;
  let importance = task ? task.importance : 'baixa';

  const name = el('input', { type: 'text', maxlength: '200', placeholder: 'Ex.: Entregar relatório', value: task ? task.name : '' });
  const nameErr = el('div', { class: 'err' });

  const bAlta = el('button', { type: 'button', class: 'alta' }, 'Alta');
  const bBaixa = el('button', { type: 'button', class: 'baixa' }, 'Baixa');
  const paint = () => {
    bAlta.className = 'alta' + (importance === 'alta' ? ' on' : '');
    bBaixa.className = 'baixa' + (importance === 'baixa' ? ' on' : '');
    bAlta.setAttribute('aria-pressed', importance === 'alta');
    bBaixa.setAttribute('aria-pressed', importance === 'baixa');
  };
  bAlta.onclick = () => { importance = 'alta'; paint(); };
  bBaixa.onclick = () => { importance = 'baixa'; paint(); };
  paint();

  const due = el('input', { type: 'datetime-local', value: task && task.due !== null ? toInput(task.due) : '' });
  const dueErr = el('div', { class: 'err' });

  // Avisos antes da data
  const alertsBox = el('div');
  const addAlertRow = (a) => {
    const amount = el('input', { type: 'number', min: '1', step: '1', value: String(a.amount), style: 'flex:0 0 72px' });
    const unit = el('select', {}, ...[['min', 'minutos'], ['h', 'horas'], ['d', 'dias']].map(([v, l]) => el('option', { value: v }, l)));
    unit.value = a.unit;
    const rm = el('button', { type: 'button', class: 'icon', 'aria-label': 'Remover aviso' }, '✕');
    const row = el('div', { class: 'row', style: 'margin-bottom:6px' }, amount, unit, el('span', { style: 'white-space:nowrap;color:var(--muted)' }, 'antes'), rm);
    row._get = () => ({ amount: Number(amount.value), unit: unit.value });
    rm.onclick = () => row.remove();
    alertsBox.append(row);
  };
  const alertsSection = el('div', {}, el('label', { class: 'f' }, 'Avisar antes da data limite'), alertsBox,
    el('button', { type: 'button', onclick: () => addAlertRow({ amount: 1, unit: 'h' }) }, '+ aviso'));
  (task ? task.alerts : []).forEach(addAlertRow);

  // Repetição sem data
  const rep = task && task.repeat;
  const rStart = el('input', { type: 'datetime-local', value: rep ? toInput(rep.startAt) : '' });
  const rEvery = el('input', { type: 'number', min: '1', step: '1', value: rep ? String(rep.every) : '30' });
  const rUnit = el('select', {}, ...[['min', 'minutos'], ['h', 'horas']].map(([v, l]) => el('option', { value: v }, l)));
  rUnit.value = rep && rep.unit !== 'd' ? rep.unit : 'min';
  const rOn = el('input', { type: 'checkbox', checked: !!rep });
  const repErr = el('div', { class: 'err' });
  const repeatSection = el('div', {},
    el('label', { class: 'f' }, 'Lembrete repetido (sem data limite)'),
    el('label', { class: 'row', style: 'margin-bottom:6px' }, rOn, 'Ativar lembrete'),
    el('label', { class: 'f' }, 'A partir de'), rStart,
    el('label', { class: 'f' }, 'Repetir a cada'), el('div', { class: 'row' }, rEvery, rUnit), repErr);

  const sync = () => {
    const has = !!due.value;
    alertsSection.classList.toggle('hidden', !has);
    repeatSection.classList.toggle('hidden', has);
  };
  due.addEventListener('input', () => { dueErr.textContent = ''; sync(); });
  sync();

  const submit = () => {
    nameErr.textContent = dueErr.textContent = repErr.textContent = '';
    if (!name.value.trim()) { nameErr.textContent = 'Escreva um nome.'; name.focus(); return; }
    const payload = { name: name.value, importance, due: null, alerts: [], repeat: null };
    if (due.value) {
      payload.due = fromInput(due.value);
      if (payload.due === null) { dueErr.textContent = 'Data inválida.'; return; }
      for (const row of alertsBox.children) {
        const a = row._get();
        if (!(a.amount > 0)) { dueErr.textContent = 'Os avisos precisam de um número maior que 0.'; return; }
        payload.alerts.push(a);
      }
    } else if (rOn.checked) {
      const start = fromInput(rStart.value);
      const every = Number(rEvery.value);
      if (start === null) { repErr.textContent = 'Escolha quando o lembrete começa.'; return; }
      if (!(every > 0)) { repErr.textContent = 'O intervalo tem de ser maior que 0.'; return; }
      payload.repeat = { startAt: start, every, unit: rUnit.value };
    }
    closeModal();
    run(editing ? window.api.update(task.id, payload) : window.api.add(payload));
  };

  openModal([
    el('h2', {}, editing ? 'Editar tarefa' : 'Nova tarefa'),
    el('label', { class: 'f' }, 'Nome'), name, nameErr,
    el('label', { class: 'f' }, 'Importância'), el('div', { class: 'seg' }, bAlta, bBaixa),
    el('label', { class: 'f' }, 'Data limite (opcional)'), due, dueErr,
    alertsSection, repeatSection,
    el('div', { class: 'row', style: 'margin-top:14px' },
      el('button', { style: 'flex:1', onclick: closeModal }, 'Cancelar'),
      el('button', { class: 'primary', style: 'flex:1', onclick: submit }, 'Guardar'))
  ]);
  name.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  name.addEventListener('input', () => { nameErr.textContent = ''; });
  name.focus();
}

// ---------- definições ----------
function syncSection() {
  const box = el('div');
  const draw = () => {
    const i = syncInfo;
    box.replaceChildren();
    if (i.configured) {
      box.append(
        el('div', { class: 'meta', style: 'color:var(--text)' }, `Ligado a ${i.repo}` + (i.path !== 'tarefas.json' ? ` (${i.path})` : '')),
        el('div', { class: 'meta ' + (i.status === 'error' || i.status === 'offline' ? 'sync-err' : i.status === 'ok' ? 'sync-ok' : ''), style: 'margin:4px 0 8px;font-size:12px' }, syncText(i)),
        el('div', { class: 'row' },
          el('button', { style: 'flex:1', onclick: async () => { syncInfo = await window.api.syncNow(); draw(); updateCloud(); } }, 'Sincronizar agora'),
          el('button', { class: 'danger', style: 'flex:1', onclick: async () => { syncInfo = await window.api.syncOff(); cloudBtn = null; draw(); run(window.api.list()); } }, 'Desligar')));
      return;
    }
    const repo = el('input', { type: 'text', value: DEFAULT_REPO, placeholder: 'utilizador/repositório', autocomplete: 'off', spellcheck: 'false' });
    const token = el('input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
    const path = el('input', { type: 'text', placeholder: 'tarefas.json', autocomplete: 'off' });
    const err = el('div', { class: 'err' });
    const go = el('button', { class: 'primary big' }, 'Ligar');
    go.onclick = async () => {
      err.textContent = '';
      if (!repo.value.trim()) { err.textContent = 'Indique o repositório.'; return; }
      if (!token.value.trim()) { err.textContent = 'Cole o token do GitHub.'; return; }
      go.disabled = true;
      go.textContent = 'A verificar…';
      const r = await window.api.syncSave({ repo: repo.value, token: token.value, path: path.value });
      go.disabled = false;
      go.textContent = 'Ligar';
      if (!r.ok) { err.textContent = r.error; return; }
      syncInfo = r;
      token.value = '';
      draw();
      toast('Ligado ao GitHub');
    };
    box.append(
      el('label', { class: 'f', style: 'margin-top:0' }, 'Repositório (privado)'), repo,
      el('label', { class: 'f' }, 'Token (fine-grained, Contents: leitura e escrita)'), token,
      el('label', { class: 'f' }, 'Ficheiro (opcional)'), path,
      err, go,
      el('div', { class: 'meta', style: 'font-size:12px;color:var(--muted);margin-top:6px' }, 'O token fica guardado cifrado neste computador.'));
  };
  syncRedraw = draw;
  draw();
  return box;
}

function notifPermRow() {
  const st = window.api.notifState();
  if (st === 'granted') {
    return el('div', { class: 'meta', style: 'font-size:12px;color:var(--muted);margin-bottom:8px' },
      'Permissão deste dispositivo: ativa. Os avisos chegam com a app aberta ou em segundo plano (o sistema pode suspendê-la).');
  }
  const msg = st === 'unsupported' ? 'Este navegador não suporta notificações.'
    : st === 'denied' ? 'Bloqueadas neste dispositivo. Ative-as nas definições do sistema.'
    : 'Falta permitir as notificações neste dispositivo.';
  const row = el('div', { style: 'margin:4px 0 8px' }, el('div', { class: 'meta', style: 'font-size:12px;color:var(--muted);margin-bottom:6px' }, msg));
  if (st === 'default') {
    row.append(el('button', { onclick: async () => { await window.api.requestNotifications(); closeModal(); openSettings(); } }, 'Permitir notificações'));
  }
  return row;
}

function openSettings() {
  const s = data.settings;
  const sw = (label, key) => el('label', { class: 'switch' }, label,
    el('input', { type: 'checkbox', checked: !!s[key], onchange: e => run(window.api.settings({ [key]: e.target.checked })) }));
  openModal([
    el('h2', {}, 'Definições'),
    sw('Notificações', 'notifications'),
    ...(window.api.isPwa ? [notifPermRow()] : [sw('Manter sempre por cima', 'alwaysOnTop'), sw('Iniciar com o Windows', 'autoStart')]),
    el('h3', {}, 'Sincronização GitHub'),
    syncSection(),
    el('h3', {}, 'Dados (CSV)'),
    el('div', { class: 'row' },
      el('button', { style: 'flex:1', onclick: async () => {
        const r = await window.api.exportCsv();
        if (r.ok) toast(`${r.count} tarefas exportadas`);
      } }, 'Exportar'),
      el('button', { style: 'flex:1', onclick: async () => {
        const r = await window.api.importCsv();
        if (r.error) toast(r.error);
        else if (r.ok) { toast(`${r.added} importadas, ${r.skipped} ignoradas`); closeModal(); run(window.api.list()); }
      } }, 'Importar')),
    el('div', { class: 'meta', style: 'margin-top:6px;color:var(--muted);font-size:12px' }, 'Inclui as tarefas ativas e o arquivo. Abre no Excel.'),
    el('button', { class: 'big', style: 'margin-top:14px', onclick: closeModal }, 'Fechar')
  ]);
}

// ---------- arranque ----------
window.api.onChanged(() => run(window.api.list()));
window.api.syncStatus().then(i => { syncInfo = i; if (view.name === 'list' && $modal.classList.contains('hidden')) render(); });
window.api.onSyncStatus(i => {
  const was = syncInfo.configured;
  syncInfo = i;
  if (was !== i.configured && view.name === 'list' && $modal.classList.contains('hidden')) render();
  updateCloud();
  if (syncRedraw) syncRedraw();
});
let sig = '';
const signature = () => data.active.map(t => t.id + urgent(t) + (t.due !== null && t.due < Date.now())).join();
const origRender = render;
render = function () { sig = signature(); origRender(); };
setInterval(() => {
  if (view.name === 'list' && $modal.classList.contains('hidden') && signature() !== sig) render();
}, 30000);
run(window.api.list());
