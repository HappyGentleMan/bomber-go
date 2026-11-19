import { Game, haptic } from './game'
import { Renderer, type Renderable } from './render'
import { ui } from './ui'
import { input } from './input'
import { audio } from './audio'
import { net } from './net'
import { serializeGame, RemoteGame, diffSnapshots } from './netgame'
import { CANVAS_W, CANVAS_H, POWERUP_DEFS } from './constants'
import { isHighScore } from './storage'
import type { Dir, PowerupKind } from './constants'

const stage = document.getElementById('stage')!
const canvas = document.getElementById('game') as HTMLCanvasElement
const renderer = new Renderer(canvas)

let appState: 'title' | 'playing' | 'paused' = 'title'
let game: Game | null = null
let pendingOver = false
let battleOpts = { aiPlayer2: false, attract: false }
let lastTickSecond = -1

// ---------- online battle state ----------
let netRole: 'none' | 'host' | 'client' = 'none'
let remote: RemoteGame | null = null
let prevSnap: any = null
// host: P2 input arrives from the remote client (dir = held, bomb/detonate = edges)
let remoteInput = { dir: null as Dir | null, bomb: false, detonate: false }
// client: track last sent dir to only send on change
let lastSentDir: Dir | null = null
let snapTimer = 0

// Live debug handle for browser inspection / automated testing (read-only view).
Object.defineProperty(window, '__game', { get: () => game, configurable: true })
Object.defineProperty(window, '__input', { get: () => input, configurable: true })
Object.defineProperty(window, '__net', { get: () => net, configurable: true })

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
    kick: 'kick bombs further',
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

/** place the touch clusters in the black letterbox around the canvas
 *  (side bars in landscape, bottom bar in portrait) so they never cover the game */
function layoutTouch() {
  const sr = stage.getBoundingClientRect()
  const side = (window.innerWidth - sr.width) / 2
  const bottom = (window.innerHeight - sr.height) / 2
  const dpadW = 178, dpadH = 116, actW = 84, actH = 138
  if (side >= dpadW + 16) {
    // landscape: black bars on the left & right (cluster fits fully)
    dpad.style.left = `${Math.max(8, side / 2 - dpadW / 2)}px`
    dpad.style.top = `${Math.max(8, (window.innerHeight - dpadH) / 2)}px`
    dpad.style.right = 'auto'
    dpad.style.bottom = 'auto'
    actions.style.right = `${Math.max(8, side / 2 - actW / 2)}px`
    actions.style.top = `${Math.max(8, (window.innerHeight - actH) / 2)}px`
    actions.style.left = 'auto'
    actions.style.bottom = 'auto'
  } else {
    // portrait (or narrow): black bar below the canvas
    dpad.style.left = '14px'
    dpad.style.bottom = `${Math.max(8, bottom / 2 - dpadH / 2)}px`
    dpad.style.top = 'auto'
    dpad.style.right = 'auto'
    actions.style.right = '14px'
    actions.style.bottom = `${Math.max(8, bottom / 2 - actH / 2)}px`
    actions.style.top = 'auto'
    actions.style.left = 'auto'
  }
}

function fit() {
  const pad = 16
  const availW = window.innerWidth - pad
  const availH = window.innerHeight - pad
  const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H)
  const w = Math.floor(CANVAS_W * scale)
  const h = Math.floor(CANVAS_H * scale)
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

function startCampaign(): Game {
  game = new Game('campaign')
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
  game = new Game('battle', { aiPlayer2: aiP2 })
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
  game = new Game('battle', { aiPlayer2: true, attract: true })
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
}

function hostOnline() {
  if (netRole !== 'none') return
  net.onError = (msg) => {
    ui.onlineStatus(msg, 'err')
    if (!net.connected) leaveNet()
  }
  net.host()
  ui.onlineStatus(`ROOM ${net.roomCode} — share the code, waiting for opponent…`)
  net.onOpen = () => {
    ui.onlineStatus(`OPPONENT CONNECTED — FIGHT!`, 'ok')
    netRole = 'host'
    game = new Game('battle', { aiPlayer2: false })
    wireGame()
    appState = 'playing'
    lastTickSecond = -1
    ui.show(null)
    ui.banner('FIGHT!', 1.5)
    audio.setTrack('battle')
    audio.ensure()
  }
}

