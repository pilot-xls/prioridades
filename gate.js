'use strict';
// Primeira janela: só deixa passar se a app estiver instalada (modo "standalone").
(function () {
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const installed = ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
    .some(m => window.matchMedia('(display-mode: ' + m + ')').matches) || navigator.standalone === true;

  if (installed) {
    app.classList.remove('hidden');
    const scripts = ['lib.js', 'pwa-api.js', 'app.js'];
    for (const src of scripts) {
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // mantém a ordem
      document.body.append(s);
    }
    return;
  }

  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const mac = /Macintosh/.test(ua) && !ios;
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|CriOS|FxiOS/.test(ua);

  const steps = {
    ios: ['Abra esta página no <b>Safari</b>.', 'Toque em <b>Partilhar</b> (o quadrado com a seta).', 'Escolha <b>Adicionar ao ecrã principal</b> e confirme.', 'Abra a <b>Tarefas</b> pelo ícone novo.'],
    android: ['No <b>Chrome</b>, toque em <b>Instalar app</b> (abaixo) ou no menu ⋮ e em <b>Instalar aplicação</b>.', 'Confirme a instalação.', 'Abra a <b>Tarefas</b> pelo ícone novo.'],
    macSafari: ['No Safari, abra o menu <b>Ficheiro</b>.', 'Escolha <b>Adicionar ao Dock…</b> e confirme.', 'Abra a <b>Tarefas</b> pelo Dock ou pelo Launchpad.'],
    desktop: ['Clique em <b>Instalar app</b> (abaixo) ou no ícone de instalar na barra de endereço do Chrome ou Edge.', 'Confirme a instalação.', 'Abra a <b>Tarefas</b> pelo ícone novo.']
  };
  const main = ios ? 'ios' : android ? 'android' : (mac && safari) ? 'macSafari' : 'desktop';
  const labels = { ios: 'iPhone / iPad', android: 'Android', macSafari: 'Mac (Safari)', desktop: 'Computador (Chrome / Edge)' };
  const list = k => '<ol>' + steps[k].map(x => '<li>' + x + '</li>').join('') + '</ol>';
  const others = Object.keys(steps).filter(k => k !== main)
    .map(k => '<details><summary>' + labels[k] + '</summary>' + list(k) + '</details>').join('');

  gate.innerHTML =
    '<div class="box">' +
    '<img src="icons/icon-192.png" alt="">' +
    '<h1>Instale a app para continuar</h1>' +
    '<p>A Tarefas só funciona depois de instalada neste dispositivo.</p>' +
    list(main) +
    '<button id="install" class="primary big hidden">Instalar app</button>' +
    '<p id="gate-msg">Já instalou? Abra a Tarefas pelo ícone, não por esta página.</p>' +
    others +
    '</div>';
  gate.classList.remove('hidden');

  let deferred = null;
  const btn = document.getElementById('install');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    btn.classList.remove('hidden');
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    document.getElementById('gate-msg').textContent = 'Instalada. Abra a Tarefas pelo ícone no seu dispositivo.';
    btn.classList.add('hidden');
  });
})();
