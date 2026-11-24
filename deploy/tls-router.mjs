#!/usr/bin/env node
/**
 * BOMBER GO — 443 SNI router (the corporate-firewall last resort).
 *
 * Corporate firewalls/VPNs routinely allow exactly ONE outbound port:
 * 443/TCP. WebRTC relays normally live on 3478 (UDP/TCP) or 5349 — both
 * blocked there. This process owns 192.168.0.241:443 and splits by TLS SNI:
 *
 *   SNI turn.bomber.119-247-94-77.sslip.io
 *     → terminate TLS (LE cert) and pipe the PLAINTEXT TURN protocol to
 *       coturn's TCP listener (127.0.0.1:3478)
 *   everything else (bomber.*, git.*, forms.*, root)
 *     → raw byte-forward to Caddy (127.0.0.1:8443), which terminates TLS
 *       exactly as before — this router never sees the game's TLS
 *
 * The game's ICE config (src/net.ts) lists
 *   turns:turn.bomber.119-247-94-77.sslip.io:443?transport=tcp
 * as the last relay fallback, so a WebRTC call from a corporate network
 * rides a port-443 TLS stream the firewall can't tell from normal HTTPS.
 *
 * SNI is read by peeking at the TLS ClientHello (RFC 8446 §4.1.2) BEFORE
 * deciding — we cannot terminate-and-re-encrypt the passthrough traffic,
 * so non-TURN connections must stay raw bytes.
 *
 * Run by launchd: com.anson.bomber-go-tls-router
 */
import tls from 'node:tls'
import net from 'node:net'
import fs from 'node:fs'

const TURN_SNI = 'turn.bomber.119-247-94-77.sslip.io'
const CADDY = { host: '192.168.0.241', port: 8443 } // Caddy binds the LAN IP, not loopback
const COTURN = { host: '127.0.0.1', port: 3478 }
const CERT_PATH = '/Users/anson/.local/etc/bomber-go/turn-cert.pem'
const KEY_PATH = '/Users/anson/.local/etc/bomber-go/turn-key.pem'
const LISTEN = { host: '192.168.0.241', port: 443 }
const SNI_TIMEOUT_MS = 10_000
const MAX_HELLO = 16_384

const cert = fs.readFileSync(CERT_PATH)
const key = fs.readFileSync(KEY_PATH)

/**
 * Extract the SNI hostname from a TLS ClientHello, or null.
 * Record: [0x16, len:2] Handshake: [0x16, len:3] [ver:2] [random:32]
 *   [sessIdLen:1 + id] [ciphersLen:2 + data] [compLen:1 + data]
 *   [extsLen:2 + exts]; SNI ext type 0x0000: [listLen:2][nameType:1][nameLen:2][name]
 */
function sniFromHello(buf) {
  if (buf.length < 44 || buf[0] !== 0x16) return null
  let off = 5
  if (buf[off] !== 0x01) return null // 0x01 = ClientHello handshake type (0x16 is the RECORD type at [0])
  off += 4 + 2 + 32 // handshake hdr + version + random
  const sidLen = buf[off]; off += 1 + sidLen
  off += 2 + buf.readUInt16BE(off) // cipher suites
  off += 1 + buf[off] // compression methods
  if (off + 2 > buf.length) return null
  const extsLen = buf.readUInt16BE(off); off += 2
  const extsEnd = off + extsLen
  while (off + 4 <= extsEnd && off + 4 <= buf.length) {
    const type = buf.readUInt16BE(off)
    const len = buf.readUInt16BE(off + 2)
    off += 4
    if (type === 0x0000) {
      if (off + 5 > buf.length) return null
      const nameLen = buf.readUInt16BE(off + 3)
      return buf.toString('latin1', off + 5, off + 5 + nameLen).toLowerCase()
    }
    off += len
  }
  return null
}

/** bidirectional pipe with cleanup */
function pipePair(a, b) {
  a.pipe(b)
  b.pipe(a)
  const kill = () => { a.destroy(); b.destroy() }
  a.on('error', kill)
  b.on('error', kill)
  a.on('close', kill)
  b.on('close', kill)
}

const server = net.createServer((socket) => {
  socket.setNoDelay(true)
  // PAUSE the socket and read() the first record manually, then unshift()
  // it back before handing the stream to a TLSSocket or the passthrough.
  // (Wrapping a socket that already consumed data via 'data' events leaves
  // the TLSSocket unable to start its handshake — verified by repro.)
  socket.pause()
  let buf = Buffer.alloc(0)
  let done = false
  const to = setTimeout(() => {
    if (!done) { console.log('[router] SNI timeout, dropping', socket.remoteAddress); socket.destroy() }
  }, SNI_TIMEOUT_MS)
  const onReadable = () => {
    while (true) {
      const d = socket.read()
      if (!d) break
      buf = Buffer.concat([buf, d])
      if (buf.length > MAX_HELLO) { socket.destroy(); return }
      if (buf.length >= 5) {
        const recLen = buf.readUInt16BE(3) // record: type(1) + version(2) + length(2)
        if (buf.length >= 5 + recLen) {
          done = true
          clearTimeout(to)
          const sni = sniFromHello(buf)
          console.log('[router] SNI =', sni, 'from', socket.remoteAddress)
          socket.unshift(buf) // hand the complete record back to the stream
          if (sni === TURN_SNI) {
            // TLS-terminate, then plaintext to coturn. The ClientHello is
            // re-read by the TLSSocket from the unshifted buffer.
            const up = net.connect(COTURN)
            up.on('connect', () => {
              const tlsSock = new tls.TLSSocket(socket, { isServer: true, key, cert })
              tlsSock.on('secure', () => console.log('[router] TLS secure → coturn'))
              pipePair(tlsSock, up)
            })
            up.on('error', (e) => { console.log('[router] coturn ERR', e.code); socket.destroy() })
          } else {
            // raw passthrough to Caddy (TLS never terminated here)
            const up = net.connect(CADDY)
            up.on('connect', () => {
              socket.resume()
              pipePair(socket, up)
            })
            up.on('error', (e) => { console.log('[router] caddy ERR', e.code); socket.destroy() })
          }
          return
        }
      }
    }
    if (!done) socket.once('readable', onReadable)
  }
  socket.once('readable', onReadable)
  socket.on('error', (e) => console.log('[router] client sock ERR', e.code))
})

server.listen(LISTEN.port, LISTEN.host, () => {
  console.log(`[bomberggo-tls-router] 443 SNI router on ${LISTEN.host}:${LISTEN.port} → turn:${TURN_SNI}→coturn, else→caddy:${CADDY.port}`)
})
