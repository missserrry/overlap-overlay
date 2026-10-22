// Рендер панели для критиков: снимает окно панели (через DevTools-протокол) по разделам.
// Запуск: приложение с --remote-debugging-port=9333, затем  node design/render.js <папка> [разделы...]
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'design/renders');
const views = process.argv.slice(3).length ? process.argv.slice(3) : ['overlays', 'layouts', 'liveries', 'settings'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const t = targets.find((x) => x.url.includes('/panel/'));
  if (!t) throw new Error('окно панели не найдено');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const wait = new Map();
  ws.on('message', (m) => { const d = JSON.parse(m); if (wait.has(d.id)) { wait.get(d.id)(d.result); wait.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  // WINDOW=1 — снимок окна с экрана (с системными кнопками), иначе — только содержимое страницы
  const shot = async (file) => {
    if (process.env.WINDOW === '1') {
      const res = require('child_process').execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'capture-window.ps1'), '-Out', path.join(out, file)], { encoding: 'utf8' });
      console.log(res.trim());
      return;
    }
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, file), Buffer.from(r.data, 'base64'));
    console.log('saved', file);
  };
  fs.mkdirSync(out, { recursive: true });

  // всегда снимаем свежую версию страницы
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await sleep(2500);

  for (const v of views) {
    if (v === 'motion') {
      // подпись движения: кадры переезда индикатора. Снимок дольше самой анимации (180 мс),
      // поэтому воспроизведение замедлено в 20 раз штатным Animation.setPlaybackRate: кадр N мс = N×20 мс реального времени
      await ev(`document.querySelector('.rail-btn[data-view=overlays]').click()`);
      await sleep(600);
      await send('Animation.enable');
      await send('Animation.setPlaybackRate', { playbackRate: 0.05 });
      await ev(`(()=>{const rows=[...document.querySelectorAll('#ovList .row[data-ov]')];const cur=rows.findIndex(r=>r.classList.contains('on'));rows[(cur+1)%rows.length]?.click()})()`);
      const t0 = Date.now();
      for (const ms of [0, 30, 60, 90, 200]) {
        const wait = ms * 20 - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        await shot(`motion-${ms}ms.png`);
      }
      await send('Animation.setPlaybackRate', { playbackRate: 1 });
      continue;
    }
    await ev(`document.querySelector('.rail-btn[data-view=${v}]').click()`);
    await sleep(900);
    await shot(`${v}.png`);
  }
  ws.close();
})().catch((e) => { console.error(e); process.exit(1); });
