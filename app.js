"use strict";
const KEY = "prioridades.v1", GK = "prioridades.gh.v1", PK = "prioridades.prefs.v1";
const DAY = 864e5, KEEP = 30 * DAY; // concluídas e apagadas desaparecem ao fim de 30 dias
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const Q = {
  now:      {n:"Fazer já",        c:"#ef4444", hint:"Urgente + importante. Faz isto primeiro."},
  schedule: {n:"Agendar",         c:"#3b82f6", hint:"Importante, sem pressa. Marca quando o vais fazer."},
  delegate: {n:"Delegar",         c:"#f59e0b", hint:"Urgente, mas pouco importante. Passa a alguém."},
  drop:     {n:"Eliminar / sem ação", c:"#64748b", hint:"Nem urgente nem importante. Elimina ou deixa sem ação."}
};
const ORDER = ["now","schedule","delegate","drop"];

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => Number.isFinite(v) ? v : 0;
const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
const validDays = n => Number.isInteger(n) && n >= 0 && n <= 365;
function hash(s){ // cyrb53: id estável para itens importados sem id
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < s.length; i++){ const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ---------- modelo de dados ---------- */
// Normaliza qualquer item (local, importado ou vindo do GitHub) para uma forma conhecida e segura.
function cleanItem(x){
  if(!x || typeof x !== "object") return null;
  const id = typeof x.id === "string" && x.id ? x.id.slice(0, 64) : "h" + hash(JSON.stringify(x));
  const upd = Number.isFinite(x.upd) ? x.upd : num(x.created);
  if(x.deleted) return {id, deleted:true, upd};
  const o = {
    id, title: str(x.title, 200).trim() || "(sem título)",
    date: RE_DATE.test(x.date) ? x.date : "", goal: str(x.goal, 2000),
    u: x.u ? 1 : 0, i: x.i ? 1 : 0,
    who: str(x.who, 80), when: RE_DATE.test(x.when) ? x.when : "",
    created: Number.isFinite(x.created) ? x.created : upd, upd, done: !!x.done
  };
  if(typeof x.um === "boolean") o.um = x.um;
  if(o.done && Number.isFinite(x.doneAt)) o.doneAt = x.doneAt;
  return o;
}
const ckey = o => JSON.stringify(o, Object.keys(o).sort());
function newer(a, b){ // o mais recente ganha; empate decidido igual em todos os dispositivos
  if(!a) return b; if(!b) return a;
  if(a.upd !== b.upd) return b.upd > a.upd ? b : a;
  return ckey(b) > ckey(a) ? b : a;
}
function cleanList(list){
  const m = new Map();
  for(const raw of Array.isArray(list) ? list : []){ const x = cleanItem(raw); if(x) m.set(x.id, newer(m.get(x.id), x)); }
  return [...m.values()];
}
function merge(a, b){
  const m = new Map();
  for(const x of [...a, ...b]) m.set(x.id, newer(m.get(x.id), x));
  const cut = Date.now() - KEEP;
  return [...m.values()].filter(x => !(x.deleted && x.upd < cut));
}
const canon = items => JSON.stringify(items.map(ckey).sort());

function load(){
  const o = {items:[], days:7, daysUpd:0};
  try{
    const s = JSON.parse(localStorage.getItem(KEY));
    if(s && typeof s === "object"){
      o.items = cleanList(s.items);
      if(validDays(s.days)) o.days = s.days;
      o.daysUpd = num(s.daysUpd);
    }
  }catch(e){}
  return o;
}
let state = load();
let prefs = (() => { try{ return Object.assign({badge:true}, JSON.parse(localStorage.getItem(PK))); }catch(e){ return {badge:true}; } })();
const savePrefs = () => { try{ localStorage.setItem(PK, JSON.stringify(prefs)); }catch(e){} };

let persistAsked = false;
function save(noSync){
  state.items = cleanList(state.items);
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){ toast("Não foi possível guardar neste dispositivo"); }
  if(!persistAsked){ // pede ao browser para não apagar os dados locais
    persistAsked = true;
    navigator.storage?.persisted?.().then(p => p || navigator.storage.persist()).catch(() => {});
  }
  if(!noSync) scheduleSync();
}
// Converte concluídas há mais de 30 dias em "apagadas" e limpa apagadas antigas.
function housekeep(noSync){
  const now = Date.now(), cut = now - KEEP; let ch = false;
  const out = [];
  for(const x of state.items){
    if(x.deleted){ if(x.upd < cut){ ch = true; continue; } out.push(x); }
    else if(x.done && x.doneAt && x.doneAt < cut){ out.push({id:x.id, deleted:true, upd:now}); ch = true; }
    else out.push(x);
  }
  if(ch){ state.items = out; save(noSync); }
  return ch;
}

