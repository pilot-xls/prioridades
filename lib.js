'use strict';
(function () {
  const defs = {};
  const cache = {};
  defs['logic'] = function (module, exports, require) {
'use strict';

const UNIT_MS = { min: 60e3, h: 3600e3, d: 86400e3 };
const UNITS = Object.keys(UNIT_MS);

function emptyState() {
  return { tasks: [], archive: [], settings: { notifications: true, alwaysOnTop: false, autoStart: false } };
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitize(input) {
  const out = {};
  out.name = String(input.name || '').trim().slice(0, 200);
  out.importance = input.importance === 'alta' ? 'alta' : 'baixa';
  const due = toNum(input.due);
  out.due = input.due === null || input.due === '' || due === null ? null : due;
  out.alerts = [];
  if (out.due !== null && Array.isArray(input.alerts)) {
    for (const a of input.alerts) {
      const amount = toNum(a && a.amount);
      if (amount !== null && amount > 0 && UNITS.includes(a.unit)) out.alerts.push({ amount, unit: a.unit });
    }
  }
  out.repeat = null;
  if (out.due === null && input.repeat) {
    const startAt = toNum(input.repeat.startAt);
    const every = toNum(input.repeat.every);
    if (startAt !== null && every !== null && every > 0 && UNITS.includes(input.repeat.unit)) {
      out.repeat = { startAt, every, unit: input.repeat.unit };
    }
  }
  return out;
}

function newTask(input) {
  const now = Date.now();
  return Object.assign(
    { id: uid(), notes: [], noteTombs: [], createdAt: now, modifiedAt: now, archivedAt: null, fired: {}, lastRepeat: null },
    sanitize(input)
  );
}

function group(t) {
  if (t.due !== null) return t.importance === 'alta' ? 0 : 1;
  return t.importance === 'alta' ? 2 : 3;
}

function sortTasks(tasks) {
  return tasks.slice().sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    if (a.due !== null && b.due !== null && a.due !== b.due) return a.due - b.due;
    return a.createdAt - b.createdAt;
  });
}

function alertKey(a) {
  return a.amount + a.unit;
}

function describeAlert(a) {
  const u = { min: 'min', h: 'h', d: a.amount === 1 ? 'dia' : 'dias' }[a.unit];
  return `${a.amount} ${u} antes`;
}

// Devolve as notificações a disparar agora e atualiza o estado da tarefa (fired/lastRepeat).
function dueNotifications(tasks, now) {
  const out = [];
  for (const t of tasks) {
    if (t.due !== null) {
      if (now >= t.due) {
        if (!t.fired.late) {
          t.fired.late = true;
          for (const a of t.alerts) t.fired[alertKey(a)] = true;
          out.push({ id: t.id, title: t.name, body: 'Tarefa em atraso' });
        }
        continue;
      }
      for (const a of t.alerts) {
        const k = alertKey(a);
        if (!t.fired[k] && now >= t.due - a.amount * UNIT_MS[a.unit]) {
          t.fired[k] = true;
          out.push({ id: t.id, title: t.name, body: `Termina em ${describeAlert(a).replace(' antes', '')}` });
        }
      }
    } else if (t.repeat && now >= t.repeat.startAt) {
      const gap = t.repeat.every * UNIT_MS[t.repeat.unit];
      if (t.lastRepeat === null || now - t.lastRepeat >= gap) {
        t.lastRepeat = now;
        out.push({ id: t.id, title: t.name, body: 'Lembrete' });
      }
    }
  }
  return out;
}

// ---------- CSV ----------
const HEADER = ['id', 'estado', 'nome', 'importancia', 'data_limite', 'avisos', 'repeticao', 'notas', 'criada_em', 'arquivada_em'];

function p2(n) { return String(n).padStart(2, '0'); }
function fmt(ms) {
  if (ms === null || ms === undefined) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function parseDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const ms = new Date(s.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function esc(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[;"\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(state) {
  const rows = [HEADER.join(';')];
  const add = (t, estado) => {
    rows.push([
      t.id, estado, t.name, t.importance, fmt(t.due),
      t.alerts.map(a => a.amount + a.unit).join(' '),
      t.repeat ? `${fmt(t.repeat.startAt)} cada ${t.repeat.every}${t.repeat.unit}` : '',
      t.notes.map(n => n.text.replace(/\r?\n/g, ' ')).join(' | '),
      fmt(t.createdAt), fmt(t.archivedAt)
    ].map(esc).join(';'));
  };
  state.tasks.forEach(t => add(t, 'ativa'));
  state.archive.forEach(t => add(t, 'arquivada'));
  return '﻿' + rows.join('\r\n') + '\r\n';
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

function parseAlerts(s) {
  const out = [];
  for (const m of String(s || '').matchAll(/(\d+(?:\.\d+)?)(min|h|d)/g)) out.push({ amount: Number(m[1]), unit: m[2] });
  return out;
}

function parseRepeat(s) {
  const m = /^(.+?) cada (\d+(?:\.\d+)?)(min|h|d)$/.exec(String(s || '').trim());
  if (!m) return null;
  return { startAt: parseDate(m[1]), every: Number(m[2]), unit: m[3] };
}

// Importa para o estado. Ignora linhas cujo id já existe. Devolve { added, skipped }.
function importCsv(state, text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, skipped: 0 };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = name => head.indexOf(name);
  if (col('nome') < 0) throw new Error('Ficheiro inválido: falta a coluna "nome".');
  const existing = new Set(state.tasks.concat(state.archive).map(t => t.id));
  let added = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const get = n => (col(n) >= 0 ? (r[col(n)] || '').trim() : '');
    const name = get('nome');
    if (!name) { skipped++; continue; }
    const id = get('id');
    if (id && existing.has(id)) { skipped++; continue; }
    const t = newTask({
      name,
      importance: get('importancia').toLowerCase() === 'alta' ? 'alta' : 'baixa',
      due: parseDate(get('data_limite')),
      alerts: parseAlerts(get('avisos')),
      repeat: parseRepeat(get('repeticao'))
    });
    if (id) t.id = id;
    t.notes = get('notas').split(' | ').filter(Boolean).map(text => ({ id: uid(), text, ts: Date.now() }));
    const created = parseDate(get('criada_em'));
    if (created !== null) t.createdAt = created;
    // Tarefas importadas não disparam avisos que já passaram
    t.fired = { late: t.due !== null && t.due < Date.now() };
    if (get('estado').toLowerCase() === 'arquivada') {
      t.archivedAt = parseDate(get('arquivada_em')) || Date.now();
      state.archive.push(t);
    } else state.tasks.push(t);
    existing.add(t.id);
    added++;
  }
  return { added, skipped };
}

// ---------- sincronização ----------
function normalize(t) {
  if (!Array.isArray(t.notes)) t.notes = [];
  if (!Array.isArray(t.noteTombs)) t.noteTombs = [];
  if (typeof t.createdAt !== 'number') t.createdAt = 0;
  if (typeof t.modifiedAt !== 'number') t.modifiedAt = t.createdAt;
  if (typeof t.archivedAt !== 'number') t.archivedAt = null;
  if (!t.fired || typeof t.fired !== 'object') t.fired = {};
  if (t.lastRepeat === undefined) t.lastRepeat = null;
  return t;
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}

// Texto canónico do ficheiro remoto (sem estado específico deste dispositivo)
function exportRemote(state) {
  const all = state.tasks.concat(state.archive).map(t => {
    const { fired, lastRepeat, ...rest } = normalize(t);
    return rest;
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(canon({ version: 1, tasks: all }), null, 1) + '\n';
}

function sameSchedule(a, b) {
  return JSON.stringify([a.due, a.alerts, a.repeat]) === JSON.stringify([b.due, b.alerts, b.repeat]);
}

function mergeTask(l, r, now) {
  const tombs = new Set([...l.noteTombs, ...r.noteTombs]);
  const byId = new Map();
  for (const n of l.notes.concat(r.notes)) if (!tombs.has(n.id) && !byId.has(n.id)) byId.set(n.id, n);
  const notes = [...byId.values()].sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
  const winner = r.modifiedAt > l.modifiedAt ? r : l;
  const m = Object.assign({}, winner, {
    notes, noteTombs: [...tombs].sort(), modifiedAt: Math.max(l.modifiedAt, r.modifiedAt)
  });
  m.fired = l.fired;
  m.lastRepeat = l.lastRepeat;
  if (!sameSchedule(l, m)) {
    m.fired = { late: m.due !== null && m.due < now };
    m.lastRepeat = null;
  }
  return m;
}

// Junta as tarefas remotas no estado local. Devolve true se o estado local mudou.
function mergeInto(state, remoteTasks, now) {
  const before = exportRemote(state);
  const map = new Map();
  for (const t of state.tasks.concat(state.archive)) map.set(t.id, normalize(t));
  for (const raw of remoteTasks) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    const r = normalize(Object.assign({}, raw, sanitize(raw)));
    if (!r.name) continue;
    r.notes = r.notes.filter(n => n && typeof n.id === 'string' && typeof n.text === 'string' && typeof n.ts === 'number');
    r.noteTombs = r.noteTombs.filter(x => typeof x === 'string');
    const l = map.get(r.id);
    if (!l) {
      r.fired = { late: r.due !== null && r.due < now };
      r.lastRepeat = null;
      map.set(r.id, r);
    } else {
      map.set(r.id, mergeTask(l, r, now));
    }
  }
  state.tasks = [];
  state.archive = [];
  for (const t of map.values()) (t.archivedAt !== null ? state.archive : state.tasks).push(t);
  return before !== exportRemote(state);
}

module.exports = {
  normalize, canon, exportRemote, mergeInto,
  emptyState, newTask, sanitize, group, sortTasks, dueNotifications,
  toCsv, importCsv, parseCsv, uid, describeAlert
};

  };
  defs['sync'] = function (module, exports, require) {
'use strict';
// Sincronização com um ficheiro JSON num repositório GitHub (API Contents).
// Sem dependências de Node: funciona também no browser (PWA).
const L = require('./logic');

const API = 'https://api.github.com';

class SyncError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64dec(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function headers(cfg) {
  return {
    Authorization: 'Bearer ' + cfg.token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function repoUrl(cfg, extra) {
  const [o, r] = cfg.repo.split('/');
  return `${API}/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}${extra || ''}`;
}

function fileUrl(cfg) {
  const p = (cfg.path || 'tarefas.json').split('/').map(encodeURIComponent).join('/');
  return repoUrl(cfg, '/contents/' + p);
}

async function request(f, url, opts) {
  try {
    return await f(url, opts);
  } catch {
    throw new SyncError('Sem ligação à internet.', 'offline');
  }
}

async function failure(res) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* sem corpo */ }
  if (res.status === 401) return new SyncError('Token inválido ou expirado. Volte a ligar com um token novo.', 'auth');
  if (res.status === 403 || res.status === 429) {
    const rem = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
    if (rem === '0' || res.status === 429) return new SyncError('Limite de pedidos do GitHub atingido. Tenta mais tarde.', 'rate');
    return new SyncError('O token não tem permissão. Precisa de "Contents: Read and write" neste repositório.', 'perm');
  }
  return new SyncError(`O GitHub respondeu ${res.status}${msg ? ': ' + msg : ''}.`, 'http');
}

// Devolve { sha, text } ou null se o ficheiro ainda não existe.
async function getFile(cfg, f) {
  const q = cfg.branch ? '?ref=' + encodeURIComponent(cfg.branch) : '';
  const res = await request(f, fileUrl(cfg) + q, { headers: headers(cfg) });
  if (res.status === 404) {
    const repo = await request(f, repoUrl(cfg), { headers: headers(cfg) });
    if (repo.ok) return null;
    if (repo.status === 404) throw new SyncError('Repositório não encontrado, ou o token não tem acesso a ele.', 'norepo');
    throw await failure(repo);
  }
  if (!res.ok) throw await failure(res);
  const data = await res.json();
  if (Array.isArray(data) || data.type !== 'file') throw new SyncError('O caminho indicado é uma pasta, não um ficheiro.', 'badpath');
  let content = data.content;
  if (data.encoding === 'none' || (!content && data.size > 0)) {
    const blob = await request(f, repoUrl(cfg, '/git/blobs/' + data.sha), { headers: headers(cfg) });
    if (!blob.ok) throw await failure(blob);
    content = (await blob.json()).content;
  }
  return { sha: data.sha, text: b64dec(content || '') };
}

async function putFile(cfg, text, sha, message, f) {
  const body = { message, content: b64enc(text) };
  if (sha) body.sha = sha;
  if (cfg.branch) body.branch = cfg.branch;
  const res = await request(f, fileUrl(cfg), {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers(cfg)),
    body: JSON.stringify(body)
  });
  if (res.ok) return;
  let msg = '';
  try { msg = (await res.clone().json()).message || ''; } catch { /* sem corpo */ }
  if (/empty/i.test(msg)) throw new SyncError('O repositório está vazio. Crie lá primeiro um ficheiro (por exemplo um README).', 'empty');
  if (res.status === 409 || (res.status === 422 && /sha/i.test(msg))) throw new SyncError('Conflito de versões.', 'conflict');
  throw await failure(res);
}

// Verifica o token e o repositório sem alterar nada.
async function check(cfg, opts) {
  const f = (opts && opts.fetch) || globalThis.fetch;
  await getFile(cfg, f);
  return true;
}

// Um ciclo de sincronização: ler, juntar, escrever (se mudou). Repete em caso de conflito.
async function syncOnce(cfg, state, opts) {
  opts = opts || {};
  const f = opts.fetch || globalThis.fetch;
  const nowFn = opts.now || Date.now;
  let changed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await getFile(cfg, f);
    if (remote) {
      let parsed;
      try { parsed = JSON.parse(remote.text); } catch { parsed = null; }
      if (!parsed || !Array.isArray(parsed.tasks)) throw new SyncError('O ficheiro remoto não tem o formato esperado.', 'badfile');
      if (L.mergeInto(state, parsed.tasks, nowFn())) changed = true;
    }
    const text = L.exportRemote(state);
    if (remote && remote.text === text) return { changed, pushed: false };
    try {
      await putFile(cfg, text, remote && remote.sha, `Sincronização${opts.device ? ' (' + opts.device + ')' : ''}`, f);
      return { changed, pushed: true };
    } catch (e) {
      if (e.code === 'conflict' && attempt < 3) continue;
      throw e;
    }
  }
  throw new SyncError('Não foi possível resolver o conflito. Tenta de novo.', 'conflict');
}

module.exports = { syncOnce, check, SyncError, b64enc, b64dec };

  };
  function req(n) {
    n = n.replace(/^\.\//, '');
    if (!cache[n]) {
      const m = { exports: {} };
      cache[n] = m;
      defs[n](m, m.exports, req);
    }
    return cache[n].exports;
  }
  window.TarefasLib = { L: req('logic'), Sync: req('sync') };
})();