function joinOnline() {
  if (netRole !== 'none') return
  const code = ui.getOnlineCode()
  if (code.length < 4) { ui.onlineStatus('Enter the 5-letter room code first', 'err'); return }
  ui.onlineStatus(`Joining room ${code}…`)
  net.onError = (msg) => {
    ui.onlineStatus(msg, 'err')
    if (!net.connected) leaveNet()
  }
  net.onOpen = () => {
    ui.onlineStatus('CONNECTED — FIGHT!', 'ok')
    netRole = 'client'
    remote = new RemoteGame()
    prevSnap = null
    game = null
    appState = 'playing'
    lastTickSecond = -1
    ui.show(null)
    ui.banner('FIGHT!', 1.5)
    audio.setTrack('battle')
    audio.ensure()
  }
  net.join(code)
}

/** host: receive the client's input; both: handle drop-offs */
net.onMessage = (m) => {
  if (m.t === 'input' && netRole === 'host') {
    remoteInput.dir = m.dir as Dir | null // null = released → stop
    if (m.bomb) remoteInput.bomb = true
    if (m.detonate) remoteInput.detonate = true
    return
  }
  if (m.t !== 'state' || netRole !== 'client' || !remote) return
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
          window.setTimeout(startAttract, 1500)
        } else {
          const online = netRole === 'host'
          ui.showBattleOver(data.winner, [game!.players[0].kills, game!.players[1].kills], battleOpts.aiPlayer2,
            data.roundWins as [number, number] | undefined,
            online ? ['YOU', 'OPPONENT'] : undefined)
          ui.setRematchHidden(online)
          ui.show('battleover')
          appState = 'title'
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

ui.onAction = (action: string) => {
  switch (action) {
    case 'campaign': startCampaign(); break
    case 'battle': ui.show('battle'); ui.menuIndex = 0; break
    case 'battle-1p': startBattle(true); break
    case 'battle-2p': startBattle(false); break
    case 'online': ui.show('online'); ui.menuIndex = 0; break
    case 'online-host': hostOnline(); break
    case 'online-join': joinOnline(); break
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
  if (appState === 'title' || ui.screen === 'battle' || ui.screen === 'online' || ui.screen === 'scores' || ui.screen === 'settings') {
    if (ui.screen === 'pause') return
    if (ui.screen === 'over') return
    ui.menuNav(d)
  }
}

// ---------- touch ----------

function bindTouch(id: string, dir: Dir | null, bomb = false) {
  const el = document.getElementById(id)!
  const on = (e: Event) => {
    e.preventDefault()
    audio.ensure()
    if (bomb) input.setTouchBomb()
    else input.setTouchDir(dir)
  }
  const off = (e: Event) => {
    e.preventDefault()
    if (!bomb) input.setTouchDir(null)
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
document.getElementById('t-pause')!.addEventListener('touchstart', (e) => {
  e.preventDefault()
  if (appState === 'playing') pause()
  else if (appState === 'paused') resume()
}, { passive: false })

// audio unlock on first gesture
window.addEventListener('pointerdown', () => audio.ensure(), { once: true })

// ---------- HUD ----------

function hudUpdate(view: Renderable) {
  if (appState === 'title') { ui.hudSet(null); return }
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
    playerHtml = `<span style="color:#00e5ff">P1 ${rp(view.roundWins[0])} ⚔${p.kills}</span>
      <span style="color:#ff2e88">P2 ${rp(view.roundWins[1])} ⚔${p2?.kills ?? 0}</span>`
  }
  ui.hudSet({
    score: view.mode === 'campaign' ? view.score : view.players[0].kills * 1000 + view.players[1].kills * 1000,
    level: view.mode === 'campaign' ? view.level : 0,
    timer: remaining,
    timerDanger: remaining < 30,
    playerHtml,
  })
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

  // menu keyboard mode
  const inMenu = appState === 'title' || ui.screen === 'battle' || ui.screen === 'online' || ui.screen === 'scores' || ui.screen === 'settings'
  input.inMenu = inMenu && !ui.screen?.startsWith('over')

  if (game && appState !== 'paused') {
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
    // host: broadcast snapshots ~20Hz
    if (netRole === 'host') {
      snapTimer += dt
      if (snapTimer >= 0.05) {
        snapTimer = 0
        net.send({ t: 'state', s: serializeGame(game) })
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
      net.send({ t: 'input', dir: inputs.p1.dir, bomb: false, detonate: false })
    }
    if (inputs.p1.bomb) net.send({ t: 'input', dir: lastSentDir, bomb: true, detonate: false })
    if (inputs.p1.detonate) net.send({ t: 'input', dir: lastSentDir, bomb: false, detonate: true })
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
  } else if (remote) {
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
const autoPause = () => { if (appState === 'playing' && netRole !== 'client') pause() }
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
  dbg.bombs.push({ id: dbg.bombId++, owner: 0, col: 7, row: 6, fuse: 120, power: 4, born: 0 })
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
