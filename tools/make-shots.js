// Generate the PWA manifest screenshots (wide + narrow) by actually loading
// the game in headless Chromium, starting a rally, and capturing the cabinet.
//
//   NODE_PATH=/home/lars/.hermes/hermes-agent/node_modules node tools/make-shots.js
//
// Writes screenshots/wide-1280x800.png and screenshots/narrow-720x1280.png —
// the exact files/labels declared in manifest.json.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function makeServer() {
  return http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(ROOT, path.normalize(urlPath));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

// Drive a real rally so the shot shows the ball in flight, paddles and scores —
// not just the title card. Let it play a couple of seconds; the CPU takes a few
// points on a fresh serve, which is the most representative frame.
async function play(page, seconds) {
  await page.keyboard.press('Space');           // start game from the title
  await page.waitForTimeout(1000);              // serve delay, ball appears
  for (let i = 0; i < seconds; i += 0.1) {
    const up = Math.floor(i * 3) % 2 === 0;
    await page.keyboard.down(up ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.up(up ? 'ArrowUp' : 'ArrowDown');
  }
}

async function main() {
  const server = makeServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const targets = [
    { name: 'wide-1280x800.png', width: 1280, height: 800 },
    { name: 'narrow-720x1280.png', width: 720, height: 1280 },
  ];
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.width, height: t.height } });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await play(page, 3.5);
    await page.screenshot({ path: path.join(OUT, t.name) });
    await page.close();
    console.log('wrote', t.name);
  }
  await browser.close();
  server.close();
}

main().catch((err) => { console.error('screenshot generation failed:', err); process.exit(1); });