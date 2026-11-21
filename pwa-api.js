'use strict';
// Implementa no navegador a mesma API (window.api) que a app Windows expõe via Electron.
(function () {
  const { L, Sync } = window.TarefasLib;
  const KEY = 'tarefas.state.v1';
  const SKEY = 'tarefas.sync.v1';

  let state = L.emptyState();
  let syncCfg = null; // { repo, branch, path, token }
  let syncInfo = { status: 'off', lastOk: null, error: null };
  let syncing = false;
  let syncAgain = false;
  let syncTimer = null;
  const changedCbs = [];
  const syncCbs = [];

  // ---------- armazenamento local ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      state = Object.assign(L.emptyState(), s);
      state.settings = Object.assign(L.emptyState().settings, s && s.settings);
      state.tasks.concat(state.archive).forEach(L.normalize);
    } catch {
      state = L.emptyState();
    }
    try { syncCfg = JSON.parse(localStorage.getItem(SKEY)); } catch { syncCfg = null; }
    if (!syncCfg || !syncCfg.token) syncCfg = null;
    syncInfo = { status: syncCfg ? 'idle' : 'off', lastOk: null, error: null };
  }

  function save(noSync) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Não foi possível guardar localmente', e);
    }
    if (!noSync) scheduleSync(4000);
  }

  function snapshot() {
    return {
      active: L.sortTasks(state.tasks),
      archive: state.archive.slice().sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)),
      settings: state.settings
    };
  }

  const find = (list, id) => list.find(t => t.id === id);

  // ---------- notificações ----------
  const notifState = () => ('Notification' in window ? Notification.permission : 'unsupported');
  const canNotify = () => state.settings.notifications && notifState() === 'granted';

  async function show(title, body) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    } catch {
      try { new Notification(title, { body }); } catch { /* sem suporte */ }
    }
  }

  function tick() {
    if (!canNotify()) return;
    const fired = L.dueNotifications(state.tasks, Date.now());
    if (!fired.length) return;
    save();
    fired.forEach(f => show(f.title, f.body));
  }

  // ---------- sincronização com o GitHub ----------
  function publicSync() {
    return {
      configured: !!syncCfg,
      repo: syncCfg ? syncCfg.repo : '',
      branch: syncCfg ? syncCfg.branch : '',
      path: syncCfg ? syncCfg.path : 'tarefas.json',
      status: syncInfo.status,
      lastOk: syncInfo.lastOk,
      error: syncInfo.error
    };
  }

  const pushSyncInfo = () => syncCbs.forEach(cb => cb(publicSync()));

  function scheduleSync(ms) {
    if (!syncCfg) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, ms);
  }

  async function runSync() {
    if (!syncCfg) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    syncInfo = { status: 'syncing', lastOk: syncInfo.lastOk, error: null };
    pushSyncInfo();
    try {
      const r = await Sync.syncOnce(
        { repo: syncCfg.repo, branch: syncCfg.branch, path: syncCfg.path, token: syncCfg.token }, state, { device: 'PWA' });
      if (r.changed) {
        save(true);
        changedCbs.forEach(cb => cb());
        tick();
      }
      syncInfo = { status: 'ok', lastOk: Date.now(), error: null };
    } catch (e) {
      syncInfo = { status: e.code === 'offline' ? 'offline' : 'error', lastOk: syncInfo.lastOk, error: e.message };
    } finally {
      syncing = false;
      pushSyncInfo();
      if (syncAgain) { syncAgain = false; scheduleSync(1500); }
    }
  }

  // ---------- API ----------
  const api = {
    isPwa: true,
    notifState,
    requestNotifications: async () => {
      if (!('Notification' in window)) return 'unsupported';
      try { await Notification.requestPermission(); } catch { /* ignora */ }
      return notifState();
    },

    list: async () => snapshot(),

    add: async input => {
      const p = L.sanitize(input);
      if (!p.name) throw new Error('O nome é obrigatório.');
      state.tasks.push(L.newTask(p));
      save();
      setTimeout(tick, 300);
      return snapshot();
    },

    update: async (id, input) => {
      const t = find(state.tasks, id);
      if (!t) return snapshot();
      const p = L.sanitize(input);
      if (!p.name) throw new Error('O nome é obrigatório.');
      const changed = p.due !== t.due || JSON.stringify(p.alerts) !== JSON.stringify(t.alerts) ||
        JSON.stringify(p.repeat) !== JSON.stringify(t.repeat);
      Object.assign(t, p);
      t.modifiedAt = Date.now();
      if (changed) { t.fired = {}; t.lastRepeat = null; }
      save();
      setTimeout(tick, 300);
      return snapshot();
    },

    archive: async id => {
      const i = state.tasks.findIndex(t => t.id === id);
      if (i >= 0) {
        const [t] = state.tasks.splice(i, 1);
        t.archivedAt = Date.now();
        t.modifiedAt = Date.now();
        state.archive.push(t);
        save();
      }
      return snapshot();
    },

    restore: async id => {
      const i = state.archive.findIndex(t => t.id === id);
      if (i >= 0) {
        const [t] = state.archive.splice(i, 1);
        t.archivedAt = null;
        t.modifiedAt = Date.now();
        t.fired = { late: t.due !== null && t.due < Date.now() };
        t.lastRepeat = null;
        state.tasks.push(t);
        save();
      }
      return snapshot();
    },

    addNote: async (id, text) => {
      const t = find(state.tasks, id) || find(state.archive, id);
      text = String(text || '').trim().slice(0, 2000);
      if (t && text) {
        t.notes.push({ id: L.uid(), text, ts: Date.now() });
        t.modifiedAt = Date.now();
        save();
      }
      return snapshot();
    },

    delNote: async (id, noteId) => {
      const t = find(state.tasks, id) || find(state.archive, id);
      if (t) {
        t.notes = t.notes.filter(n => n.id !== noteId);
        t.noteTombs.push(noteId);
        t.modifiedAt = Date.now();
        save();
      }
      return snapshot();
    },

    settings: async patch => {
      for (const k of ['notifications']) if (typeof patch[k] === 'boolean') state.settings[k] = patch[k];
      save();
      return snapshot();
    },

    exportCsv: async () => {
      const file = new File([L.toCsv(state)], 'tarefas.csv', { type: 'text/csv' });
      const count = state.tasks.length + state.archive.length;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Tarefas' });
          return { ok: true, count };
        } catch (e) {
          if (e && e.name === 'AbortError') return { ok: false };
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = 'tarefas.csv';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return { ok: true, count };
    },

    importCsv: () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.addEventListener('cancel', () => resolve({ ok: false }));
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        if (!f) return resolve({ ok: false });
        if (f.size > 5 * 1024 * 1024) return resolve({ ok: false, error: 'Ficheiro demasiado grande (máx. 5 MB).' });
        try {
          const res = L.importCsv(state, await f.text());
          save();
          resolve(Object.assign({ ok: true }, res));
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
      input.click();
    }),

    syncStatus: async () => publicSync(),

    syncSave: async cfg => {
      const repo = String(cfg.repo || '').trim()
        .replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: 'Repositório inválido. Use o formato utilizador/repositório.' };
      const filePath = String(cfg.path || '').trim().replace(/^\/+/, '') || 'tarefas.json';
      if (!/^[\w./-]+$/.test(filePath) || filePath.includes('..')) return { ok: false, error: 'Caminho do ficheiro inválido.' };
      const branch = String(cfg.branch || '').trim();
      if (branch && !/^[\w./-]+$/.test(branch)) return { ok: false, error: 'Nome de ramo inválido.' };
      const token = String(cfg.token || '').trim() || (syncCfg && syncCfg.token);
      if (!token) return { ok: false, error: 'Cole o token do GitHub.' };
      const next = { repo, branch, path: filePath };
      try {
        await Sync.check(Object.assign({ token }, next));
      } catch (e) {
        return { ok: false, error: e.message };
      }
      syncCfg = Object.assign({ token }, next);
      try { localStorage.setItem(SKEY, JSON.stringify(syncCfg)); } catch { /* ignora */ }
      syncInfo = { status: 'idle', lastOk: null, error: null };
      runSync();
      return Object.assign({ ok: true }, publicSync());
    },

    syncNow: async () => {
      await runSync();
      return publicSync();
    },

    syncOff: async () => {
      clearTimeout(syncTimer);
      syncCfg = null;
      try { localStorage.removeItem(SKEY); } catch { /* ignora */ }
      syncInfo = { status: 'off', lastOk: null, error: null };
      return publicSync();
    },

    onChanged: cb => changedCbs.push(cb),
    onSyncStatus: cb => syncCbs.push(cb)
  };

  window.api = api;
  load();

  setInterval(tick, 20000);
  setTimeout(tick, 1500);
  scheduleSync(1500);
  setInterval(() => scheduleSync(0), 120000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); scheduleSync(800); }
  });
  window.addEventListener('online', () => scheduleSync(500));
  window.addEventListener('focus', () => scheduleSync(1000));
})();
