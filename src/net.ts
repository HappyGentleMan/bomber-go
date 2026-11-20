import { Peer, type DataConnection } from 'peerjs'

/**
 * Online battle networking (host-authoritative, PeerJS data channel).
 *
 * Protocol (JSON messages over a reliable WebRTC data channel):
 *   client -> host: { t:'input', dir, bomb, detonate }   (dir on change, bomb/detonate as edges)
 *   host -> client: { t:'state', s: Snapshot }           (~20Hz full snapshot)
 *   both:           { t:'bye' }
 *
 * The host runs the real Game simulation; the client renders snapshots only.
 */

export type NetMsg =
  | { t: 'input'; dir: number | null; bomb: boolean; detonate: boolean }
  | { t: 'state'; s: any }
  | { t: 'bye' }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function genRoomCode(): string {
  let c = ''
  for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return c
}

const PEER_PREFIX = 'bomberggo-'

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

  /** host: create a room with a generated code, wait for one opponent */
  host() {
    this.destroy()
    this.isHost = true
    this.roomCode = genRoomCode()
    const code = this.roomCode
    this.peer = new Peer(PEER_PREFIX + code)
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
    this.peer = new Peer()
    this.peer.on('open', () => {
      const conn = this.peer!.connect(PEER_PREFIX + this.roomCode, { reliable: true })
      this.wire(conn)
    })
    this.peer.on('error', (e: any) => {
      const type = e?.type ?? ''
      if (type === 'peer-unavailable') this.onError?.('Room not found — check the code')
      else if (type !== 'network') this.onError?.(type || 'network error')
    })
  }

  private wire(conn: DataConnection) {
    conn.on('open', () => {
      if (this.conn && this.conn !== conn) { try { conn.close() } catch {} return }
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
