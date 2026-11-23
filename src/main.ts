import { Game, haptic } from './game'
import { Renderer, type Renderable } from './render'
import { ui } from './ui'
import { input } from './input'
import { audio } from './audio'
import { net } from './net'
import { serializeGame, RemoteGame, diffSnapshots } from './netgame'
import { CANVAS_W, CANVAS_H, POWERUP_DEFS, PLAYER_COLORS } from './constants'
import { isHighScore, settings } from './storage'
import type { Dir, PowerupKind } from './constants'

const stage = document.getElementById('stage')!
const canvas = document.getElementById('game') as HTMLCanvasElement
const renderer = new Renderer(canvas)

let appState: 'title' | 'playing' | 'paused' = 'title'
let game: Game | null = null
let pendingOver = false
let battleOpts = { aiPlayer2: false, attract: false }
let lastTickSecond = -1
let lastLives = -1 // life-loss flash detection in hudUpdate
let lastKills = 0 // battle kill-flash detection in hudUpdate

// ---------- online battle state ----------
let netRole: 'none' | 'host' | 'client' = 'none'
let remote: RemoteGame | null = null
let prevSnap: any = null
// host: P2 input arrives from the remote client (dir = held, bomb/detonate = edges)
let remoteInput = { dir: null as Dir | null, bomb: false, detonate: false }
// client: track last sent dir to only send on change
let lastSentDir: Dir | null = null
let snapTimer = 0
// refit the canvas when the HUD bar appears/disappears (it reserves vertical space)
let lastHudVisible = false
// channel is unordered: drop stale messages (seq numbers from Net)
let lastStateN = 0
let lastInputN = 0

// Live debug handle for browser inspection / automated testing (read-only view).
Object.defineProperty(window, '__game', { get: () => game, configurable: true })
Object.defineProperty(window, '__input', { get: () => input, configurable: true })
Object.defineProperty(window, '__net', { get: () => net, configurable: true })
Object.defineProperty(window, '__renderer', { get: () => renderer, configurable: true })

// ---------- powerup legend (settings screen) ----------
{
  const PU_DESC: Record<PowerupKind, string> = {
    bomb: 'one more bomb at a time',
    flame: 'longer bomb blast',
    speed: 'move faster',
    shrink: 'lose a bomb slot',
    shrinkf: 'shorter blast',
    shield: 'blocks one hit',
    invincible: 'untouchable for a while',
    wallpass: 'walk through bricks',
    freeze: 'freezes enemies — battle: stuns the rival',
    life: '+1 life',
  }
  const legend = document.getElementById('powerup-legend')
  if (legend) {
    legend.innerHTML = Object.values(POWERUP_DEFS).map(d =>
      `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
         <span style="width:16px;height:16px;border-radius:50%;background:${d.color};flex-shrink:0;box-shadow:0 0 8px ${d.color}66"></span>
         <span style="font-size:12px"><b style="letter-spacing:.05em">${d.label}</b> <span class="hint" style="font-size:11px">— ${PU_DESC[d.kind]}</span></span>
       </div>`
    ).join('')
  }
}

// ---------- layout ----------

const dpad = document.getElementById('t-dpad')!
const actions = document.getElementById('t-actions')!
const pauseWrap = document.getElementById('t-pause-wrap')!
const joyCluster = document.getElementById('t-joy')!
const joyBase = document.getElementById('joy-base')!
const joyKnob = document.getElementById('joy-knob')!

/** place the touch clusters in the black letterbox around the canvas
 *  (side bars in landscape, bottom bar in portrait) so they never cover the game */
