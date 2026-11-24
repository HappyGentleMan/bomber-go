#!/usr/bin/env node
/**
 * BOMBER GO — one-shot Let's Encrypt cert for the 443 TURN SNI (deploy/tls-router.mjs).
 *
 * Why a script: this Caddy build has no `caddy certificate` command, and the
 * public Caddy runs as root (its cert storage is unreadable). So we talk to
 * the LE v2 JSON API directly and deliver the HTTP-01 challenge by briefly
 * adding a throwaway Caddy site via `caddy reload` (admin API 127.0.0.1:2019).
 *
 * Output: /Users/anson/.local/etc/bomber-go/turn-cert.pem + turn-key.pem
 * (PEM). Re-run any time; skips when the current cert has >30 days left.
 *
 * The same cert is also used by coturn's TLS listener on 5349.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const HOST = 'turn.bomber.119-247-94-77.sslip.io'
const LE = 'https://acme-v02.api.letsencrypt.org'
const LE_DIR_URL = `${LE}/directory`
const DIR = '/Users/anson/.local/etc/bomber-go'
const KEY_FILE = path.join(DIR, 'acme-key.json')
const ACCOUNT_FILE = path.join(DIR, 'acme-account.json')
const CERT_FILE = path.join(DIR, 'turn-cert.pem')
const PRIV_FILE = path.join(DIR, 'turn-key.pem')
const CHALLENGE_DIR = path.join(DIR, 'acme-challenge')
const CADDY_BIN = '/Users/anson/.local/bin/caddy'
const PUBLIC_CADDYFILE = '/Users/anson/.hermes/etc-from-vps/caddy/Caddyfile.public'
const TEMP_CADDYFILE = '/tmp/bomberggo-acme-caddyfile'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const log = (...a) => console.log('[turn-cert]', ...a)

// ---------- skip if the current cert is still good ----------

if (fs.existsSync(CERT_FILE)) {
  let days = -1
  const pem = fs.readFileSync(CERT_FILE, 'utf8')
  // The file is a PEM (possibly the full LE chain — several CERTIFICATE
  // blocks). A previous version regex-matched `notAfter =` TEXT output and
  // silently never skipped, burning LE quota on every re-run. Parse it:
  try {
    const x = new crypto.X509Certificate(pem)
    days = (x.validTo.getTime() - Date.now()) / 86_400_000
  } catch {
    // fall back to the first block, then to openssl
    try {
      const first = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0]
      if (first) days = (new crypto.X509Certificate(first).validTo.getTime() - Date.now()) / 86_400_000
    } catch {
      try {
        const out = execFileSync('openssl', ['x509', '-noout', '-enddate', '-in', CERT_FILE], { encoding: 'utf8' })
        const end = out.match(/notAfter=(.+)/)?.[1]
        if (end) days = (new Date(end.trim()).getTime() - Date.now()) / 86_400_000
      } catch { /* unparseable → re-issue */ }
    }
  }
  log(`current cert: ${days > 0 ? days.toFixed(0) + ' days left' : 'unparseable/missing'}`)
  if (days > 30) { log(`cert valid for ${days.toFixed(0)} more days — nothing to do`); process.exit(0) }
}

// ---------- key + JWK + thumbprint ----------