/* ---------- datas e urgência ---------- */
function today(){ const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function daysTo(s){ if(!RE_DATE.test(s || "")) return null; const [y, m, d] = s.split("-").map(Number); return Math.round((new Date(y, m - 1, d) - today()) / DAY); }
function fmtDate(s){ if(!RE_DATE.test(s || "")) return ""; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
function localISO(){ const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// Itens antigos sem "um": com data → automático; sem data e urgência 1 → foi escolhida à mão.
const isManual = x => typeof x.um === "boolean" ? x.um : (!x.date && !!x.u);
// Urgência efetiva, recalculada sempre que se desenha (não fica congelada no dia da criação).
function urgOf(x){
  const n = daysTo(x.date);
  if(n !== null && n < 0) return {u:1, why:"late", n};
  const w = daysTo(x.when);
  if(x.i === 1 && w !== null && w <= 0) return {u:1, why:"when", n};
  if(isManual(x)) return {u:x.u ? 1 : 0, why:"manual", n};
  if(n === null) return {u:0, why:"nodate", n};
  return {u:n <= state.days ? 1 : 0, why:"auto", n};
}
function quad(u, i){
  if(u && i) return "now";
  if(u && !i) return "delegate";
  if(!u && i) return "schedule";
  return "drop";
}
const quadOf = x => quad(urgOf(x).u, x.i);

function dueLabel(s){
  const n = daysTo(s); if(n === null) return "";
  if(n < 0) return `<span class="late">atrasada ${-n}d · ${fmtDate(s)}</span>`;
  if(n === 0) return `<span class="late">hoje</span>`;
  if(n === 1) return `amanhã · ${fmtDate(s)}`;
  return `${fmtDate(s)} (${n}d)`;
}
function whenLabel(s){
  const n = daysTo(s); if(n === null) return "";
  if(n < 0) return `📅 ${fmtDate(s)} (passou)`;
  if(n === 0) return "📅 hoje";
  if(n === 1) return "📅 amanhã";
  return `📅 ${fmtDate(s)}`;
}

/* ---------- avisos ---------- */
let toastEl = null, toastT = 0;
function toast(text, action, fn){
  if(toastEl) toastEl.remove();
  clearTimeout(toastT);
  const e = document.createElement("div");
  e.className = "toast" + (action ? " act" : "");
  e.setAttribute("role", "status");
  const s = document.createElement("span"); s.textContent = text; e.appendChild(s);
  if(action){
    const b = document.createElement("button"); b.type = "button"; b.textContent = action;
    b.onclick = () => { e.remove(); toastEl = null; fn(); };
    e.appendChild(b);
  }
  // Dentro de um diálogo aberto, senão fica escondido atrás dele.
  (document.querySelector("dialog[open]") || document.body).appendChild(e);
  toastEl = e;
  toastT = setTimeout(() => { e.remove(); if(toastEl === e) toastEl = null; }, action ? 5000 : 2500);
}

/* ---------- lista ---------- */
let doneOpen = false;
function sortKey(x){ return [x.date, x.when].filter(d => RE_DATE.test(d || "")).sort()[0] || ""; }
function cmp(a, b){
  const ka = sortKey(a), kb = sortKey(b);
  if(ka !== kb){ if(!ka) return 1; if(!kb) return -1; return ka < kb ? -1 : 1; }
  return a.created - b.created;
}
function render(){
  const live = state.items.filter(x => !x.deleted);
  const open = live.filter(x => !x.done), done = live.filter(x => x.done);
  const groups = {now:[], schedule:[], delegate:[], drop:[]};
  for(const x of open) groups[quadOf(x)].push(x);
  let h = "";
  if(!live.length) h += `<div class="welcome">Toca em <b>+</b> para adicionar a primeira entrada. Respondes a 2 perguntas — prazo e objetivo — e a app diz-te o que fazer.</div>`;
  for(const k of ORDER){
    const list = groups[k].sort(cmp), q = Q[k];
    h += `<section><div class="sh"><span class="dot" style="background:${q.c}"></span><h2>${q.n}</h2><small>${list.length}</small></div>`;
    h += `<div class="hint">${q.hint}</div>`;
    if(!list.length) h += `<div class="empty">Nada aqui.</div>`;
    for(const x of list){
      const meta = (x.who ? `<span class="tag">→ ${esc(x.who)}</span>` : "") +
                   (x.when ? `<span class="tag">${esc(whenLabel(x.when))}</span>` : "") + dueLabel(x.date);
      h += `<div class="item" style="--c:${q.c}" data-id="${esc(x.id)}">
        <button class="chk" data-act="done" aria-label="Concluir: ${esc(x.title)}"><span class="ring"></span></button>
        <div class="body" data-act="edit" role="button" tabindex="0">
          <div class="t">${esc(x.title)}</div>
          ${meta ? `<div class="m">${meta}</div>` : ""}
          ${x.goal ? `<div class="m">🎯 ${esc(x.goal)}</div>` : ""}
        </div></div>`;
    }
    h += `</section>`;
  }
  if(done.length){
    h += `<details class="done"${doneOpen ? " open" : ""}><summary>Concluídas (${done.length}) <small>· saem ao fim de 30 dias</small></summary>`;
    for(const x of done.sort((a, b) => num(b.doneAt) - num(a.doneAt))){
      h += `<div class="item" style="--c:var(--ok)" data-id="${esc(x.id)}">
        <button class="chk on" data-act="undo" aria-label="Reabrir: ${esc(x.title)}"><span class="ring">✓</span></button>
        <div class="body" data-act="edit" role="button" tabindex="0"><div class="t">${esc(x.title)}</div></div></div>`;
    }
    h += `</details>`;
  }
  $("app").innerHTML = h;
  updateBadge(groups.now.length);
}
// <details> não faz "bubble" do evento toggle: apanhar na fase de captura.
$("app").addEventListener("toggle", e => { if(e.target.matches?.("details.done")) doneOpen = e.target.open; }, true);

function setDone(id, v, offerUndo){
  const it = state.items.find(x => x.id === id); if(!it || it.deleted) return;
  it.done = v; it.upd = Date.now();
  if(v) it.doneAt = Date.now(); else delete it.doneAt;
  save(); render();
  if(offerUndo) toast("Concluída", "Anular", () => setDone(id, false, false));
}
function act(el){
  const id = el.closest(".item").dataset.id;
  const it = state.items.find(x => x.id === id); if(!it || it.deleted) return;
  const a = el.dataset.act;
  if(a === "done") setDone(id, true, true);
  else if(a === "undo") setDone(id, false, false);
  else if(a === "edit") openForm(it);
}
$("app").addEventListener("click", e => { const el = e.target.closest("[data-act]"); if(el) act(el); });
$("app").addEventListener("keydown", e => {
  if((e.key === "Enter" || e.key === " ") && e.target.matches('[data-act="edit"]')){ e.preventDefault(); act(e.target); }
});

/* ---------- badge no ícone ---------- */
function updateBadge(n){
  if(!("setAppBadge" in navigator)) return;
  const p = prefs.badge && n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  p?.catch?.(() => {});
}

/* ---------- painéis ---------- */
// Fecha o teclado antes de fechar o painel e repõe a página encostada à esquerda
// (no iPhone o teclado/zoom podia deixar a lista deslocada ou maior que o ecrã).
function closeDlg(d){ document.activeElement?.blur?.(); d.close(); }
for(const d of [$("dlg"), $("dlgMenu")]) d.addEventListener("close", () => { if(scrollX) scrollTo(0, scrollY); });

/* ---------- formulário ---------- */
let editId = null, form = {u:0, i:null, um:false}, needI = false, snap = "";
const formState = () => JSON.stringify([$("fTitle").value, $("fDate").value, $("fGoal").value, $("fWho").value, $("fWhen").value, form.i, form.um, form.um ? form.u : null]);
const formUrg = () => urgOf({date:$("fDate").value, when:$("fWhen").value, i:form.i, um:form.um, u:form.u});
function setSeg(seg, v){ seg.querySelectorAll("button").forEach(b => { const on = +b.dataset.v === v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); }); }
function refreshForm(){
  const r = formUrg(), d = $("fDate").value;
  setSeg($("segU"), r.u); setSeg($("segI"), form.i);
  const falta = r.n === 0 ? "é hoje" : r.n === 1 ? "falta 1 dia" : `faltam ${r.n} dias`;
  $("uHint").textContent = {
    late: "O prazo já passou → conta sempre como urgente.",
    when: "Chegou o dia agendado → conta como urgente.",
    nodate: "Sem data limite → urgência pouca (podes alterar).",
    auto: `Pela data: ${falta} (urgente se ≤ ${state.days} dias). Atualiza-se sozinha.`,
    manual: d ? "Definida por ti (a data não a altera)." : "Definida por ti."
  }[r.why];
  $("uAuto").classList.toggle("hide", !(r.why === "manual" && d));

  const res = $("res");
  let k = null;
  if(form.i === null){
    res.style.setProperty("--c", needI ? "var(--red)" : "var(--line)");
    res.innerHTML = needI
      ? `<b class="bad">Falta escolher a importância</b><br>Isto contribui para um objetivo teu? Escolhe 0 ou 1.`
      : `<b>Escolhe a importância</b><br>para ver o que fazer com isto.`;
  } else {
    k = quad(r.u, form.i);
    res.style.setProperty("--c", Q[k].c);
    res.innerHTML = `<b>${Q[k].n}</b><br>${Q[k].hint}`;
  }
  $("segI").classList.toggle("need", needI && form.i === null);
  // Campos extra: inputs fixos, só se mostram/escondem (o texto escrito nunca se perde).
  $("wWho").classList.toggle("hide", !(k === "delegate" || (form.i === 0 && $("fWho").value.trim())));
  $("wWhen").classList.toggle("hide", !(form.i === 1 && (k === "schedule" || $("fWhen").value)));
}
function openForm(it){
  editId = it ? it.id : null;
  $("dlgTitle").textContent = it ? "Editar" : "Nova entrada";
  $("fTitle").value = it?.title || "";
  $("fDate").value = it?.date || "";
  $("fGoal").value = it?.goal || "";
  $("fWho").value = it?.who || "";
  $("fWhen").value = it?.when || "";
  form = it ? {u:it.u ? 1 : 0, i:it.i ? 1 : 0, um:isManual(it)} : {u:0, i:null, um:false};
  needI = false;
  $("fDelete").classList.toggle("hide", !it);
  refreshForm();
  $("dlg").showModal();
  $("dlg").scrollTop = 0;
  snap = formState();
  // Ao editar não abrir o teclado: foco no título do painel.
  if(it) $("dlgTitle").focus(); else setTimeout(() => $("fTitle").focus(), 50);
}
function tryCloseForm(){
  if(formState() !== snap && !confirm("Descartar as alterações?")) return;
  closeDlg($("dlg"));
}
$("btnAdd").onclick = () => openForm(null);
$("fCancel").onclick = tryCloseForm;
$("dlg").addEventListener("cancel", e => { e.preventDefault(); tryCloseForm(); });
$("dlg").addEventListener("click", e => { if(e.target === $("dlg")) tryCloseForm(); }); // toque no fundo escuro
$("segU").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; form.u = +b.dataset.v; form.um = true; refreshForm(); });
$("segI").addEventListener("click", e => { const b = e.target.closest("button"); if(!b) return; form.i = +b.dataset.v; refreshForm(); });
$("uAuto").onclick = () => { form.um = false; refreshForm(); };
for(const ev of ["input", "change"]){
  $("fDate").addEventListener(ev, () => { form.um = false; refreshForm(); }); // mudar a data volta ao automático
  $("fWhen").addEventListener(ev, refreshForm);
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const title = $("fTitle").value.trim();
  if(!title){ $("fTitle").value = ""; $("fTitle").reportValidity(); return; }
  if(form.i === null){ needI = true; refreshForm(); $("segI").scrollIntoView({block:"center", behavior:"smooth"}); return; }
  const r = formUrg(), now = Date.now();
  const data = {
    title, date:$("fDate").value || "", goal:$("fGoal").value.trim(),
    u: form.um ? form.u : r.u, um: form.um, i: form.i,
    who: form.i === 0 ? $("fWho").value.trim() : "",
    when: form.i === 1 ? $("fWhen").value || "" : "",
    upd: now
  };
  const ix = editId ? state.items.findIndex(x => x.id === editId) : -1;
  if(ix >= 0 && !state.items[ix].deleted) Object.assign(state.items[ix], data);
  else state.items.push(Object.assign({id:editId || uid(), created:now, done:false}, data));
  save(); render(); closeDlg($("dlg"));
});
$("fDelete").onclick = () => {
  if(!editId || !confirm("Apagar esta entrada?")) return;
  const ix = state.items.findIndex(x => x.id === editId);
  if(ix >= 0) state.items[ix] = {id:editId, deleted:true, upd:Date.now()};
  save(); render(); closeDlg($("dlg"));
};