function layoutTouch() {
  const sr = stage.getBoundingClientRect()
  const side = (window.innerWidth - sr.width) / 2
  // true bottom letterbox: the HUD bar sits ABOVE the stage, so centering in
  // (innerHeight - stageHeight) would overestimate the bar below
  const bottom = window.innerHeight - (sr.top + sr.height)
  const joy = settings.moveStyle === 'joystick'
  const moveEl = joy ? joyCluster : dpad
  const moveW = joy ? 150 : 200
  const moveH = joy ? 150 : 130
  const actW = 170, actH = 152
  const css = getComputedStyle(document.documentElement)
  const safeB = parseFloat(css.getPropertyValue('--safe-bottom')) || 0
  const safeL = parseFloat(css.getPropertyValue('--safe-left')) || 0
  const safeR = parseFloat(css.getPropertyValue('--safe-right')) || 0
  const need = Math.max(moveW, 170) + 16 // both clusters must fit the side bar
  if (side >= need) {
    // landscape: black bars on the left & right (cluster fits fully)
    moveEl.style.left = `${Math.max(8 + safeL, side / 2 - moveW / 2)}px`
    moveEl.style.top = `${Math.max(8, (window.innerHeight - moveH) / 2)}px`
    moveEl.style.right = 'auto'
    moveEl.style.bottom = 'auto'
    actions.style.right = `${Math.max(8 + safeR, side / 2 - actW / 2)}px`
    actions.style.top = `${Math.max(8, (window.innerHeight - actH) / 2)}px`
    actions.style.left = 'auto'
    actions.style.bottom = 'auto'
  } else {
    // portrait (or narrow): black bar below the canvas, above the home indicator
    moveEl.style.left = '14px'
    moveEl.style.bottom = `${Math.max(8 + safeB, (bottom - safeB) / 2 - moveH / 2)}px`
    moveEl.style.top = 'auto'
    moveEl.style.right = 'auto'
    actions.style.right = '14px'
    actions.style.bottom = `${Math.max(8 + safeB, (bottom - safeB) / 2 - actH / 2)}px`
    actions.style.top = 'auto'
    actions.style.left = 'auto'
  }
  // pause: always at the canvas top-right corner — out of the action cluster,
  // so it's reachable without moving the thumb off BOMB
  pauseWrap.style.left = `${sr.right - 56}px`
  pauseWrap.style.top = `${sr.top + 8}px`
  pauseWrap.style.right = 'auto'
  pauseWrap.style.bottom = 'auto'
}

function fit() {
  const pad = 4
  const hud = document.getElementById('hud')!
  const hudH = hud.classList.contains('hidden') ? 0 : hud.offsetHeight
  const availW = window.innerWidth - pad
  const availH = window.innerHeight - pad - hudH
  const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H)
  let w = Math.floor(CANVAS_W * scale)
  let h = Math.floor(CANVAS_H * scale)
  // safe-area insets must count against the letterbox budget, not just the clusters
  const css = getComputedStyle(document.documentElement)
  const safeL = parseFloat(css.getPropertyValue('--safe-left')) || 0
  const safeR = parseFloat(css.getPropertyValue('--safe-right')) || 0
  const safeB = parseFloat(css.getPropertyValue('--safe-bottom')) || 0
  // which axis limits the fit (direct ratio test — a floor-equality test has a
  // floating-point gap for ~6% of integer sizes)
  const widthLimited = availW / CANVAS_W <= availH / CANVAS_H
  const heightLimited = availH / CANVAS_H <= availW / CANVAS_W
  // height-limited (landscape): guarantee the side letterbox bars fit BOTH
  // clusters (movement AND actions), capping the canvas width when too narrow
  if (heightLimited) {
    const moveW = settings.moveStyle === 'joystick' ? 150 : 200
    const need = Math.max(moveW, 170) + 16 + safeL + safeR // 170 = actions cluster width
    if ((availW - w) / 2 < need) {
      w = Math.floor(Math.max(1, availW - 2 * need))
      h = Math.floor(w * CANVAS_H / CANVAS_W)
    }
  }
  // width-limited (portrait): guarantee the bottom letterbox bar fits the
  // movement cluster, capping the canvas height when the bar would be too short
  if (widthLimited) {
    const moveH = settings.moveStyle === 'joystick' ? 150 : 130
    const need = moveH + 16 + safeB
    if ((availH - h) / 2 < need) {
      h = Math.floor(Math.max(1, availH - 2 * need))
      w = Math.floor(h * CANVAS_W / CANVAS_H)
    }
  }
  stage.style.width = `${w}px`
  stage.style.height = `${h}px`
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  renderer.resize(w, h) // native-resolution backing store (HD, no CSS upscale blur)
  layoutTouch()
}
window.addEventListener('resize', fit)
fit()

// ---------- game lifecycle ----------