fs.mkdirSync(CHALLENGE_DIR, { recursive: true })
let priv
if (fs.existsSync(KEY_FILE)) {
  priv = crypto.createPrivateKey(JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')).pem)
} else {
  ({ privateKey: priv } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }))
  fs.writeFileSync(KEY_FILE, JSON.stringify({ pem: priv.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  log('generated new ACME key')
}
const jwk = crypto.createPublicKey(priv).export({ format: 'jwk' })
// RFC 7515 §3.2: exactly ["crv","kty","x","y"], no whitespace
const thumbprint = b64url(crypto.createHash('sha256')
  .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest())

let kid = fs.existsSync(ACCOUNT_FILE) ? JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')).kid : null

// ---------- minimal ACME v2 client ----------

const acme = {
  nonce: null,
  async refreshNonce() {
    const dir = await (await fetch(LE_DIR_URL)).json()
    const nr = await fetch(dir.newNonce, { method: 'HEAD' })
    this.nonce = nr.headers.get('Replay-Nonce')
    if (!this.nonce) throw new Error('no Replay-Nonce from LE')
  },
  noteNonce(res) {
    const n = res?.headers.get('Replay-Nonce')
    if (n) this.nonce = n
  },
  async post(url, payload) {
    await this.refreshNonce()
    const header = { alg: 'ES256', nonce: this.nonce, url, ...(kid ? { kid } : { jwk }) }
    const body = JSON.stringify({
      protected: b64url(JSON.stringify(header)),
      payload: b64url(JSON.stringify(payload ?? '')),
      signature: b64url(crypto.sign('sha256',
        Buffer.from(`${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload ?? ''))}`),
        { key: priv, dsaEncoding: 'ieee-p1363' })),
    })
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/jose+json' }, body })
    this.noteNonce(res)
    let json = null
    try { json = await res.json() } catch { /* 200s without a body */ }
    return { status: res.status, json, headers: res.headers, ok: res.ok }
  },
}

// ---------- 1. account ----------

if (!kid) {
  const dir = await (await fetch(LE_DIR_URL)).json()
  const r = await acme.post(dir.newAccount, { termsOfServiceAgreed: true })
  if (r.status === 200 || r.status === 201) {
    kid = r.headers.get('Location')
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({ kid }))
    log('ACME account registered:', kid)
  } else if (r.status === 409 && r.headers.get('Location')) {
    kid = r.headers.get('Location') // account already exists
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({ kid }))
  } else {
    throw new Error(`new-account failed: ${r.status} ${JSON.stringify(r.json)}`)
  }
}

// ---------- 2. order ----------

const dir2 = await (await fetch(LE_DIR_URL)).json()
const order = await acme.post(dir2.newOrder, { identifiers: [{ type: 'dns', value: HOST }] })
if (!order.ok) throw new Error(`new-order failed: ${order.status} ${JSON.stringify(order.json)}`)
const orderUrl = order.headers.get('Location')
let o = order.json

// ---------- 3. http-01 challenge ----------

const authzRes = await fetch(o.authorizations[0])
const authz = await authzRes.json()
const ch = authz.challenges.find((c) => c.type === 'http-01')
if (!ch) throw new Error('no http-01 challenge offered')
const keyAuth = `${ch.token}.${thumbprint}`
// ACME webroot layout: the file lives at <root>/.well-known/acme-challenge/<token>
const tokenPath = path.join(CHALLENGE_DIR, '.well-known', 'acme-challenge', ch.token)
fs.mkdirSync(path.dirname(tokenPath), { recursive: true })
fs.writeFileSync(tokenPath, keyAuth)
log('challenge token written; reloading Caddy with throwaway challenge site…')

// ---------- 4. deliver via temp Caddy site ----------

const extra = `\nhttp://${HOST} {\n\tbind 192.168.0.241\n\troot * ${CHALLENGE_DIR}\n\tfile_server\n}\n`
fs.writeFileSync(TEMP_CADDYFILE, fs.readFileSync(PUBLIC_CADDYFILE, 'utf8') + extra)
execFileSync(CADDY_BIN, ['reload', '--config', TEMP_CADDYFILE, '--adapter', 'caddyfile'], { stdio: 'inherit' })

