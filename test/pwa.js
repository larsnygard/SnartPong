// PWA test: the manifest, the service worker and the page must agree with each
// other and with what is actually on disk. Nothing here needs a browser; it
// catches the failure modes that make an "installable" app not install, or make
// it install and then serve an empty cache:
//
//   * a precache URL that does not exist  -> add() rejects, and the worker
//     activates with a cache it never filled
//   * an asset the page loads but the worker never caches -> no offline support
//   * a manifest icon whose declared size is not the size of the PNG on disk
//   * an absolute URL (/app.css) -> installs fine at a domain root, 404s under
//     snart.com/pong/ where this game actually lives
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = 'manifest.json';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const indexHtml = read('index.html');
const sw = read('sw.js');
const manifestRaw = read(MANIFEST);

// ---- manifest ---------------------------------------------------------------
let manifest = null;
try { manifest = JSON.parse(manifestRaw); } catch (e) { /* reported below */ }
check(MANIFEST + ' parses as JSON', manifest !== null);
if (!manifest) { console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(1); }

check('manifest has name and short_name',
  typeof manifest.name === 'string' && manifest.name.length > 0 &&
  typeof manifest.short_name === 'string' && manifest.short_name.length > 0);
check('short_name fits an Android launcher (<13 chars)',
  manifest.short_name.length <= 12, 'short_name is ' + manifest.short_name.length + ' chars');