/** true once a battle ended (host stops simulating until the next match) */
let matchOver = false
let attractTimer: number | null = null
function resetMatchState() {
  matchOver = false
  if (attractTimer !== null) { window.clearTimeout(attractTimer); attractTimer = null }
}

function startCampaign(): Game {
  game = new Game('campaign', { p1Color: settings.color })
  resetMatchState()
  wireGame()
  appState = 'playing'
  lastTickSecond = -1
  ui.show(null)
  ui.banner('LEVEL 1', 1.2)
  audio.setTrack('game')
  audio.ensure()
  return game
}

function startBattle(aiP2: boolean): Game {
  game = new Game('battle', { aiPlayer2: aiP2, p1Color: settings.color })
  resetMatchState()
  wireGame()
  appState = 'playing'
  lastTickSecond = -1
  battleOpts = { aiPlayer2: aiP2, attract: false }
  ui.show(null)
  ui.banner('BATTLE!', 1.2)
  audio.setTrack('battle')
  audio.ensure()
  return game
}

function startAttract() {
  game = new Game('battle', { aiPlayer2: true, attract: true, p1Color: settings.color })
  resetMatchState()
  wireGame()
  appState = 'title'
  ui.show('title')
  audio.setTrack('menu')
}

// ---------- online battle ----------

function leaveNet() {
  net.destroy()
  netRole = 'none'
  remote = null
  prevSnap = null
  lastSentDir = null
  remoteInput = { dir: null, bomb: false, detonate: false }
  snapTimer = 0
  lastStateN = 0
  lastInputN = 0
  ui.showRoomCode(false)
  resetMatchState()
}

/** show which path the WebRTC link is on (confirm tailnet direct-connect works) */
function showPathBanner() {
  window.setTimeout(() => {
    net.pathType().then((t) => {
      if (t === 'host') ui.banner('直連 (tailnet / LAN)', 1.6)
      else if (t === 'srflx') ui.banner('STUN 直連', 1.6)
      else if (t === 'relay') ui.banner('TURN relay', 1.6)
    })
  }, 3000)
}

function hostOnline() {
  if (netRole !== 'none') return
  net.onError = (msg) => {
    ui.onlineStatus(msg, 'err')
    if (!net.connected) leaveNet()
  }
  net.host()
  ui.setRoomTiles(net.roomCode ?? '')
  ui.showRoomCode(true)
  ui.onlineStatus('WAITING FOR OPPONENT…')
  net.onOpen = () => {
    ui.onlineStatus(`OPPONENT CONNECTED — FIGHT!`, 'ok')
    netRole = 'host'
    resetMatchState()
    ui.showRoomCode(false)
    game = new Game('battle', { aiPlayer2: false, p1Color: settings.color })
    wireGame()
    appState = 'playing'
    lastTickSecond = -1
    ui.show(null)
    ui.banner('FIGHT!', 1.5)
    showPathBanner()
    audio.setTrack('battle')
    audio.ensure()
  }
}

function joinOnline() {
  if (netRole !== 'none') return
  const code = ui.getOnlineCode()
  if (code.length < 4) { ui.onlineStatus('Enter the 5-letter room code first', 'err'); return }
  ui.onlineStatus(`Joining room ${code}…`)
  ui.showRoomCode(false)
  net.onError = (msg) => {
    ui.onlineStatus(msg, 'err')
    if (!net.connected) leaveNet()
  }
  net.onOpen = () => {
    ui.onlineStatus('CONNECTED — FIGHT!', 'ok')
    netRole = 'client'
    resetMatchState()
    ui.showRoomCode(false)
    remote = new RemoteGame()
    prevSnap = null
    game = null
    appState = 'playing'
    lastTickSecond = -1
    ui.show(null)
    ui.banner('FIGHT!', 1.5)
    audio.setTrack('battle')
    audio.ensure()
    net.send({ t: 'hello', c: settings.color }) // tell the host our color
  }
  net.join(code)
}

/** host: apply the client's chosen color to player 1 (live + on respawn) */
function applyRemoteColor(c: string) {
  if (!game || !PLAYER_COLORS.includes(c)) return
  game.playerColors[1] = c === settings.color ? '#ffd54a' : c // no same-color matches
  if (game.players[1]) game.players[1].color = game.playerColors[1]
}