try {
  // verify the challenge is ACTUALLY being served before submitting — LE
  // validates within seconds and will not survive a reload-window 404.
  // (curl, not node fetch: this Mac's network extension intercepts
  // non-loopback plain-HTTP node sockets and breaks them.)
  let live = false
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '5',
        '-H', `Host: ${HOST}`, `http://192.168.0.241/.well-known/acme-challenge/${ch.token}`],
        { encoding: 'utf8' }).trim()
      if (code === '200') { live = true; break }
    } catch { /* not up yet */ }
  }
  if (!live) throw new Error('challenge file not being served on :80 — aborting before submit')
  log('challenge file verified live, submitting…')

  const cr = await acme.post(ch.url, {})
  if (!cr.ok) throw new Error(`challenge respond failed: ${cr.status} ${JSON.stringify(cr.json)}`)
  log('challenge submitted, waiting for LE validation…')

  // ---------- 5. poll order until READY ----------
  // After the challenge validates the order sits in "ready" — it only
  // becomes "valid" AFTER we finalize it with a CSR (that missing step is
  // what made earlier runs hang polling for "valid" forever).
  let ready = false
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    o = await (await fetch(orderUrl)).json()
    if (o.status === 'ready' || o.status === 'valid') { ready = true; break }
    if (o.status === 'invalid') throw new Error(`order invalid: ${JSON.stringify(o)}`)
  }
  if (!ready) throw new Error('order never became ready (LE could not fetch the challenge)')
  log('order ready, finalizing with CSR…')

  // ---------- 6. finalize with a CSR ----------
  // Key separation: the ACME account key (`priv`) signs JWS requests only.
  // The CERTIFICATE gets its own dedicated EC key — that is the key that
  // ships as turn-key.pem and must match the cert's public key.
  const { privateKey: certKey, publicKey: certPub } =
    crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const tmpKey = path.join(DIR, 'turn-cert-tmp.key')
  const csrDer = '/tmp/bomberggo-turn.csr.der'
  fs.writeFileSync(tmpKey, certKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  try {
    // CN + SAN (SAN is mandatory — browsers ignore CN-only certs)
    execFileSync('openssl', ['req', '-new', '-key', tmpKey, '-subj', `/CN=${HOST}`,
      '-addext', `subjectAltName=DNS:${HOST}`, '-outform', 'DER', '-out', csrDer])

    const fr = await acme.post(o.finalize, { csr: fs.readFileSync(csrDer).toString('base64url') })
    if (!fr.ok) throw new Error(`finalize failed: ${fr.status} ${JSON.stringify(fr.json)}`)
    o = fr.json ?? o
    let valid = false
    for (let i = 0; i < 30 && o?.status !== 'valid'; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      o = await (await fetch(orderUrl)).json()
    }
    if (o.status !== 'valid') throw new Error('order not valid after finalize: ' + JSON.stringify(o).slice(0, 300))

    // ---------- 7. download cert, verify key match, THEN save ----------
    const certRes = await fetch(o.certificate)
    const pem = await certRes.text()
    if (!certRes.ok) throw new Error(`cert download failed: ${certRes.status}`)

    // cert ↔ key match BEFORE writing anything (the #1 silent failure mode
    // of this flow — a mismatched pair on disk breaks both services)
    const x509 = new crypto.X509Certificate(pem)
    const match = JSON.stringify(x509.publicKey.export({ format: 'jwk' })) ===
      JSON.stringify(certPub.export({ format: 'jwk' }))
    if (!match) throw new Error('CERT/KEY MISMATCH — refusing to save')

    fs.writeFileSync(CERT_FILE, pem, { mode: 0o644 })
    fs.writeFileSync(PRIV_FILE, certKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
    log(`cert issued for ${HOST} → ${CERT_FILE} (valid to ${x509.validTo})`)
    log('renewal complete — restart the services to pick up the new key:')
    log('  sudo launchctl kickstart -k system/com.anson.bomber-go-tls-router')
    log('  launchctl kickstart -k gui/$(id -u)/com.anson.bomber-turn')
  } finally {
    fs.rmSync(tmpKey, { force: true })
    fs.rmSync(csrDer, { force: true })
  }
} finally {
  // always restore the normal Caddy config, even on failure mid-issue
  execFileSync(CADDY_BIN, ['reload', '--config', PUBLIC_CADDYFILE, '--adapter', 'caddyfile'], { stdio: 'inherit' })
  fs.rmSync(tokenPath, { force: true })
  fs.rmSync(TEMP_CADDYFILE, { force: true })
  log('Caddy restored to normal config')
}
