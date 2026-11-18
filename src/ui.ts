import { audio } from './audio'
import { settings, updateSettings, getScores, isHighScore, addScore } from './storage'

type Screen = 'title' | 'battle' | 'settings' | 'scores' | 'pause' | 'over' | 'clear' | 'battleover'

const $ = (id: string) => document.getElementById(id)!

export class UI {
  screen: Screen | null = 'title'
  hud: { score: number; level: number; timer: number; timerDanger: boolean; playerHtml: string } | null = null
  onAction: ((action: string) => void) | null = null
  menuIndex = 0
  menuScreen: HTMLElement | null = null
  savedScore = false
  private scoreRaf = 0

  init() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        audio.ensure()
        const a = (btn as HTMLElement).dataset.action!
        audio.play('menuSelect')
        this.onAction?.(a)
      })
    })

    // settings bindings
    const music = $('set-music') as HTMLInputElement
    const sfx = $('set-sfx') as HTMLInputElement
    music.value = String(settings.musicVol)
    sfx.value = String(settings.sfxVol)
    music.addEventListener('input', () => audio.setMusicVolume(+music.value))
    sfx.addEventListener('input', () => audio.setSfxVolume(+sfx.value))
    const shake = $('set-shake')
    shake.classList.toggle('on', settings.shake)
    shake.addEventListener('click', () => {
      settings.shake = !settings.shake
      updateSettings({ shake: settings.shake })
      shake.classList.toggle('on', settings.shake)
      audio.play('menuSelect')
    })
    const touch = $('set-touch')
    touch.classList.toggle('on', settings.touch === 'on')
    touch.addEventListener('click', () => {
      const next = settings.touch === 'auto' ? 'on' : settings.touch === 'on' ? 'off' : 'auto'
      updateSettings({ touch: next })
      touch.classList.toggle('on', next === 'on')
      audio.play('menuSelect')
      this.applyTouchVisibility()
    })
    this.applyTouchVisibility()
  }

  applyTouchVisibility() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    const show = settings.touch === 'on' || (settings.touch === 'auto' && isTouchDevice)
    document.body.classList.toggle('touch', show)
  }

  show(screen: Screen | null) {
    if (this.screen && screen !== this.screen) {
      const el = $(`ui-${this.screen}`)
      if (el) el.classList.add('hidden')
    }
    this.screen = screen
    if (!screen) return
    const el = $(`ui-${screen}`)
    if (el) el.classList.remove('hidden')
    if (screen === 'title') {
      const top = getScores()[0]
      ;($('title-top') as HTMLElement).textContent = top
        ? `TOP SCORE  ${top.score.toLocaleString()}  ·  ${top.initials}`
        : ''
    }
    // menu selection state
    if (screen === 'title' || screen === 'battle') {
      const menu = $(screen === 'title' ? 'menu-main' : 'menu-battle')
      this.setMenu(menu)
    }
  }

  setMenu(menu: HTMLElement) {
    this.menuScreen = menu
    const btns = [...menu.querySelectorAll<HTMLButtonElement>('.btn')]
    btns.forEach((b, i) => b.classList.toggle('sel', i === this.menuIndex))
  }

  menuNav(d: 'up' | 'down' | 'ok' | 'back') {
    if (!this.menuScreen) return
    const btns = [...this.menuScreen.querySelectorAll<HTMLButtonElement>('.btn')]
    if (!btns.length) return
    if (d === 'up') {
      this.menuIndex = (this.menuIndex - 1 + btns.length) % btns.length
      audio.play('menuMove')
    } else if (d === 'down') {
      this.menuIndex = (this.menuIndex + 1) % btns.length
      audio.play('menuMove')
    } else if (d === 'ok') {
      btns[this.menuIndex].click()
      return
    } else {
      this.onAction?.('back')
      return
    }
    this.setMenu(this.menuScreen)
  }

  banner(text: string, dur = 1.4) {
    const el = $('banner')
    el.textContent = text
    el.classList.add('show')
    window.setTimeout(() => el.classList.remove('show'), dur * 1000)
  }

  hudSet(h: { score: number; level: number; timer: number; timerDanger: boolean; playerHtml: string } | null) {
    this.hud = h
    const el = $('hud')
    if (!h) { el.classList.add('hidden'); return }
    el.classList.remove('hidden')
    $('hud-score-v').textContent = h.score.toLocaleString()
    $('hud-level').textContent = h.level > 0 ? `LV ${h.level}` : ''
    const timer = $('hud-timer')
    timer.textContent = String(Math.max(0, Math.ceil(h.timer)))
    timer.classList.toggle('danger', h.timerDanger)
    $('hud-player').innerHTML = h.playerHtml
  }

  showScores() {
    const list = getScores()
    const el = $('scores-list')
    if (!list.length) {
      el.innerHTML = '<div class="hint" style="padding:10px">No scores yet — go blast some bricks!</div>'
      return
    }
    el.innerHTML = list.map((s, i) =>
      `<div><span>${i + 1}. <b style="color:#ffd54a">${s.initials}</b> <span class="hint">${s.mode === 'battle' ? 'BATTLE' : 'LV ' + s.level}</span></span><span class="val">${s.score.toLocaleString()}</span></div>`
    ).join('')
  }

  showGameOver(score: number, level: number) {
    this.savedScore = false
    // count-up animation
    const el = $('over-score')
    if (this.scoreRaf) cancelAnimationFrame(this.scoreRaf)
    const t0 = performance.now(), dur = 900
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur)
      const ease = 1 - Math.pow(1 - k, 3)
      el.textContent = Math.round(score * ease).toLocaleString()
      if (k < 1) this.scoreRaf = requestAnimationFrame(tick)
    }
    this.scoreRaf = requestAnimationFrame(tick)
    $('over-best').textContent = `Reached level ${level}`
    const isNew = isHighScore(score)
    $('over-new').classList.toggle('hidden', !isNew)
    $('over-save').classList.toggle('hidden', !isNew)
    const inp = $('over-initials') as HTMLInputElement
    inp.value = ''
    if (isNew) window.setTimeout(() => inp.focus(), 100)
  }

  saveScore(score: number, level: number, mode: 'campaign' | 'battle') {
    if (this.savedScore) return
    const inp = $('over-initials') as HTMLInputElement
    let init = (inp.value || 'AAA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
    while (init.length < 3) init += 'A'
    addScore({ initials: init, score, mode, level, date: Date.now() })
    this.savedScore = true
  }

  showLevelClear(level: number, bonus: number, score: number, lives: number) {
    $('clear-stats').innerHTML =
      `LEVEL ${level} CLEARED<br>BONUS +${bonus.toLocaleString()} · TOTAL ${score.toLocaleString()}<br>❤ ×${lives}`
  }

  showBattleOver(winner: number, kills?: [number, number], cpu = false) {
    const el = $('battle-result')
    const name1 = 'PLAYER 1', name2 = cpu ? 'CPU' : 'PLAYER 2'
    if (winner === -1) { el.textContent = 'DRAW!'; el.style.setProperty('-webkit-text-fill-color', '#888') }
    else {
      el.textContent = winner === 0 ? `${name1} WINS` : `${name2} WINS`
      el.style.setProperty('-webkit-text-fill-color', winner === 0 ? '#00e5ff' : '#ff2e88')
    }
    const stats = $('battle-stats')
    if (stats) stats.textContent = kills ? `KILLS  ${kills[0]} — ${kills[1]}` : ''
  }
}

export const ui = new UI()