/** host: receive the client's input; both: handle drop-offs */
net.onMessage = (m) => {
  if (m.t === 'hello' && netRole === 'host') {
    applyRemoteColor(m.c)
    return
  }
  if (m.t === 'input' && netRole === 'host') {
    if (m.n <= lastInputN) return // unordered channel: stale input
    lastInputN = m.n
    remoteInput.dir = m.dir as Dir | null // null = released → stop
    if (m.bomb) remoteInput.bomb = true
    if (m.detonate) remoteInput.detonate = true
    return
  }
  if (m.t !== 'state' || netRole !== 'client' || !remote) return
  if (m.n <= lastStateN) return // unordered channel: stale snapshot
  lastStateN = m.n
  const ev = diffSnapshots(prevSnap, m.s)
  prevSnap = m.s
  remote.apply(m.s)
  // client-side juice: audio + haptics from snapshot diffs
  if (ev.boom) { audio.play('boom'); haptic(40) }
  if (ev.bombPlaced) audio.play('bomb')
  if (ev.playerHit) { audio.play('hurt'); haptic(90) }
  if (ev.powerup) audio.play('powerup')
  if (ev.suddenDeath) { ui.banner('⚠ SUDDEN DEATH ⚠', 1.6); audio.play('combo') }
  if (ev.roundWin === 0) { ui.banner('YOU TAKE THE ROUND!', 2); audio.play('combo') }
  else if (ev.roundWin === 1) { ui.banner('OPPONENT TAKES THE ROUND!', 2); audio.play('combo') }
  if (ev.battleOver) {
    audio.play(ev.roundWin === 0 ? 'levelClear' : 'gameOver')
    const g = remote
    ui.showBattleOver(g.winner, [g.players[0].kills, g.players[1].kills], false, g.roundWins, ['YOU', 'OPPONENT'])
    ui.setRematchHidden(true)
    ui.show('battleover')
    appState = 'title'
    leaveNet() // client: the match is over — tear down the link (host stays up for rematch)
  }
}
net.onClose = () => {
  if (netRole === 'none') return
  const wasPlaying = appState === 'playing'
  if (wasPlaying) {
    ui.banner(netRole === 'host' ? 'OPPONENT LEFT' : 'CONNECTION LOST', 2)
    audio.play('gameOver')
  }
  window.setTimeout(() => {
    if (netRole !== 'none') {
      leaveNet()
      if (wasPlaying) toTitle()
      else ui.onlineStatus('Connection closed', 'err')
    }
  }, 1600)
}

function wireGame() {
  if (!game) return
  game.onEvent = (ev, data) => {
    switch (ev) {
      case 'levelclear':
        ui.showLevelClear(data.level, data.bonus, data.score, data.lives)
        ui.show('clear')
        break
      case 'nextlevel':
        ui.show(null)
        lastTickSecond = -1
        ui.banner(`LEVEL ${data.level}`, 1.2)
        break
      case 'gameover':
        pendingOver = true
        break
      case 'suddendeath':
        ui.banner('⚠ SUDDEN DEATH ⚠', 1.6)
        break
      case 'roundwin':
        if (!game!.attract) {
          const w = data.winner
          ui.banner(w === -1 ? 'DRAW — REPLAYING ROUND' : `${w === 0 ? 'PLAYER 1' : 'PLAYER 2'} TAKES THE ROUND!`, 2)
          audio.play('combo')
        }
        break
      case 'roundstart':
        if (!game!.attract) ui.banner(`ROUND ${data.round}`, 1.4)
        break
      case 'battleover':
        if (game!.attract) {
          attractTimer = window.setTimeout(startAttract, 1500)
        } else {
          const online = netRole === 'host'
          ui.showBattleOver(data.winner, [game!.players[0].kills, game!.players[1].kills], battleOpts.aiPlayer2,
            data.roundWins as [number, number] | undefined,
            online ? ['YOU', 'OPPONENT'] : undefined)
          ui.setRematchHidden(online)
          ui.show('battleover')
          appState = 'title'
          matchOver = true // host: stop simulating; the frozen field stays behind the overlay
        }
        break
    }
  }
}

