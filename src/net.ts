/**
 * Online battle networking (host-authoritative, raw WebRTC data channel).
 *
 * Transport: a plain-HTTPS long-poll signaling server on the game's own origin
 * (deploy/signal-server.mjs, Caddy handle /signal). NO WebSockets — corporate
 * proxies routinely block the WS `Upgrade` handshake while ordinary HTTPS
 * works; long-poll rides the same requests the page already uses. Signaling is
 * one-shot (SDP + ICE), so poll latency is irrelevant; after the handshake the
 * game runs on a direct WebRTC data channel (or via the TURN relay).
 *
 * Protocol (JSON over an UNORDERED, lossy WebRTC data channel):
 *   client -> host: { t:'input', n, dir, bomb, detonate }  (dir on change, bomb/detonate as edges)
 *   host -> client: { t:'state', n, s: Snapshot }          (~30Hz full snapshot)
 *   both:           { t:'bye' }
 *   client -> host: { t:'hello', c, ch? }                  (identity, after connect)
 *
 * The channel is unordered and lossy (ordered:false, maxRetransmits:0), so
 * messages can arrive out of order: every state/input message carries a
 * sequence number `n` and the receiver drops anything stale. This removes
 * head-of-line blocking — one lost packet no longer stalls all newer
 * snapshots behind it. Reliability comes from the full-state snapshots, not
 * the transport.
 *
 * The host runs the real Game simulation; the client renders snapshots only.
 */

export type NetMsg =
  | { t: 'input'; n: number; dir: number | null; bomb: boolean; detonate: boolean }
  | { t: 'state'; n: number; s: any }
  | { t: 'hello'; c: string; ch?: string }
  | { t: 'bye' }

/** signaling messages relayed by /signal (not part of the game protocol) */
type SignalMsg =
  | { t: 'offer'; sdp: RTCSessionDescriptionInit }
  | { t: 'answer'; sdp: RTCSessionDescriptionInit }
  | { t: 'ice'; cand: RTCIceCandidateInit }
  | { t: 'hello'; c: string; ch?: string }
  | { t: 'bye' }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genRoomCode(): string {
  let c = ''
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return c
}

/**
 * ICE servers for the WebRTC data channel, ordered by likelihood:
 *  - STUN: lets both sides discover their public address (works when at least
 *    one is not behind a symmetric NAT).
 *  - TURN UDP: self-hosted relay (coturn on Anson's always-on Mac) when a
 *    direct/srflx path can't be established.
 *  - TURN TCP: for networks that block outbound UDP (many corporate setups) —
 *    the relay path then rides a plain TCP connection to coturn.
 */
const TURN_CRED = { username: 'bomberggo', credential: '50b42fd03733a21c51c8de0af13e206f' }
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:119.247.94.77:3478?transport=udp', ...TURN_CRED },
    { urls: 'turn:119.247.94.77:3478?transport=tcp', ...TURN_CRED },
  ],
}

const POLL_MS = 25_000 // client fetch timeout; the server long-polls 20s
const HEARTBEAT_MS = 5_000 // host room refresh; rooms die 30s after the last beat

async function sig(path: string, body?: any, timeoutMs = 8_000): Promise<any> {
  const ctl = new AbortController()
  const to = window.setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch('/signal' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    })
    return await r.json()
  } finally {
    window.clearTimeout(to)
  }
}

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

export class Net {
  pc: RTCPeerConnection | null = null
  dc: RTCDataChannel | null = null
  isHost = false
  roomCode: string | null = null
  connected = false

  onMessage: ((m: NetMsg) => void) | null = null
  onOpen: (() => void) | null = null
  onClose: (() => void) | null = null
  onError: ((msg: string) => void) | null = null
  private active = false
  private joinTimer: number | null = null
  private heartbeat: number | null = null

  /** host: create a room with a generated code, wait for one opponent */
  async host() {
    this.destroy()
    this.isHost = true
    this.roomCode = genRoomCode()
    const code = this.roomCode
    this.active = true

    // the room exists on the server the moment this returns (synchronous),
    // so the code can be shown immediately — no "is it live?" ambiguity
    const r = await sig('/host', { code })
    if (!this.active || !r?.ok) {
      this.active = false
      this.onError?.(r?.ok ? 'room gone' : 'Cannot reach the game server — check your connection / VPN')
      return
    }

    this.pc = new RTCPeerConnection(ICE_CONFIG)
    // unordered + no retransmits: stale snapshots are dropped by sequence
    // number, so head-of-line blocking is impossible
    this.dc = this.pc.createDataChannel('game', { ordered: false, maxRetransmits: 0 })
    this.wire(this.dc)
    this.pc.onicecandidate = (e) => {
      if (e.candidate) void sig('/send', { code, from: 'host', m: { t: 'ice', cand: e.candidate.toJSON() } })
    }

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    await sig('/send', { code, from: 'host', m: { t: 'offer', sdp: this.pc.localDescription!.toJSON() } })

    // keep the room alive while we're waiting for an opponent
    this.heartbeat = window.setInterval(() => {
      void sig('/host', { code }, 4_000)
    }, HEARTBEAT_MS)

    void this.pollLoop(code, 'host')
  }

