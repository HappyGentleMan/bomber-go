import { Game } from './game'
import { Renderer } from './render'
import { ui } from './ui'
import { input } from './input'
import { audio } from './audio'
import { CANVAS_W, CANVAS_H } from './constants'
import type { Dir } from './constants'

const stage = document.getElementById('stage')!
const canvas = document.getElementById('game') as HTMLCanvasElement
const renderer = new Renderer(canvas)

let appState: 'title' | 'playing' | 'paused' = 'title'
let game: Game | null = null
let pendingOver = false
let battleOpts = { aiPlayer2: false, attract: false }

// ---------- layout ----------

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
}
window.addEventListener('resize', fit)
fit()

// ---------- game lifecycle ----------

function startCampaign(): Game {
  game = new Game('campaign')
  wireGame()
  appState = 'playing'
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
        ui.banner(`LEVEL ${data.level}`, 1.2)
        break
      case 'gameover':
        pendingOver = true
        break
      case 'suddendeath':
        ui.banner('⚠ SUDDEN DEATH ⚠', 1.6)
        break
      case 'battleover':
        if (game!.attract) {
          window.setTimeout(startAttract, 1500)
        } else {
          ui.showBattleOver(data.winner)
          ui.show('battleover')
          appState = 'title'
        }
        break
    }
  }
}

function toTitle() {
  appState = 'title'
  game = null
  startAttract()
}

function pause() {
  if (appState !== 'playing' || !game) return
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
    case 'scores': ui.showScores(); ui.show('scores'); break
    case 'settings': ui.show('settings'); break
    case 'back':
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
      startBattle(battleOpts.aiPlayer2)
      break
  }
}

input.onTogglePause = () => {
  if (appState === 'playing') pause()
  else if (appState === 'paused') resume()
}
input.onMenuNav = (d) => {
  if (appState === 'title' || ui.screen === 'battle' || ui.screen === 'scores' || ui.screen === 'settings') {
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

function hudUpdate() {
  if (!game || appState === 'title') { ui.hudSet(null); return }
  const p = game.players[0]
  const remaining = game.levelTime - game.time
  let playerHtml = ''
  if (game.mode === 'campaign') {
    const hearts = '❤'.repeat(Math.max(0, game.lives))
    playerHtml = `<span style="color:#ff5252">${hearts}</span>
      <span class="pips">${pips(p.bombs, 8, 'bombs')}</span>
      <span class="pips">${pips(p.flame, 8, 'flame')}</span>
      <span class="pips">${pips(Math.round((p.speed - 4.2) / 0.9) + 1, 5, 'spd')}</span>`
  } else {
    const p2 = game.players[1]
    playerHtml = `<span style="color:#00e5ff">P1 ⚔${p.kills}</span>
      <span style="color:#ff2e88">P2 ⚔${p2?.kills ?? 0}</span>`
  }
  ui.hudSet({
    score: game.mode === 'campaign' ? game.score : game.players[0].kills * 1000 + game.players[1].kills * 1000,
    level: game.mode === 'campaign' ? game.level : 0,
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
  const inMenu = appState === 'title' || ui.screen === 'battle' || ui.screen === 'scores' || ui.screen === 'settings'
  input.inMenu = inMenu && !ui.screen?.startsWith('over')

  if (game && appState !== 'paused') {
    acc += dt
    while (acc >= STEP) {
      const inputs = input.poll()
      // AI players in attract/battle
      game.update(STEP, { p1: inputs.p1, p2: inputs.p2 })
      acc -= STEP
    }
    audio.suddenDeath = game.suddenDeath
  } else {
    input.poll() // consume so keys don't stick
  }

  if (pendingOver && game && game.state === 'over' && game.overTimer <= 0) {
    pendingOver = false
    appState = 'title'
    ui.showGameOver(game.score, game.level)
    ui.show('over')
    audio.setTrack('menu')
  }

  if (game) {
    renderer.draw(game, now / 1000)
    hudUpdate()
  }
  frame++
}

input.attach()
ui.init()
startAttract()

// PWA: offline support
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}

// debug hooks: ?start=campaign|battle|demo|flame|clear|pause|over  (demo = AI plays campaign)
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
    id: 999, type: 'balloom', col: 10, row: 6, x: 10, y: 6,
    dir: 1, moving: false, movingDir: null, moveTimer: 0, aiTimer: 0,
    hp: 1, alive: true, frozen: true, deadAt: 0, born: 0, seed: 0.5,
  })
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
