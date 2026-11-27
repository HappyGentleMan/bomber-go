import { audio } from './audio'
import { haptic } from './game'
import { settings, updateSettings, getScores, isHighScore, addScore } from './storage'
import { PLAYER_COLORS, CHARACTERS } from './constants'
import { drawCharBody } from './render'

type Screen = 'title' | 'battle' | 'online' | 'settings' | 'scores' | 'pause' | 'over' | 'clear' | 'battleover'

const $ = (id: string) => document.getElementById(id)!

export class UI {
  screen: Screen | null = 'title'
  hud: { score: number; level: number; timer: number; timerDanger: boolean; playerHtml: string } | null = null
  onAction: ((action: string) => void) | null = null
  onColorChange: ((color: string) => void) | null = null
  onCharChange: ((char: string) => void) | null = null
  onMoveStyleChange: ((style: 'joystick' | 'dpad') => void) | null = null
  menuIndex = 0
  menuScreen: HTMLElement | null = null
  savedScore = false
  private scoreRaf = 0
  private bannerTimer = 0
  private lastPlayerHtml = ''

  init() {
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        audio.ensure()
        const a = (btn as HTMLElement).dataset.action!
        audio.play('menuSelect')
        haptic(8, 0.3, 0.2) // light confirm tick
        // a clicked menu button becomes the keyboard selection — no stale highlight
        const menu = (btn as HTMLElement).closest('.menu')
        if (menu) {
          const i = [...menu.querySelectorAll('.btn')].indexOf(btn)
          if (i >= 0) this.menuIndex = i
        }
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
    const move = $('set-move')
    const moveLabel = $('set-move-label')
    const applyMove = () => {
      move.classList.toggle('on', settings.moveStyle === 'joystick')
      moveLabel.textContent = settings.moveStyle === 'joystick' ? 'MOVE: JOYSTICK' : 'MOVE: D-PAD'
    }
    move.addEventListener('click', () => {
      settings.moveStyle = settings.moveStyle === 'joystick' ? 'dpad' : 'joystick'
      updateSettings({ moveStyle: settings.moveStyle })
      applyMove()
      this.onMoveStyleChange?.(settings.moveStyle)
      audio.play('menuSelect')
    })
    applyMove()
    // color swatches
    const colorRow = $('set-color')
    if (colorRow) {
      for (const c of PLAYER_COLORS) {
        const s = document.createElement('div')
        s.className = 'swatch' + (c === settings.color ? ' active' : '')
        s.style.background = c
        s.style.color = c
        s.addEventListener('click', () => {
          settings.color = c
          updateSettings({ color: c })
          colorRow.querySelectorAll('.swatch').forEach(x => x.classList.toggle('active', (x as HTMLElement) === s))
          audio.play('menuSelect')
          this.onColorChange?.(c)
          this.renderCharPreviews() // re-tint the character previews
        })
        colorRow.appendChild(s)
      }
    }
    // character picks (mini canvas previews in the current color)
    const charRow = $('set-char')
    if (charRow) {
      for (const ch of CHARACTERS) {
        const s = document.createElement('div')
        s.className = 'charopt' + (ch === settings.character ? ' active' : '')
        s.dataset.char = ch
        const cv = document.createElement('canvas')
        cv.width = 64; cv.height = 64
        cv.style.width = '32px'; cv.style.height = '32px'
        s.appendChild(cv)
        s.addEventListener('click', () => {
          settings.character = ch
          updateSettings({ character: ch })
          charRow.querySelectorAll('.charopt').forEach(x => x.classList.toggle('active', (x as HTMLElement) === s))
          audio.play('menuSelect')
          this.onCharChange?.(ch)
        })
        charRow.appendChild(s)
      }
      this.renderCharPreviews()
    }
    this.applyTouchVisibility()
    // online: Enter in the room-code field joins
    const codeEl = $('online-code') as HTMLInputElement | null
    codeEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ;(document.querySelector('[data-action="online-join"]') as HTMLButtonElement)?.click()
      }
    })
  }

  /** re-tint the character preview canvases with the currently selected color */
  renderCharPreviews() {
    const row = $('set-char')
    if (!row) return
    row.querySelectorAll('.charopt').forEach(el => {
      const ch = (el as HTMLElement).dataset.char!
      const cv = el.querySelector('canvas')!
      const c = cv.getContext('2d')!
      c.clearRect(0, 0, 64, 64)
      c.save()
      c.scale(2, 2)
      c.translate(16, 16)
      drawCharBody(c, ch, settings.color)
      c.restore()
    })
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
    // menu selection state (pause/over/battleover are keyboard-navigable too)
    const menuIds: Partial<Record<Screen, string>> = {
      title: 'menu-main', battle: 'menu-battle', online: 'menu-online',
      pause: 'menu-pause', over: 'menu-over', battleover: 'menu-battleover',
    }
    const mid = menuIds[screen]
    if (mid) {
      this.setMenu($(mid))
    } else {
      // settings/scores/clear have no menu — drop the stale selection
      this.menuScreen = null
      this.menuIndex = 0
    }
  }

  onlineStatus(msg: string, tone: 'info' | 'ok' | 'err' = 'info') {
    const el = $('online-status')
    if (!el) return
    const icon = tone === 'ok' ? 'i-check' : tone === 'err' ? 'i-alert' : 'i-spinner'
    const spin = tone === 'info' ? ' class="spin"' : ''
    el.innerHTML = `<svg${spin}><use href="#${icon}"/></svg><span></span>`
    el.querySelector('span')!.textContent = msg
    el.style.color = tone === 'ok' ? '#7dffa8' : tone === 'err' ? '#ff8080' : 'var(--neon)'
  }

  onlineCode(code: string) {
    const el = $('online-code') as HTMLInputElement | null
    if (el) el.value = code
  }

  getOnlineCode(): string {
    const el = $('online-code') as HTMLInputElement | null
    return el ? el.value.trim().toUpperCase() : ''
  }

  showRoomCode(show: boolean) {
    const box = $('room-code-box')
    const row = $('join-row')
    if (box) box.classList.toggle('hidden', !show)
    if (row) row.classList.toggle('hidden', show)
  }

  setRoomTiles(code: string) {
    const el = $('room-tiles')
    if (!el) return
    el.innerHTML = ''
    for (const ch of code) {
      const s = document.createElement('span')
      s.textContent = ch
      el.appendChild(s)
    }
  }

  setRematchHidden(hidden: boolean) {
    const el = document.querySelector('[data-action="rematch"]')
    if (el) el.classList.toggle('hidden', hidden)
  }

  setMenu(menu: HTMLElement) {
    this.menuScreen = menu
    const btns = [...menu.querySelectorAll<HTMLButtonElement>('.btn:not(.hidden)')]
    btns.forEach((b, i) => b.classList.toggle('sel', i === this.menuIndex))
  }

  menuNav(d: 'up' | 'down' | 'ok' | 'back') {
    if (!this.menuScreen) return
    const btns = [...this.menuScreen.querySelectorAll<HTMLButtonElement>('.btn:not(.hidden)')]
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
    // shrink to fit so long messages don't clip on narrow screens
    el.style.fontSize = ''
    const ratio = el.clientWidth / el.scrollWidth
    if (ratio < 1) el.style.fontSize = `${Math.max(12, Math.floor(ratio * parseFloat(getComputedStyle(el).fontSize)))}px`
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), dur * 1000)
  }

  hudSet(h: { score: number; level: number; timer: number; timerDanger: boolean; playerHtml: string } | null) {
    this.hud = h
    const el = $('hud')
    if (!h) { el.classList.add('hidden'); return }
    el.classList.remove('hidden')
    $('hud-score-v').textContent = h.score.toLocaleString()
    $('hud-level').textContent = h.level > 0 ? `LV ${h.level}` : ''
    ;($('hud-level').parentElement as HTMLElement).classList.toggle('hidden', h.level <= 0)
    const timer = $('hud-timer')
    timer.textContent = String(Math.max(0, Math.ceil(h.timer)))
    timer.classList.toggle('danger', h.timerDanger)
    const pl = $('hud-player')
    if (h.playerHtml !== this.lastPlayerHtml) {
      pl.innerHTML = h.playerHtml
      this.lastPlayerHtml = h.playerHtml
      pl.classList.remove('bump')
      void pl.offsetWidth // retrigger the bump animation
      pl.classList.add('bump')
    }
  }

  showScores() {
    const list = getScores()
    const el = $('scores-list')
    if (!list.length) {
      el.innerHTML = '<div class="scores-empty"><svg><use href="#i-scores"/></svg><span class="hint">No scores yet — go blast some bricks!</span></div>'
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
    // Enter saves + closes the keyboard (mobile)
    inp.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        ;($('over-save') as HTMLButtonElement).click()
        inp.blur()
      }
    }
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

  showBattleOver(winner: number, kills?: [number, number], cpu = false, rounds?: [number, number], names?: [string, string]) {
    const el = $('battle-result')
    const name1 = names ? names[0] : 'PLAYER 1', name2 = names ? names[1] : (cpu ? 'CPU' : 'PLAYER 2')
    if (winner === -1) { el.textContent = 'DRAW!'; el.style.setProperty('-webkit-text-fill-color', '#888') }
    else {
      el.textContent = winner === 0 ? `${name1} WINS` : `${name2} WINS`
      el.style.setProperty('-webkit-text-fill-color', winner === 0 ? '#00e5ff' : '#ff2e88')
    }
    const stats = $('battle-stats')
    if (stats) {
      let s = ''
      if (rounds) s += `ROUNDS ${rounds[0]} — ${rounds[1]}   `
      if (kills) s += `KILLS ${kills[0]} — ${kills[1]}`
      stats.textContent = s
    }
  }
}

export const ui = new UI()
