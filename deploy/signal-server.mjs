#!/usr/bin/env node
/**
 * BOMBER GO — signaling server (plain HTTPS long-poll, NO WebSockets).
 *
 * Why not WebSockets: corporate proxies/firewalls routinely block the
 * WebSocket `Upgrade` handshake while plain HTTPS GET/POST works — that is
 * exactly what happened on a corporate VPN (game page loaded, PeerJS WS
 * signaling dead). Long-poll signaling rides ordinary HTTPS requests, so it
 * works anywhere the game page loads.
 *
 * The server only relays WebRTC signaling messages (SDP offer/answer, ICE
 * candidates, app-level 'hello'/'bye') between one host and one client per
 * room. The game data itself is a direct WebRTC data channel — nothing
 * game-related touches this server.
 *
 * API (JSON):
 *   POST /signal/host   {code}                 → create/refresh room (heartbeat)
 *   POST /signal/join   {code}                 → {ok} if the room is alive
 *   POST /signal/send   {code, from, m}        → enqueue m for the other side
 *   GET  /signal/poll?code&who&since           → long-poll (≤20s) msgs since n
 *
 * Loopback only (127.0.0.1:9100); Caddy is the public entry (deploy/public.caddy,
 * handle /signal). Rooms expire 30s after the host's last heartbeat.
 *
 * Run by launchd: ~/Library/LaunchAgents/com.anson.bomber-go-peer.plist
 */
import http from 'node:http'

const PORT = 9100
const HOST = '127.0.0.1'
const POLL_TIMEOUT_MS = 20_000
const ROOM_TTL_MS = 30_000

/** rooms: code → { hostAlive, seq, host: [], client: [] (each {n, m}) } */
const rooms = new Map()

function room(code) {
  let r = rooms.get(code)
  if (!r) {
    r = { hostAlive: Date.now(), seq: 0, host: [], client: [] }
    rooms.set(code, r)
  }
  return r
}

/** long-poll waiters: code → [ (who, since, resolve) ] */
const waiters = new Map()

function enqueue(code, to, m) {
  const r = room(code)
  r[to].push({ n: ++r.seq, m })
  const ws = waiters.get(code)
  if (ws) {
    const rest = []
    for (const w of ws) {
      if (w.who === to && r[to].some((x) => x.n > w.since)) w.resolve()
      else rest.push(w)
    }
    if (rest.length) waiters.set(code, rest); else waiters.delete(code)
  }
}

function drain(code, who, since) {
  const r = rooms.get(code)
  if (!r) return []
  return r[who].filter((x) => x.n > since)
}

function sweep() {
  const now = Date.now()
  for (const [code, r] of rooms) {
    if (now - r.hostAlive > ROOM_TTL_MS) {
      rooms.delete(code)
      const ws = waiters.get(code)
      if (ws) { for (const w of ws) w.resolve(); waiters.delete(code) }
    }
  }
}
setInterval(sweep, 5_000).unref()

function json(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (d) => { s += d; if (s.length > 65_536) req.destroy() })
    req.on('end', () => {
      try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) }
    })
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname

  if (req.method === 'POST' && p === '/signal/host') {
    const { code } = await readBody(req)
    if (!/^[A-Z2-9]{5}$/.test(code ?? '')) return json(res, 400, { ok: false, err: 'bad-code' })
    room(code).hostAlive = Date.now()
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && p === '/signal/join') {
    const { code } = await readBody(req)
    const r = rooms.get(code)
    if (!r || Date.now() - r.hostAlive > ROOM_TTL_MS) {
      return json(res, 200, { ok: false, err: 'no-room' })
    }
    return json(res, 200, { ok: true })
  }

  if (req.method === 'POST' && p === '/signal/send') {
    const { code, from, m } = await readBody(req)
    const r = rooms.get(code)
    if (!r || (from !== 'host' && from !== 'client')) return json(res, 400, { ok: false, err: 'bad' })
    if (!m || typeof m.t !== 'string') return json(res, 400, { ok: false, err: 'bad-msg' })
    enqueue(code, from === 'host' ? 'client' : 'host', m)
    return json(res, 200, { ok: true })
  }

  if (req.method === 'GET' && p === '/signal/poll') {
    const code = url.searchParams.get('code') ?? ''
    const who = url.searchParams.get('who') ?? ''
    const since = Number(url.searchParams.get('since') ?? 0)
    const r = rooms.get(code)
    if (!r || (who !== 'host' && who !== 'client')) return json(res, 400, { ok: false, err: 'bad' })
    const got = drain(code, who, since)
    if (got.length) return json(res, 200, { msgs: got })
    // long-poll: hold until a message arrives, the room dies, or timeout
    await new Promise((resolve) => {
      const w = { who, since, resolve }
      if (!waiters.has(code)) waiters.set(code, [])
      waiters.get(code).push(w)
      setTimeout(() => {
        const ws = waiters.get(code)
        const i = ws ? ws.indexOf(w) : -1
        if (i >= 0) ws.splice(i, 1)
        resolve()
      }, POLL_TIMEOUT_MS).unref()
    })
    return json(res, 200, { msgs: drain(code, who, since) })
  }

  json(res, 404, { ok: false, err: 'not-found' })
})

server.listen(PORT, HOST, () => {
  console.log(`[bomberggo-signal] long-poll signaling on ${HOST}:${PORT} (/signal/*)`)
})
