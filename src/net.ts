import { Peer, type DataConnection, type PeerOptions } from 'peerjs'

/**
 * Online battle networking (host-authoritative, PeerJS data channel).
 * Signaling: self-hosted PeerServer on the game's own origin (see
 * signalingOpts below + deploy/peer-server.mjs) — not the free cloud.
 *
 * Protocol (JSON messages over an UNORDERED WebRTC data channel):
 *   client -> host: { t:'input', n, dir, bomb, detonate }  (dir on change, bomb/detonate as edges)
 *   host -> client: { t:'state', n, s: Snapshot }          (~30Hz full snapshot)
 *   both:           { t:'bye' }
 *
 * The channel is created with reliable:false (PeerJS → SCTP ordered:false), so
 * messages can arrive out of order: every state/input message carries a
 * sequence number `n` and the receiver drops anything stale. This removes
 * head-of-line blocking — one lost/retransmitted packet no longer stalls all
 * newer snapshots behind it (the classic cause of stutter over cellular).
 * Reliability is kept (SCTP retransmits until delivery), so no message is
 * ever lost; it may just arrive late and be discarded as stale.
 *
 * The host runs the real Game simulation; the client renders snapshots only.
 */

export type NetMsg =
  | { t: 'input'; n: number; dir: number | null; bomb: boolean; detonate: boolean }
  | { t: 'state'; n: number; s: any }
  | { t: 'hello'; c: string; ch?: string }
  | { t: 'bye' }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genRoomCode(): string {
  let c = ''
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return c
}

const PEER_PREFIX = 'bomberggo-'

/**
 * Signaling server: self-hosted PeerServer on the game's own origin
 * (deploy/peer-server.mjs, proxied by Caddy at /peerjs).
 *
 * Why not the free 0.peerjs.com cloud: corporate networks/VPNs often block
 * third-party domains, so host/join dies with "server-error" even though the
 * game page itself loads fine. Same-origin signaling rides the exact
 * connection the page loaded on — if the game is visible, rooms work.
 *
 * The peerjs client dials ws(s)://{host}:{port}/peerjs?key=peerjs&id=…&token=…
 * — the server (WS route '/peerjs') registers the peer from that URL.
 * Fallback: no hostname (e.g. file://) → cloud defaults.
 */
function signalingOpts(): Partial<PeerOptions> {
  const opts: Partial<PeerOptions> = { config: ICE_CONFIG }
  if (location.hostname) {
    const secure = location.protocol === 'https:'
    opts.host = location.hostname
    opts.port = location.port ? Number(location.port) : (secure ? 443 : 80)
    opts.secure = secure
  }
  return opts
}

/**
 * ICE servers for the WebRTC data channel.
 *  - STUN: lets both phones discover their public address (works when at least
 *    one side is not behind a symmetric NAT).
 *  - TURN: self-hosted relay (coturn on Anson's always-on Mac) as the fallback
 *    when the two phones are on different networks and a direct/srflx path
 *    can't be established. UDP only.
 */
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:119.247.94.77:3478?transport=udp',
      username: 'bomberggo',
      credential: '50b42fd03733a21c51c8de0af13e206f',
    },
  ],
}

export class Net {
  peer: Peer | null = null
  conn: DataConnection | null = null
  isHost = false
  roomCode: string | null = null
  connected = false

  onMessage: ((m: NetMsg) => void) | null = null
  onOpen: (() => void) | null = null
  onClose: (() => void) | null = null
  onError: ((msg: string) => void) | null = null
  private joinTimer: number | null = null

  /** host: create a room with a generated code, wait for one opponent */
  host() {
    this.destroy()
    this.isHost = true
    this.roomCode = genRoomCode()
    const code = this.roomCode
    this.peer = new Peer(PEER_PREFIX + code, signalingOpts())
    this.peer.on('connection', (conn) => {
      // accept the first opponent only
      if (this.conn) { try { conn.close() } catch {} return }
      this.wire(conn)
    })
    this.peer.on('error', (e: any) => {
      const type = e?.type ?? ''
      if (type === 'unavailable-id') this.onError?.('Room code collision — try again')
      else if (type !== 'peer-unavailable') this.onError?.(type || 'network error')
    })
  }

  /** join an existing room by code */
  join(code: string) {
    this.destroy()
    this.isHost = false
    this.roomCode = code.toUpperCase()
    this.peer = new Peer(signalingOpts())
    // if the room isn't reachable in 20s, say so — an endless "Joining…" is worse
    this.joinTimer = window.setTimeout(() => {
      if (!this.connected) this.onError?.('Cannot reach the game server — check your connection / VPN')
    }, 20000)
    this.peer.on('open', () => {
      // reliable:false → PeerJS sets SCTP ordered:false (unordered delivery).
      // Full-state snapshots make out-of-order harmless (stale ones are
      // dropped by sequence number); it removes head-of-line blocking on
      // lossy links. Note: PeerJS does NOT expose maxRetransmits, so SCTP
      // still retransmits until delivery — nothing is ever lost.
      const conn = this.peer!.connect(PEER_PREFIX + this.roomCode, { reliable: false })
      this.wire(conn)
    })
    this.peer.on('error', (e: any) => {
      const type = e?.type ?? ''
      if (type === 'peer-unavailable') this.onError?.('Room not found — check the code')
      else this.onError?.(type || 'network error')
    })
  }

  private wire(conn: DataConnection) {
    conn.on('open', () => {
      if (this.conn && this.conn !== conn) { try { conn.close() } catch {} return }
      if (this.joinTimer !== null) { window.clearTimeout(this.joinTimer); this.joinTimer = null }
      this.conn = conn
      this.connected = true
      this.onOpen?.()
    })
    conn.on('data', (d) => {
      const m = d as NetMsg
      if (m && m.t === 'bye') {
        this.connected = false
        this.onClose?.()
        return
      }
      this.onMessage?.(m)
    })
    conn.on('close', () => {
      if (this.conn === conn) {
        this.connected = false
        this.onClose?.()
      }
    })
    conn.on('error', (e: any) => this.onError?.(String(e?.type ?? 'connection error')))
  }

  send(m: NetMsg) {
    if (!this.connected || !this.conn) return
    try { this.conn.send(m) } catch {}
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
    const pc = (this.conn as any)?.peerConnection as RTCPeerConnection | null
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
    if (this.joinTimer !== null) { window.clearTimeout(this.joinTimer); this.joinTimer = null }
    try { this.send({ t: 'bye' }) } catch {}
    try { this.conn?.close() } catch {}
    try { this.peer?.destroy() } catch {}
    this.conn = null
    this.peer = null
    this.connected = false
    this.isHost = false
    this.roomCode = null
  }
}

export const net = new Net()
