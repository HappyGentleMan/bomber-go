// Procedural audio: all SFX + music synthesized with WebAudio. No asset files.

import { settings, updateSettings } from './storage'

type SfxName =
  | 'step' | 'bomb' | 'boom' | 'boomBig' | 'powerup' | 'hurt'
  | 'menuMove' | 'menuSelect' | 'levelClear' | 'gameOver'
  | 'freeze' | 'kick' | 'exit' | 'spawn' | 'shield' | 'count'
  | 'combo' | 'tick' | 'fanfare'

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private musicTimer: number | null = null
  private musicStep = 0
  private musicNext = 0
  private track: 'none' | 'menu' | 'game' | 'battle' = 'none'

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      if (this.track !== 'none' && this.musicTimer === null) {
        this.musicNext = this.ctx.currentTime + 0.1
        this.musicTimer = window.setInterval(() => this.musicTick(), 30)
      }
      return
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(this.ctx.destination)
    this.musicGain = this.ctx.createGain()
    this.musicGain.connect(this.master)
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.connect(this.master)
    this.applyVolumes()
    // noise buffer
    const len = this.ctx.sampleRate * 1
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }

  muted = false
  /** when true, music tempo +30% for sudden-death tension */
  suddenDeath = false

  toggleMute(): boolean {
    this.muted = !this.muted
    this.applyVolumes()
    return this.muted
  }

  applyVolumes() {
    if (!this.ctx || !this.musicGain || !this.sfxGain) return
    this.musicGain.gain.value = this.muted ? 0 : (settings.musicVol / 100) * 0.5
    this.sfxGain.gain.value = this.muted ? 0 : (settings.sfxVol / 100) * 0.9
  }

  setMusicVolume(v: number) { updateSettings({ musicVol: v }); this.applyVolumes() }
  setSfxVolume(v: number) { updateSettings({ sfxVol: v }); this.applyVolumes() }

  // ---------- primitives ----------

  private tone(freq: number, dur: number, opts: {
    type?: OscillatorType; vol?: number; attack?: number; decay?: number
    slideTo?: number; when?: number; dest?: AudioNode; vibrato?: number
  } = {}) {
    if (!this.ctx || !this.sfxGain) return
    const t0 = this.ctx.currentTime + (opts.when ?? 0)
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = opts.type ?? 'square'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), t0 + dur)
    const vol = opts.vol ?? 0.2
    const atk = opts.attack ?? 0.005
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + atk)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(opts.dest ?? this.sfxGain)
    osc.start(t0)
    osc.stop(t0 + dur + 0.05)
  }

  private noise(dur: number, opts: {
    vol?: number; freq?: number; q?: number; type?: BiquadFilterType
    slideTo?: number; when?: number; dest?: AudioNode
  } = {}) {
    if (!this.ctx || !this.sfxGain || !this.noiseBuf) return
    const t0 = this.ctx.currentTime + (opts.when ?? 0)
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const f = this.ctx.createBiquadFilter()
    f.type = opts.type ?? 'lowpass'
    f.frequency.setValueAtTime(opts.freq ?? 800, t0)
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur)
    f.Q.value = opts.q ?? 0.8
    const g = this.ctx.createGain()
    const vol = opts.vol ?? 0.3
    g.gain.setValueAtTime(vol, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f); f.connect(g); g.connect(opts.dest ?? this.sfxGain)
    src.start(t0)
    src.stop(t0 + dur + 0.05)
  }

  // ---------- SFX ----------

  play(name: SfxName) {
    this.ensure()
    if (!this.ctx || !this.sfxGain) return
    const g = this.sfxGain
    switch (name) {
      case 'step':
        this.noise(0.05, { vol: 0.06, freq: 1400, type: 'bandpass', q: 2, dest: g })
        break
      case 'bomb':
        this.tone(220, 0.12, { type: 'sine', vol: 0.3, slideTo: 110, dest: g })
        this.tone(880, 0.06, { type: 'square', vol: 0.12, when: 0.12, dest: g })
        break
      case 'boom': {
        this.noise(0.5, { vol: 0.5, freq: 2200, slideTo: 120, dest: g })
        this.tone(90, 0.45, { type: 'sine', vol: 0.5, slideTo: 30, dest: g })
        this.tone(60, 0.3, { type: 'triangle', vol: 0.3, when: 0.02, slideTo: 25, dest: g })
        break
      }
      case 'boomBig': {
        this.noise(0.8, { vol: 0.6, freq: 3000, slideTo: 80, dest: g })
        this.tone(70, 0.7, { type: 'sine', vol: 0.6, slideTo: 24, dest: g })
        this.noise(0.4, { vol: 0.3, freq: 500, type: 'highpass', when: 0.05, dest: g })
        break
      }
      case 'powerup':
        this.tone(523, 0.09, { vol: 0.18, dest: g })
        this.tone(659, 0.09, { vol: 0.18, when: 0.08, dest: g })
        this.tone(784, 0.16, { vol: 0.2, when: 0.16, dest: g })
        this.tone(1047, 0.22, { vol: 0.2, when: 0.24, dest: g })
        break
      case 'hurt':
        this.tone(300, 0.35, { type: 'sawtooth', vol: 0.25, slideTo: 60, dest: g })
        this.noise(0.25, { vol: 0.2, freq: 900, slideTo: 200, dest: g })
        break
      case 'menuMove':
        this.tone(700, 0.05, { vol: 0.12, dest: g })
        break
      case 'menuSelect':
        this.tone(500, 0.06, { vol: 0.15, dest: g })
        this.tone(1000, 0.1, { vol: 0.15, when: 0.05, dest: g })
        break
      case 'levelClear':
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
          this.tone(f, 0.18, { vol: 0.2, when: i * 0.09, dest: g }))
        this.tone(1568, 0.5, { vol: 0.18, when: 0.45, dest: g })
        break
      case 'gameOver':
        [392, 330, 262, 196].forEach((f, i) =>
          this.tone(f, 0.3, { type: 'triangle', vol: 0.22, when: i * 0.22, dest: g }))
        break
      case 'fanfare':
        [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) =>
          this.tone(f, 0.16, { vol: 0.2, when: i * 0.08, dest: g }))
        this.tone(1568, 0.6, { type: 'square', vol: 0.12, when: 0.64, dest: g })
        break
      case 'freeze':
        this.tone(2000, 0.4, { type: 'sine', vol: 0.15, slideTo: 400, dest: g })
        this.tone(2600, 0.3, { type: 'sine', vol: 0.1, when: 0.05, slideTo: 600, dest: g })
        break
      case 'kick':
        this.noise(0.12, { vol: 0.25, freq: 2500, slideTo: 400, type: 'bandpass', q: 3, dest: g })
        break
      case 'exit':
        this.tone(400, 0.3, { type: 'sine', vol: 0.2, slideTo: 1200, dest: g })
        this.noise(0.25, { vol: 0.12, freq: 3000, slideTo: 6000, type: 'highpass', dest: g })
        break
      case 'spawn':
        this.tone(200, 0.25, { type: 'sine', vol: 0.2, slideTo: 800, dest: g })
        break
      case 'shield':
        this.tone(800, 0.15, { type: 'sine', vol: 0.18, dest: g })
        this.tone(1200, 0.2, { type: 'sine', vol: 0.15, when: 0.1, dest: g })
        break
      case 'count':
        this.tone(880, 0.08, { vol: 0.15, dest: g })
        break
      case 'combo':
        // rising two-note ping for multi-kill combos
        this.tone(660, 0.07, { type: 'square', vol: 0.16, dest: g })
        this.tone(990, 0.12, { type: 'square', vol: 0.16, when: 0.06, dest: g })
        break
      case 'tick':
        this.tone(1200, 0.04, { type: 'square', vol: 0.08, dest: g })
        break
    }
  }

  // ---------- music (tiny chiptune sequencer) ----------

  private static MENU_BASS = [110, 0, 0, 110, 0, 0, 98, 0, 0, 98, 0, 0, 131, 0, 123, 0]
  private static MENU_LEAD = [440, 0, 523, 0, 587, 0, 0, 523, 494, 0, 587, 0, 659, 0, 587, 0]
  private static GAME_BASS = [82, 0, 82, 82, 0, 82, 0, 98, 82, 0, 82, 82, 0, 73, 0, 98]
  private static GAME_LEAD = [659, 0, 659, 784, 0, 880, 784, 0, 659, 0, 587, 659, 0, 523, 0, 587]
  // battle: faster, driving minor-key arpeggio
  private static BATTLE_BASS = [82, 82, 98, 82, 110, 110, 98, 82, 82, 82, 98, 82, 110, 110, 123, 0]
  private static BATTLE_LEAD = [659, 0, 784, 880, 0, 784, 659, 0, 880, 0, 1047, 880, 784, 0, 659, 587]

  setTrack(t: 'none' | 'menu' | 'game' | 'battle') {
    if (this.track === t) return
    this.track = t
    if (!this.ctx) return
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer)
      this.musicTimer = null
    }
    if (t === 'none') return
    this.musicStep = 0
    this.musicNext = this.ctx.currentTime + 0.1
    this.musicTimer = window.setInterval(() => this.musicTick(), 30)
  }

  private musicTick() {
    if (!this.ctx || !this.musicGain) return
    const baseBpm = this.track === 'menu' ? 92 : this.track === 'battle' ? 172 : 148
    const bpm = baseBpm * (this.suddenDeath ? 1.3 : 1)
    const spb = 60 / bpm / 2 // seconds per 8th note
    const bassArr = this.track === 'menu' ? AudioEngine.MENU_BASS : this.track === 'battle' ? AudioEngine.BATTLE_BASS : AudioEngine.GAME_BASS
    const leadArr = this.track === 'menu' ? AudioEngine.MENU_LEAD : this.track === 'battle' ? AudioEngine.BATTLE_LEAD : AudioEngine.GAME_LEAD
    while (this.musicNext < this.ctx.currentTime + 0.12) {
      const s = this.musicStep % 16
      const when = this.musicNext - this.ctx.currentTime
      const bass = bassArr[s]
      const lead = leadArr[s]
      if (bass) this.tone(bass, spb * 0.9, { type: 'triangle', vol: this.track === 'battle' ? 0.32 : 0.3, when, dest: this.musicGain })
      if (lead && (this.track === 'menu' ? Math.random() < 0.85 : true))
        this.tone(lead, spb * 0.8, { type: 'square', vol: this.track === 'battle' ? 0.085 : 0.07, when, dest: this.musicGain })
      // hat
      if (s % 4 === 2) this.noise(0.04, { vol: this.track === 'battle' ? 0.09 : this.track === 'game' ? 0.07 : 0.04, freq: 8000, type: 'highpass', when, dest: this.musicGain })
      // kick
      if (s % 4 === 0 && this.track !== 'menu')
        this.tone(120, 0.09, { type: 'sine', vol: this.track === 'battle' ? 0.26 : 0.22, slideTo: 40, when, dest: this.musicGain })
      this.musicNext += spb
      this.musicStep++
    }
  }
}

export const audio = new AudioEngine()