  /** join an existing room by code */
  async join(code: string) {
    this.destroy()
    this.isHost = false
    this.roomCode = code.toUpperCase()
    const c = this.roomCode
    this.active = true
    // if we can't be in-game within 20s, say so — an endless "Joining…" is worse
    this.joinTimer = window.setTimeout(() => {
      if (!this.connected) this.onError?.('Cannot reach the game server — check your connection / VPN')
    }, 20_000)

    const r = await sig('/join', { code: c })
    if (!this.active) return
    if (!r?.ok) {
      this.active = false
      this.clearJoinTimer()
      this.onError?.(r?.err === 'no-room' ? 'Room not found — check the code' : 'Cannot reach the game server — check your connection / VPN')
      return
    }

    this.pc = new RTCPeerConnection(ICE_CONFIG)
    this.pc.ondatachannel = (e) => this.wire(e.channel)
    this.pc.onicecandidate = (e) => {
      if (e.candidate) void sig('/send', { code: c, from: 'client', m: { t: 'ice', cand: e.candidate.toJSON() } })
    }

    void this.pollLoop(c, 'client')
  }

  /** long-poll the signaling server; relayed messages drive the WebRTC handshake */
  private async pollLoop(code: string, who: 'host' | 'client') {
    let since = 0
    while (this.active && this.roomCode === code) {
      let msgs: { n: number; m: SignalMsg }[] = []
      try {
        msgs = (await sig(`/poll?code=${code}&who=${who}&since=${since}`, undefined, POLL_MS))?.msgs ?? []
      } catch {
        await sleep(1_000) // network hiccup — retry, don't die
        continue
      }
      for (const { n, m } of msgs) {
        since = Math.max(since, n)
        this.handleSignal(m)
      }
    }
  }

  private async handleSignal(m: SignalMsg) {
    const pc = this.pc
    if (!pc) return
    if (m.t === 'bye') {
      if (this.connected) { this.connected = false; this.onClose?.() }
      return
    }
    if (m.t === 'hello') {
      this.onMessage?.({ t: 'hello', c: m.c, ch: m.ch })
      return
    }
    try {
      if (m.t === 'offer') {
        // client side: receive offer, answer it
        if (pc.remoteDescription) return
        await pc.setRemoteDescription(m.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await sig('/send', { code: this.roomCode, from: 'client', m: { t: 'answer', sdp: pc.localDescription!.toJSON() } })
      } else if (m.t === 'answer') {
        // host side: receive answer
        if (pc.remoteDescription) return
        await pc.setRemoteDescription(m.sdp)
      } else if (m.t === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(m.cand)
      }
    } catch (e) {
      console.warn('signal:', e)
    }
  }

  private wire(dc: RTCDataChannel) {
    this.dc = dc
    dc.onopen = () => {
      if (!this.active) return
      this.clearJoinTimer()
      this.connected = true
      this.onOpen?.()
    }
    dc.onmessage = (e) => {
      let m: NetMsg
      try { m = JSON.parse(e.data as string) } catch { return }
      if (!m || typeof m.t !== 'string') return
      if (m.t === 'bye') {
        this.connected = false
        this.onClose?.()
        return
      }
      this.onMessage?.(m)
    }
    dc.onclose = () => {
      if (this.dc === dc && this.connected) {
        this.connected = false
        this.onClose?.()
      }
    }
    dc.onerror = () => this.onError?.('connection error')
  }

  private clearJoinTimer() {
    if (this.joinTimer !== null) { window.clearTimeout(this.joinTimer); this.joinTimer = null }
  }

  send(m: NetMsg) {
    if (!this.connected || !this.dc) return
    try { this.dc.send(JSON.stringify(m)) } catch {}
  }

  /** monotonic sequence numbers — the channel is unordered, receivers drop stale msgs */
  private seq = 0

  /** host: broadcast a snapshot (auto-seq) */
  sendState(s: any) {
    this.send({ t: 'state', n: ++this.seq, s })
  }

  /** client: send input (auto-seq) */
  sendInput(dir: number | null, bomb: boolean, detonate: boolean) {
    this.send({ t: 'input', n: ++this.seq, dir, bomb, detonate })
  }

  /** which ICE path the data channel is on: 'host' (direct: LAN/tailnet),
   *  'srflx' (via STUN), 'relay' (via TURN) — null until a pair is selected */
  async pathType(): Promise<string | null> {
    const pc = this.pc
    if (!pc) return null
    try {
      const stats = await pc.getStats()
      let pair: any = null
      stats.forEach((s: any) => {
        if (s.type === 'candidate-pair' && (s.selected || s.nominated)) pair = s
      })
      if (!pair) return null
      const cand = stats.get(pair.localCandidateId)
      return cand?.candidateType ?? null
    } catch {
      return null
    }
  }

  destroy() {
    this.active = false
    this.clearJoinTimer()
    if (this.heartbeat !== null) { window.clearInterval(this.heartbeat); this.heartbeat = null }
    try { this.dc?.send(JSON.stringify({ t: 'bye' } satisfies NetMsg)) } catch {}
    try { this.dc?.close() } catch {}
    try { this.pc?.close() } catch {}
    this.dc = null
    this.pc = null
    this.connected = false
    this.isHost = false
    this.roomCode = null
  }
}

export const net = new Net()
