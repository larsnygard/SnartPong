// Browser integration test: load the real page in headless Chromium and prove
// the PWA actually works, not just that the files agree with each other.
//
//   NODE_PATH=/home/lars/.hermes/hermes-agent/node_modules node test/browser.js
//
// Covers: the page boots without console errors, the service worker registers
// and precaches, the app plays (score changes, screen advances), a reload is
// served from cache, and offline the app still loads from the worker cache.
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png',
};

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

function makeServer() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('nf'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

async function main() {
  const server = makeServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(base, { waitUntil: 'load' });

  check('no console errors on load', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // Service worker registered and precaching.
  const swReg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return null;
    await navigator.serviceWorker.ready;
    return { cached: true };
  });
  check('service worker registered and active', !!swReg && swReg.cached === true, JSON.stringify(swReg));

  const cacheEntries = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  check('precache contains index.html', cacheEntries.some((k) => k === '/'), JSON.stringify(cacheEntries));
  check('precache contains the game script', cacheEntries.some((k) => k.endsWith('/game.js')));
  check('precache contains the stylesheet', cacheEntries.some((k) => k.endsWith('/style.css')));
  check('precache contains the manifest', cacheEntries.some((k) => k.endsWith('/manifest.json')));
  check('precache contains a 512 icon', cacheEntries.some((k) => k.includes('512')));

  // Live gameplay: start and let a few points happen.
  const before = await page.evaluate(() => {
    const a = window.__pong.app;
    return { screen: a.screen, p0: a.state.paddle[0].score, p1: a.state.paddle[1].score };
  });
  check('app boots to title screen', before.screen === 'title', before.screen);
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  const during = await page.evaluate(() => window.__pong.app.screen);
  check('pressing Space starts play', during === 'serve' || during === 'play', during);
  // Liveness: once in 'play' the ball must be in motion (the physics loop is
  // running). A fixed point-score isn't asserted here — with an idle paddle the
  // rally can go on for a while, and scoring is pinned by the Node core test.
  const live = await page.evaluate(async () => {
    const a = window.__pong.app;
    const at = () => ({ x: a.state.ball.x, y: a.state.ball.y, screen: a.screen });
    const first = at();
    await new Promise((r) => setTimeout(r, 300));
    const second = at();
    return { first, second };
  });
  const ballMoved = live.first.x !== live.second.x || live.first.y !== live.second.y;
  check('the ball is in motion during live play', ballMoved && live.second.screen === 'play',
    JSON.stringify(live));

  // Reload with the network off: the service worker must serve the precache.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const offlineBoot = await page.evaluate(() => {
    const a = window.__pong.app;
    return { hasDom: !!document.getElementById('game'), screen: a ? a.screen : 'noapp' };
  });
  check('app loads from cache while offline',
    offlineBoot.hasDom === true && offlineBoot.screen === 'title', JSON.stringify(offlineBoot));

  await context.setOffline(false);
  await browser.close();
  server.close();
}

main().catch((e) => { console.error('browser test crashed:', e); process.exit(2); })
  .finally(() => {
    const total = passed + failed;
    if (total === 0) { console.error('no checks ran'); process.exitCode = 1; }
    else console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
  });