function toTitle() {
  leaveNet()
  appState = 'title'
  game = null
  startAttract()
}

function pause() {
  if (appState !== 'playing' || !game) return
  if (netRole === 'client') { ui.banner('CAN’T PAUSE ONLINE', 1.2); return }
  appState = 'paused'
  ui.show('pause')
  audio.setTrack('menu')
}

function resume() {
  if (appState !== 'paused') return
  appState = 'playing'
  ui.show(null)
  audio.setTrack(game && game.mode === 'battle' ? 'battle' : 'game')
}

// live preview of the color choice (title demo + in-game P1)
ui.onColorChange = (c) => {
  if (!game) return
  game.playerColors[0] = c
  if (game.players[0]) game.players[0].color = c
}

ui.onAction = (action: string) => {
  switch (action) {
    case 'campaign': startCampaign(); break
    case 'battle': ui.show('battle'); ui.menuIndex = 0; break
    case 'battle-1p': startBattle(true); break
    case 'battle-2p':
      startBattle(false)
      // a touchscreen-only device cannot play P2 — warn before the fight
      if (('ontouchstart' in window || navigator.maxTouchPoints > 0) && !input.keyboardSeen && !input.gamepadSeen)
        ui.banner('P2 NEEDS A KEYBOARD OR GAMEPAD', 3)
      break
    case 'online': ui.show('online'); ui.menuIndex = 0; break
    case 'online-host': hostOnline(); break
    case 'online-join': joinOnline(); break
    case 'online-copy': {
      const btn = document.getElementById('online-copy') as HTMLButtonElement | null
      navigator.clipboard?.writeText(net.roomCode ?? '')
        .then(() => {
          if (!btn) return
          const old = btn.textContent
          btn.textContent = 'COPIED ✓'
          window.setTimeout(() => { btn.textContent = old }, 1500)
        })
        .catch(() => ui.onlineStatus('COPY FAILED', 'err'))
      break
    }
    case 'scores': ui.showScores(); ui.show('scores'); break
    case 'settings': ui.show('settings'); break
    case 'back':
      // leaving the online screen drops any half-open room
      if (ui.screen === 'online' && !net.connected) leaveNet()
      ui.show('title'); ui.menuIndex = 0
      audio.setTrack('menu')
      break
    case 'resume': resume(); break
    case 'to-menu': toTitle(); break
    case 'save-score':
      if (game) ui.saveScore(game.score, game.level, game.mode)
      ui.show(null)
      break
    case 'rematch':
      ui.setRematchHidden(false)
      startBattle(battleOpts.aiPlayer2)
      break
  }
}

input.onTogglePause = () => {
  if (appState === 'playing') pause()
  else if (appState === 'paused') resume()
}
input.onMenuNav = (d) => {
  // the level-clear panel: any confirm key continues
  if (ui.screen === 'clear') { if (d === 'ok') ui.show(null); return }
  if (appState === 'title' || ui.screen === 'battle' || ui.screen === 'online' || ui.screen === 'scores' || ui.screen === 'settings') {
    if (ui.screen === 'pause') return
    if (ui.screen === 'over') return
    ui.menuNav(d)
  }
}

// ---------- touch ----------

function bindTouch(id: string, dir: Dir | null, bomb = false, det = false) {
  const el = document.getElementById(id)!
  const on = (e: Event) => {
    e.preventDefault()
    audio.ensure()
    if (bomb) input.setTouchBomb()
    else if (det) input.setTouchDetonate()
    else input.dpadSet(dir!, true)
  }
  const off = (e: Event) => {
    e.preventDefault()
    if (bomb) return
    if (det) input.setTouchDir(null) // pre-existing: releasing DET also clears movement
    else input.dpadSet(dir!, false)
  }
  el.addEventListener('touchstart', on, { passive: false })
  el.addEventListener('touchend', off, { passive: false })
  el.addEventListener('touchcancel', off, { passive: false })
  el.addEventListener('mousedown', on)
  el.addEventListener('mouseup', off)
  el.addEventListener('mouseleave', off)
}
bindTouch('t-left', 1)
bindTouch('t-right', 0)
bindTouch('t-up', 3)
bindTouch('t-down', 2)
bindTouch('t-bomb', null, true)
bindTouch('t-det', null, false, true)

