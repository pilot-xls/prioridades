const CACHE = "prioridades-v4";
const FILES = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const TIMEOUT = 3000; // com rede fraca, ao fim de 3 s mostra a cópia guardada
let slowUntil = 0;     // depois de um timeout, os pedidos seguintes usam logo a cópia (sem esperar mais 3 s cada)

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (apanha atualizações), com limite de tempo; cache como reserva offline.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== location.origin) return; // nunca guardar chamadas ao GitHub em cache
  const nav = req.mode === "navigate";
  const network = fetch(req);
  // Só guarda respostas boas: um 404/500 nunca substitui a cópia que funciona.
  const update = network.then(res => {
    if (!res.ok || res.type !== "basic") return;
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy));
  }).catch(() => {});
  e.waitUntil(update); // a atualização da cache termina mesmo que já tenha respondido com a cópia
  const fromCache = () => caches.match(req, { ignoreSearch: nav })
    .then(r => r || (nav ? caches.match("./index.html") : undefined));

  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => { slowUntil = Date.now() + 15000; fromCache().then(finish); }, Date.now() < slowUntil ? 0 : TIMEOUT);
    network.then(
      res => {
        slowUntil = 0;
        if (res.ok || !nav) { clearTimeout(timer); return finish(res); }
        return fromCache().then(r => { clearTimeout(timer); finish(r || res); });
      },
      () => fromCache().then(r => { clearTimeout(timer); finish(r || Response.error()); })
    );
  }));
});