check('manifest has a description', typeof manifest.description === 'string' && manifest.description.length > 40);
check('display is standalone', manifest.display === 'standalone');
check('theme_color and background_color are hex colours',
  /^#[0-9a-f]{6}$/i.test(manifest.theme_color || '') &&
  /^#[0-9a-f]{6}$/i.test(manifest.background_color || ''));
check('lang is set', typeof manifest.lang === 'string' && manifest.lang.length > 0);

// Relative start_url/scope: the game is served from a subpath, not a root.
const relative = (u) => typeof u === 'string' && u.length > 0 && !u.startsWith('/') && !/^[a-z]+:/i.test(u);
check('start_url is relative (works under a subpath)', relative(manifest.start_url), 'start_url=' + manifest.start_url);
check('scope is relative (works under a subpath)', relative(manifest.scope), 'scope=' + manifest.scope);
check('start_url is inside scope', (manifest.start_url || '').replace(/^\.\//, '').startsWith(
  (manifest.scope || '').replace(/^\.\//, '')));

// ---- icons ------------------------------------------------------------------
function pngSize(file) {
  const head = fs.readFileSync(path.join(ROOT, file)).subarray(0, 24);
  if (head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return head.readUInt32BE(16) + 'x' + head.readUInt32BE(20);
}
const icons = manifest.icons || [];
const purposeAny = icons.filter((i) => (i.purpose || 'any') === 'any');
const purposeMaskable = icons.filter((i) => (i.purpose || '') === 'maskable');
check('manifest declares 192px and 512px "any" icons',
  purposeAny.some((i) => i.sizes === '192x192') && purposeAny.some((i) => i.sizes === '512x512'));
check('manifest declares a maskable 512px icon',
  purposeMaskable.some((i) => i.sizes === '512x512'));

check('every manifest icon exists on disk',
  icons.every((i) => exists(i.src)), icons.filter((i) => !exists(i.src)).map((i) => i.src).join(', '));
const sizeMismatch = icons.filter((i) => exists(i.src) && pngSize(i.src) !== i.sizes);
check('every declared icon size matches the PNG on disk',
  sizeMismatch.length === 0,
  sizeMismatch.map((i) => i.src + ' declares ' + i.sizes + ' but is ' + pngSize(i.src)).join('; '));
check('every manifest icon is image/png', icons.every((i) => i.type === 'image/png'));
check('manifest icon paths are relative',
  icons.every((i) => !i.src.startsWith('/')), icons.filter((i) => i.src.startsWith('/')).map((i) => i.src).join(', '));

// Screenshots drive the richer install dialog on Android. They are deliberately
// NOT precached: they are only ever fetched by the browser while online.
const shots = manifest.screenshots || [];
check('manifest declares narrow and wide screenshots',
  shots.some((s) => s.form_factor === 'narrow') && shots.some((s) => s.form_factor === 'wide'));
check('every screenshot exists on disk',
  shots.length > 0 && shots.every((s) => exists(s.src)),
  shots.filter((s) => !exists(s.src)).map((s) => s.src).join(', '));
check('every screenshot is a PNG whose real size matches the declared size',
  shots.every((s) => exists(s.src) && pngSize(s.src) === s.sizes && s.type === 'image/png'),
  shots.filter((s) => exists(s.src) && pngSize(s.src) !== s.sizes)
    .map((s) => s.src + ' declares ' + s.sizes + ' but is ' + pngSize(s.src)).join('; '));
check('every screenshot has a label and a relative path',
  shots.every((s) => typeof s.label === 'string' && s.label.length > 0 && !s.src.startsWith('/')));

// iOS installs from an apple-touch-icon, not from the manifest.
const appleIcon = (indexHtml.match(/<link[^>]+rel="apple-touch-icon"[^>]*href="([^"]+)"/) || [])[1];
check('index.html links an apple-touch-icon', !!appleIcon);
check('apple-touch-icon file exists', !!appleIcon && exists(appleIcon), appleIcon);

// ---- what the page actually loads -------------------------------------------
const pageAssets = new Set();
for (const m of indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)) pageAssets.add(m[1]);
for (const m of indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)) {
  const url = m[1];
  if (!/^https?:|^data:/i.test(url)) pageAssets.add(url);
}
check('every local asset index.html loads exists',
  [...pageAssets].every((u) => exists(u)),
  [...pageAssets].filter((u) => !exists(u)).join(', '));
check('index.html links the manifest',
  new RegExp('<link[^>]+rel="manifest"[^>]+href="' + MANIFEST.replace('.', '\\.') + '"').test(indexHtml));
check('index.html sets theme-color',
  /<meta[^>]+name="theme-color"[^>]+content="#[0-9a-f]{6}"/i.test(indexHtml));
check('index.html sets apple-mobile-web-app-capable for iOS install',
  /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/.test(indexHtml));
check('index.html registers sw.js',
  /serviceWorker\.register\(\s*['"]sw\.js['"]\s*\)/.test(indexHtml));
check('service worker registration is guarded on isSecureContext',
  /window\.isSecureContext/.test(indexHtml), 'registration must not throw on file://');
check('sw.js exists', exists('sw.js'));

// ---- precache list vs the page ---------------------------------------------
const listMatch = sw.match(/const PRECACHE\s*=\s*\[([\s\S]*?)\];/);
check('sw.js declares a PRECACHE list', !!listMatch);
const precache = listMatch ? [...listMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)]
  .map((m) => m[1] || m[2]) : [];
check('sw.js has a versioned cache name', /const CACHE\s*=\s*`snartpong-\$\{VERSION\}`/.test(sw) &&
  /const VERSION\s*=\s*'v\d+'/.test(sw));

// A URL that 404s is the whole cache, not one missing file.
const missing = precache.filter((u) => {
  const clean = u.replace(/^\.\//, '');
  return clean === '' ? false : !exists(clean);
});
check('every precached URL exists on disk', missing.length === 0, missing.join(', '));

const notPrecached = [...pageAssets].filter(
  (u) => !precache.includes(u) && !precache.includes(u.replace(/^\.\//, '')));
check('every asset the page loads is precached', notPrecached.length === 0, notPrecached.join(', '));

// The navigation document must be there too, as './' or 'index.html'.
check('index.html is precached (as ./ or index.html)',
  precache.includes('./') || precache.includes('index.html'));
// Icons matter: an installed app that cannot draw its own launcher icon offline.
const iconNotPrecached = icons.map((i) => i.src).filter((src) => !precache.includes(src));
check('every manifest icon is precached', iconNotPrecached.length === 0, iconNotPrecached.join(', '));
check(MANIFEST + ' is precached', precache.includes(MANIFEST));

check('precache URLs are all relative', precache.every(relative), precache.filter((u) => !relative(u)).join(', '));
check('precache list has no duplicate entries', new Set(precache).size === precache.length);

// ---- worker behaviour -------------------------------------------------------
check('sw.js handles install, activate and fetch',
  /addEventListener\('install'/.test(sw) && /addEventListener\('activate'/.test(sw) &&
  /addEventListener\('fetch'/.test(sw));
check('fetch handler is registered for every GET navigation',
  /event\.respondWith\(/.test(sw) && /request\.mode === 'navigate'/.test(sw));
check('precache uses allSettled, not addAll', /Promise\.allSettled\(/.test(sw) && !/cache\.addAll\(/.test(sw),
  'addAll is atomic: one bad URL empties the whole cache');
check('activate deletes caches with a different name', /caches\.delete\(key\)/.test(sw));
check('activate claims open clients', /clients\.claim\(\)/.test(sw));
check('cached responses are matched ignoring the query string',
  /ignoreSearch:\s*true/.test(sw), 'versioned URLs (?v=2) would otherwise never hit');
check('cross-origin requests are left to the network',
  /url\.origin !== self\.location\.origin/.test(sw));
check('non-GET requests are not intercepted', /request\.method !== 'GET'/.test(sw));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);