// ---------- virtual joystick (default mobile movement) ----------

const JOY_TRAVEL = 44   // max knob travel from centre (px)
const JOY_DEAD = 12     // deadzone (px) — below this, no direction
let joyActive = false
let joyPointer: number | null = null // which finger owns the joystick — the second finger must not steal it

function joyUpdate(clientX: number, clientY: number) {
  const r = joyBase.getBoundingClientRect()
  let dx = clientX - (r.left + r.width / 2)
  let dy = clientY - (r.top + r.height / 2)
  const len = Math.hypot(dx, dy)
  if (len > JOY_TRAVEL) { dx = dx / len * JOY_TRAVEL; dy = dy / len * JOY_TRAVEL }
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`
  const n = Math.hypot(dx, dy)
  if (n < JOY_DEAD) input.setTouchDir(null)
  // dominant axis -> one of the 4 game directions
  else if (Math.abs(dx) >= Math.abs(dy)) input.setTouchDir(dx > 0 ? 0 : 1)
  else input.setTouchDir(dy > 0 ? 2 : 3)
}
function joyEnd() {
  if (!joyActive) return
  joyActive = false
  joyKnob.style.transform = 'translate(0px, 0px)'
  input.setTouchDir(null)
}
joyBase.addEventListener('pointerdown', (e: PointerEvent) => {
  e.preventDefault()
  audio.ensure()
  if (joyActive) return // already tracked — ignore a second finger
  joyActive = true
  joyPointer = e.pointerId
  try { joyBase.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
  joyUpdate(e.clientX, e.clientY)
})
joyBase.addEventListener('pointermove', (e: PointerEvent) => {
  if (joyActive && e.pointerId === joyPointer) joyUpdate(e.clientX, e.clientY)
})
joyBase.addEventListener('pointerup', (e: PointerEvent) => {
  if (e.pointerId !== joyPointer) return
  joyPointer = null
  joyEnd()
})
joyBase.addEventListener('pointercancel', (e: PointerEvent) => {
  if (e.pointerId !== joyPointer) return
  joyPointer = null
  joyEnd()
})

document.getElementById('t-pause')!.addEventListener('touchstart', (e) => {
  e.preventDefault()
  if (appState === 'playing') pause()
  else if (appState === 'paused') resume()
}, { passive: false })

// audio unlock on first gesture
window.addEventListener('pointerdown', () => audio.ensure(), { once: true })

// level-clear panel: tap anywhere on the field to continue
stage.addEventListener('pointerdown', () => { if (ui.screen === 'clear') ui.show(null) })

// ---------- HUD ----------

function hudUpdate(view: Renderable) {
  if (appState === 'title') {
    ui.hudSet(null)
    if (lastHudVisible) { lastHudVisible = false; fit() }
    return
  }
  const p = view.players[0]
  const remaining = view.levelTime - view.time
  // urgency tick under 30s (once per second)
  const sec = Math.max(0, Math.ceil(remaining))
  if (remaining < 30 && sec !== lastTickSecond) {
    lastTickSecond = sec
    audio.play('tick')
  }
  let playerHtml = ''
  if (view.mode === 'campaign') {
    const hearts = '❤'.repeat(Math.max(0, view.lives))
    playerHtml = `<span style="color:#ff5252">${hearts}</span>
      <span class="pips">${pips(p.bombs, 8, 'bombs')}</span>
      <span class="pips">${pips(p.flame, 8, 'flame')}</span>
      <span class="pips">${pips(Math.round((p.speed - 4.2) / 0.9) + 1, 5, 'spd')}</span>`
  } else {
    const p2 = view.players[1]
    const rp = (n: number) => (n >= 2 ? '●●' : n === 1 ? '●○' : '○○')
    playerHtml = `<span style="color:${view.players[0]?.color ?? '#00e5ff'}">P1 ${rp(view.roundWins[0])} ⚔${p.kills}</span>
      <span style="color:${view.players[1]?.color ?? '#ff2e88'}">P2 ${rp(view.roundWins[1])} ⚔${p2?.kills ?? 0}</span>`
  }
  ui.hudSet({
    score: view.mode === 'campaign' ? view.score : view.players[0].kills * 1000 + view.players[1].kills * 1000,
    level: view.mode === 'campaign' ? view.level : 0,
    timer: remaining,
    timerDanger: remaining < 30,
    playerHtml,
  })
  // life-loss flash: red pulse on the player chip when a heart drops
  if (view.mode === 'campaign' && view.lives < lastLives) {
    const hp = document.getElementById('hud-player')!
    hp.classList.remove('hurt')
    void hp.offsetWidth // retrigger the animation
    hp.classList.add('hurt')
  }
  lastLives = view.mode === 'campaign' ? view.lives : -1
  // battle: kill flash — bump the player chip when either kill count goes up
  const kills = view.players.reduce((s, p) => s + (p.kills ?? 0), 0)
  if (kills > lastKills) {
    const hp = document.getElementById('hud-player')!
    hp.classList.remove('bump')
    void hp.offsetWidth // retrigger the bump animation
    hp.classList.add('bump')
  }
  lastKills = kills
  if (!lastHudVisible) { lastHudVisible = true; fit() }
}

function pips(n: number, max: number, label: string): string {
  let s = `<span title="${label}">`
  for (let i = 0; i < Math.min(max, 8); i++) s += `<span class="pip ${i < n ? 'on' : ''}"></span>`
  return s + '</span>'
}

// ---------- main loop ----------

const STEP = 1 / 60
let acc = 0
let last = performance.now()
let frame = 0

function loop(now: number) {
  requestAnimationFrame(loop)
  let dt = (now - last) / 1000
  last = now
  if (dt > 0.25) dt = 0.25

  // touch controls only during active play (menus / pause / game-over are control-free;
  // the level-clear panel freezes the field, so hide the controls under it)
  document.body.classList.toggle('ingame', appState === 'playing' && ui.screen !== 'clear')

  // menu keyboard mode (the level-clear panel also takes confirm keys)
  const inMenu = appState === 'title' || ui.screen === 'battle' || ui.screen === 'online' || ui.screen === 'scores' || ui.screen === 'settings' || ui.screen === 'clear'
  input.inMenu = inMenu && !ui.screen?.startsWith('over')

  if (game && appState !== 'paused' && !matchOver && ui.screen !== 'clear') {
    acc += dt
    while (acc >= STEP) {
      const inputs = input.poll()
      // host: P2 is the remote opponent (dir held, bomb/detonate are one-shot edges)
      const p2 = netRole === 'host'
        ? { dir: remoteInput.dir, bomb: remoteInput.bomb, detonate: remoteInput.detonate }
        : inputs.p2
      game.update(STEP, { p1: inputs.p1, p2 })
      if (netRole === 'host') { remoteInput.bomb = false; remoteInput.detonate = false }
      acc -= STEP
    }
    // host: broadcast snapshots ~30Hz (higher rate = smoother interpolation,
    // and frequency covers for the occasional lost/delayed snapshot)
    if (netRole === 'host') {
      snapTimer += dt
      if (snapTimer >= 1 / 30) {
        snapTimer = 0
        net.sendState(serializeGame(game))
      }
    }
    audio.suddenDeath = game.suddenDeath
  } else if (remote && appState === 'playing') {
    // online client: no local simulation — animate particles, forward input
    remote.particles.update(dt)
    remote.tickInterp(dt)
    audio.suddenDeath = remote.suddenDeath
    const inputs = input.poll()
    if (inputs.p1.dir !== lastSentDir) {
      lastSentDir = inputs.p1.dir
      net.sendInput(inputs.p1.dir, false, false)
    }
    if (inputs.p1.bomb) net.sendInput(lastSentDir, true, false)
    if (inputs.p1.detonate) net.sendInput(lastSentDir, false, true)
    acc = 0
  } else {
    input.poll() // consume so keys don't stick
  }

  if (pendingOver && game && game.state === 'over' && game.overTimer <= 0) {
    pendingOver = false
    appState = 'title'
    if (isHighScore(game.score)) {
      // golden celebration in the game world behind the overlay
      game.particles.burst(360, 180, '#ffd54a', 42, 280)
      game.particles.burst(360, 300, '#fff176', 30, 200)
      game.particles.burst(360, 240, '#ffffff', 20, 320)
      game.flash('255,213,74', 0.4, 0.7)
      audio.play('fanfare')
    }
    ui.showGameOver(game.score, game.level)
    ui.show('over')
    audio.setTrack('menu')
  }

  if (game) {
    // render interpolation: draw between the last two 60 Hz simulation ticks
    renderer.draw(game, now / 1000, appState === 'paused' ? 1 : Math.min(1, acc / STEP))
    hudUpdate(game)
  } else if (remote && remote.ready) {
    renderer.draw(remote, now / 1000, remote.alpha)
    hudUpdate(remote)
  }
  frame++
}

input.attach()
ui.init()
startAttract()

// auto-pause when the tab loses focus (prevents losing a life in the background)
// online clients can't pause — the host keeps simulating
// a host with a connected client also must not pause: that would freeze the opponent
const autoPause = () => { if (appState === 'playing' && netRole !== 'client' && !(netRole === 'host' && net.connected)) pause() }
window.addEventListener('blur', autoPause)
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause() })

// PWA: offline support
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

// debug hooks: ?start=campaign|battle|demo|flame|clear|pause|over|scores|settings  (demo = AI plays campaign)
// &steps=N pre-advances the sim N/60s (for deterministic screenshots)
// &level=N jumps campaign to level N (for theme/screenshot checks)
const params = new URLSearchParams(location.search)
const start = params.get('start')
// ?join=CODE pre-fills the online room code and opens the join screen
{
  const join = params.get('join')
  if (join && /^[A-Z0-9]{4,5}$/i.test(join)) { ui.show('online'); ui.showRoomCode(false); ui.onlineCode(join.toUpperCase()) }
}
let dbg: Game | null = null
if (start === 'campaign') dbg = startCampaign()
else if (start === 'battle') dbg = startBattle(params.get('ai') === '1')
else if (start === 'demo') {
  dbg = startCampaign()
  dbg.players[0].isAI = true
}
else if (start === 'flame') {
  dbg = startCampaign()
  for (let r = 4; r <= 8; r++) for (let c = 5; c <= 9; c++) dbg.grid[r][c].t = 0
  dbg.bombs.push({ id: dbg.bombId++, owner: 0, col: 7, row: 6, x: 7, y: 6, sliding: null, fuse: 120, power: 4, born: 0 })
  dbg.enemies.push({
    id: 999, type: 'balloom', col: 10, row: 6, x: 10, y: 6, prevX: 10, prevY: 6,
    dir: 1, moving: false, movingDir: null, tx: 10, ty: 6, moveTimer: 0, aiTimer: 0,
    hp: 1, alive: true, frozen: true, deadAt: 0, born: 0, seed: 0.5,
  })
  // pre-advance to explosion peak, then freeze the sim (deterministic screenshots)
  const idle = { dir: null as Dir | null, bomb: false, detonate: false }
  for (let i = 0; i < 18; i++) dbg.update(1 / 60, { p1: idle, p2: idle })
  appState = 'paused'
}
else if (start === 'clear') {
  dbg = startCampaign()
  for (const e of dbg.enemies) e.alive = false
  dbg.exit.revealed = true
  const p = dbg.players[0]
  p.col = dbg.exit.col; p.row = dbg.exit.row; p.x = dbg.exit.col; p.y = dbg.exit.row
}
else if (start === 'pause') {
  dbg = startCampaign()
}
else if (start === 'over') {
  dbg = startCampaign()
  dbg.lives = 0
  dbg.score = 12345
  dbg.killPlayer(dbg.players[0], 'flame')
}
else if (start === 'scores') {
  ui.showScores()
  ui.show('scores')
}
else if (start === 'settings') {
  ui.show('settings')
}
if (dbg) {
  const lvl = parseInt(params.get('level') ?? '0')
  if (lvl > 1 && dbg.mode !== 'battle') {
    for (let i = dbg.level; i < lvl; i++) dbg.nextLevel()
  }
  const steps = parseInt(params.get('steps') ?? '0')
  const idle = { dir: null as Dir | null, bomb: false, detonate: false }
  for (let i = 0; i < steps; i++) dbg.update(1 / 60, { p1: idle, p2: idle })
  if (start === 'pause') pause()
}

requestAnimationFrame(loop)
