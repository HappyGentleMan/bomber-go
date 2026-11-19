#!/usr/bin/env node
/**
 * Build BOMBER GO and publish it atomically.
 *
 *  1. typecheck (tsc --noEmit) — a broken build never replaces the live site
 *  2. vite build → dist/
 *  3. copy dist/ → deploy/releases/<stamp>-<sha>/
 *  4. write version.json + inject the "new version" nudge into that copy
 *  5. atomically swap deploy/current → the new release
 *  6. prune old releases (keep 5)
 *
 * Caddy serves deploy/current, so the swap is the deploy.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const deployDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(deployDir)
const logsDir = path.join(deployDir, 'logs')
const logFile = path.join(logsDir, 'deploy.log')
// Published copies live outside ~/Documents on purpose: the public Caddy instance
// runs as root, and macOS TCC blocks root from reading ~/Documents (403s).
const serveDir = process.env.BOMBERGO_SERVE_DIR || path.join(os.homedir(), 'srv', 'bomber-go')
const releasesDir = path.join(serveDir, 'releases')
const KEEP = 5

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    fs.appendFileSync(logFile, line + '\n')
  } catch {}
}

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  if (r.status !== 0) {
    log(`FAILED: node ${args.join(' ')} (exit ${r.status})`)
    const tail = (s) => (s || '').trim().split('\n').slice(-20).join('\n')
    if (r.stdout) log(tail(r.stdout))
    if (r.stderr) log(tail(r.stderr))
  }
  return r.status === 0
}

function sh(args) {
  const r = spawnSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' })
  return r.status === 0 ? (r.stdout || '').trim() : ''
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const sha = sh(['git', 'rev-parse', '--short', 'HEAD']) || 'nogit'
const dirty = sh(['git', 'status', '--porcelain', '--', 'src', 'index.html', 'public']) !== ''
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace('T', '-')
  .slice(0, 15) // YYYYMMDD-HHMMSS
const id = `${stamp}-${sha}${dirty ? '-dirty' : ''}`
const version = `${pkg.version}+${stamp}.${sha}${dirty ? '.dirty' : ''}`

log(`building ${version}`)

if (!run([path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'])) {
  log('typecheck failed — live site left untouched')
  process.exit(1)
}
if (!run([path.join(root, 'node_modules/vite/bin/vite.js'), 'build'])) {
  log('vite build failed — live site left untouched')
  process.exit(1)
}

const releaseDir = path.join(releasesDir, id)
fs.mkdirSync(releasesDir, { recursive: true })
fs.rmSync(releaseDir, { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), releaseDir, { recursive: true })

const info = {
  version,
  name: pkg.name,
  sha,
  dirty,
  builtAt: stamp,
  builtAtISO: stamp.replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'),
}
fs.writeFileSync(path.join(releaseDir, 'version.json'), JSON.stringify(info, null, 2) + '\n')

// Unobtrusive "a new build is live" pill. Only shows after the page has been
// open across a deploy, and the reload is user-initiated (never mid-match).
const nudge = `<script>
(function () {
  var seen = null;
  function check() {
    fetch('version.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        if (!j || !j.version) return;
        if (seen === null) { seen = j.version; return; }
        if (j.version !== seen) show();
      })
      .catch(function () {});
  }
  function show() {
    if (document.getElementById('bombergo-update')) return;
    var a = document.createElement('a');
    a.id = 'bombergo-update';
    a.href = location.pathname.replace(/index\\.html$/, '');
    a.textContent = '\\u27f3 New version ready \\u2014 tap to reload';
    a.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 16px;border-radius:999px;background:#ff3d68;color:#fff;font:600 13px/1 system-ui,sans-serif;' +
      'text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.45)';
    document.body.appendChild(a);
  }
  function boot() {
    check();                          // remember the version this page loaded
    setInterval(check, 30000);        // then watch for a newer deploy
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  if (document.readyState === 'complete') setTimeout(boot, 1500);
  else window.addEventListener('load', function () { setTimeout(boot, 1500); });
})();
</script>
`
const indexPath = path.join(releaseDir, 'index.html')
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8')
  fs.writeFileSync(indexPath, html.replace('</body>', nudge + '</body>'))
}

// atomic publish: rename over the old symlink
const current = path.join(serveDir, 'current')
const tmpLink = path.join(serveDir, `.current.${process.pid}`)
try { fs.unlinkSync(tmpLink) } catch {}
fs.symlinkSync(path.join('releases', id), tmpLink)
fs.renameSync(tmpLink, current)

// prune, newest first (ids sort chronologically)
const all = fs
  .readdirSync(releasesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .reverse()
for (const old of all.slice(KEEP)) {
  if (old === id) continue
  try {
    fs.rmSync(path.join(releasesDir, old), { recursive: true, force: true })
    log(`pruned release ${old}`)
  } catch {}
}

log(`live: ${id}`)