/* ---------- definições ---------- */
let daysDirty = false;
function showDays(){ if(!daysDirty) $("sDays").value = state.days; }
function openMenu(){
  daysDirty = false; showDays();
  $("sBadge").checked = !!prefs.badge;
  fillGh(); setFoot();
  $("dlgMenu").showModal();
  $("mTitle").focus();
}
function applyDays(){
  if(!daysDirty) return; // só aplica o que o utilizador escreveu (não um valor antigo no campo)
  daysDirty = false;
  const v = $("sDays").value.trim(), n = v === "" ? NaN : Number(v); // campo vazio não é 0
  if(!validDays(n)){ $("sDays").value = state.days; toast("Usa um número entre 0 e 365"); return; }
  if(n !== state.days){ state.days = n; state.daysUpd = Date.now(); save(); render(); }
}
$("btnMenu").onclick = openMenu;
$("bClose").onclick = () => closeDlg($("dlgMenu"));
$("sDays").addEventListener("input", () => { daysDirty = true; });
$("sDays").addEventListener("change", applyDays);
$("dlgMenu").addEventListener("close", applyDays); // Esc / voltar também guardam
$("dlgMenu").addEventListener("click", e => { if(e.target === $("dlgMenu")) closeDlg($("dlgMenu")); });
if("setAppBadge" in navigator) $("wBadge").classList.remove("hide");
$("sBadge").onchange = async () => {
  prefs.badge = $("sBadge").checked; savePrefs();
  if(prefs.badge && "Notification" in window && Notification.permission === "default"){
    try{ await Notification.requestPermission(); }catch(e){}
  }
  render();
};
$("bExport").onclick = async () => {
  const name = "prioridades-" + localISO() + ".json";
  const data = {v:1, days:state.days, daysUpd:state.daysUpd, items:state.items.filter(x => !x.deleted)};
  const file = new File([JSON.stringify(data, null, 2)], name, {type:"application/json"});
  // No telemóvel (sobretudo iPhone com a app instalada) a partilha é mais fiável do que descarregar.
  if(matchMedia("(pointer:coarse)").matches && navigator.canShare?.({files:[file]})){
    try{ await navigator.share({files:[file], title:"Prioridades — cópia"}); return; }
    catch(err){ if(err.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("bImport").onclick = () => $("fileIn").click();
$("fileIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if(!f) return;
  let s;
  try{ s = JSON.parse(await f.text()); }catch(err){ toast("Ficheiro inválido (não é JSON)"); return; }
  if(!s || !Array.isArray(s.items)){ toast("Ficheiro inválido: não tem lista de tarefas"); return; }
  const incoming = cleanList(s.items).filter(x => !x.deleted);
  if(!confirm(`Substituir os dados atuais pelas ${incoming.length} entradas da cópia importada?`)) return;
  const now = Date.now();
  incoming.forEach(x => x.upd = now);
  const ids = new Set(incoming.map(x => x.id));
  const gone = state.items.filter(x => !ids.has(x.id)).map(x => ({id:x.id, deleted:true, upd:now}));
  state.items = [...incoming, ...gone];
  if(validDays(s.days)){ state.days = s.days; state.daysUpd = now; }
  save(); render(); closeDlg($("dlgMenu"));
  toast(`Importado: ${incoming.length} entradas`);
};

/* ---------- sincronização GitHub ---------- */
let gh = (() => { try{ return JSON.parse(localStorage.getItem(GK)) || {}; }catch(e){ return {}; } })();
const ghOn = () => !!(gh.repo && gh.token);
let syncing = false, again = false, timer = null;
function saveGh(){ try{ localStorage.setItem(GK, JSON.stringify(gh)); }catch(e){} }
const enc = s => btoa(unescape(encodeURIComponent(s)));
const dec = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
function setFoot(){
  $("mFoot").textContent = ghOn()
    ? `Sincronizado com o GitHub (${gh.repo}). "Exportar cópia" guarda um ficheiro extra de segurança.`
    : `Os dados ficam só neste dispositivo. Liga o GitHub acima ou usa "Exportar cópia" para teres uma cópia de segurança.`;
}
function setStatus(st, msg){
  const b = $("btnSync");
  b.className = "iconbtn " + (st === "ok" ? "ok" : st === "err" ? "bad" : "");
  b.textContent = st === "busy" ? "⟳" : st === "ok" ? "☁✓" : st === "err" ? "☁!" : "☁";
  b.title = msg || "";
  b.setAttribute("aria-label", "Sincronizar" + (msg ? " — " + msg : ""));
  const g = $("gMsg");
  g.textContent = st === "off" ? "Não ligado." : (msg || "");
  g.className = "hint " + (st === "err" ? "bad" : st === "ok" ? "ok" : "");
  setFoot();
}
function errMsg(code){
  return code === 401 ? "Token inválido ou expirado"
       : code === 403 ? "Sem permissão (o token precisa de Contents: Read and write)"
       : code === 404 ? "Repositório não encontrado ou token sem acesso a ele"
       : "Erro do GitHub (" + code + ")";
}
function api(method, body){
  const url = "https://api.github.com/repos/" + gh.repo + "/contents/" + encodeURI(gh.path || "tasks.json");
  return fetch(url + (method === "GET" ? "?t=" + Date.now() : ""), {
    method, cache:"no-store",
    headers:{Authorization:"Bearer " + gh.token, Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28"},
    body: body ? JSON.stringify(body) : undefined
  });
}
function parseRemote(text){
  const j = JSON.parse(text);
  return {items: cleanList(j && j.items), days: validDays(j?.days) ? j.days : null, daysUpd: num(j?.daysUpd)};
}
function scheduleSync(){ if(!ghOn()) return; clearTimeout(timer); timer = setTimeout(sync, 1200); }
async function sync(){
  if(!ghOn()){ setStatus("off"); return; }
  if(syncing){ again = true; return; }
  if(!navigator.onLine){ setStatus("err", "Sem rede. Fica guardado neste dispositivo."); return; }
  syncing = true; setStatus("busy", "A sincronizar…");
  try{
    if(housekeep(true)) render();
    let done = false;
    for(let n = 0; n < 3 && !done; n++){
      const r = await api("GET");
      let sha = null, remote = {items:[], days:null, daysUpd:0};
      if(r.status === 200){
        const j = await r.json(); sha = j.sha;
        try{ remote = parseRemote(dec(j.content || "")); }
        catch(e){ throw new Error("O ficheiro no GitHub não é JSON válido — corrige-o ou muda o nome do ficheiro"); }
      } else if(r.status !== 404) throw new Error(errMsg(r.status));
      const items = merge(state.items, remote.items);
      let days = state.days, daysUpd = state.daysUpd;
      if(remote.days !== null && remote.daysUpd > daysUpd){ days = remote.days; daysUpd = remote.daysUpd; }
      if(canon(items) !== canon(state.items) || days !== state.days || daysUpd !== state.daysUpd){
        state.items = items; state.days = days; state.daysUpd = daysUpd; save(true); render(); showDays();
      }
      if(sha && canon(items) === canon(remote.items) && remote.days === days && remote.daysUpd === daysUpd){ done = true; break; }
      const p = await api("PUT", {message:"Prioridades: atualização", content:enc(JSON.stringify({v:1, days, daysUpd, items}, null, 1)), ...(sha ? {sha} : {})});
      if(p.ok){ done = true; break; }
      if(p.status === 409 || p.status === 422) continue;
      throw new Error(errMsg(p.status));
    }
    if(!done) throw new Error("Conflito repetido. Tenta de novo.");
    setStatus("ok", "Sincronizado às " + new Date().toLocaleTimeString("pt-PT", {hour:"2-digit", minute:"2-digit"}));
  }catch(e){
    setStatus("err", e instanceof TypeError ? "Sem rede. Fica guardado neste dispositivo." : e.message);
  }finally{
    syncing = false; if(again){ again = false; setTimeout(sync, 300); }
  }
}
function fillGh(){
  $("gRepo").value = gh.repo || ""; $("gPath").value = gh.path || ""; $("gToken").value = "";
  $("gToken").placeholder = gh.token ? "•••• guardado (vazio = manter)" : "github_pat_…";
}
$("gSave").onclick = () => {
  const repo = $("gRepo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const token = $("gToken").value.trim() || gh.token || "";
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo)){ setStatus("err", "Repositório no formato utilizador/nome"); return; }
  if(!token){ setStatus("err", "Falta o token"); return; }
  gh = {repo, path:$("gPath").value.trim().replace(/^\/+/, "") || "tasks.json", token};
  saveGh(); fillGh(); sync();
};
$("gOff").onclick = () => { gh = {}; saveGh(); setStatus("off"); fillGh(); };
$("btnSync").onclick = () => { if(ghOn()) sync(); else openMenu(); };

/* ---------- arranque e atualização diária ---------- */
let lastDay = today().getTime();
function tick(){ lastDay = today().getTime(); housekeep(); render(); }
document.addEventListener("visibilitychange", () => { if(!document.hidden){ tick(); sync(); } });
setInterval(() => { if(today().getTime() !== lastDay) tick(); }, 60e3); // passa a meia-noite com a app aberta
addEventListener("online", () => sync());

housekeep();
render();
setStatus("off");
if(ghOn()) sync();
if("serviceWorker" in navigator){
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
