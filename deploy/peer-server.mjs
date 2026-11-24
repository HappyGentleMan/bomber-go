#!/usr/bin/env node
/**
 * BOMBER GO — self-hosted PeerJS signaling.
 *
 * Why: the free PeerJS cloud (0.peerjs.com) is blocked on some networks
 * (corporate VPNs / firewalls), so host/join fails with "server-error".
 * Signaling on the game's own origin works anywhere the game page loads:
 * Caddy proxies /peerjs/* here (deploy/public.caddy + deploy/Caddyfile).
 *
 * Loopback only (127.0.0.1:9100) — Caddy is the public entry.
 * Protocol note: the `peer` server registers peers over the WebSocket URL
 * itself (ws://…/peerjs?key=peerjs&id=…&token=…&version=…); no HTTP POST
 * endpoint exists. The client (src/net.ts) points Peer at location.origin,
 * so host/join signaling rides the same connection the page loaded on.
 *
 * Run by launchd: ~/Library/LaunchAgents/com.anson.bomber-go-peer.plist
 */
import { PeerServer } from 'peer'

const server = new PeerServer({
  host: '127.0.0.1',
  port: 9100,
  // default path '/' → WebSocket route '/peerjs', which is what the
  // peerjs browser client connects to (its URL is {origin}/peerjs?key=…).
  corsOptions: { origin: true },
})

server.on('connection', () => {}) // keep default logging quiet-ish
console.log(`[bomberggo-peer] signaling listening on 127.0.0.1:9100 (WS /peerjs)`)
