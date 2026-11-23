const KEY = 'bombergo.v1'

export interface Settings {
  musicVol: number
  sfxVol: number
  shake: boolean
  touch: 'auto' | 'on' | 'off'
  moveStyle: 'joystick' | 'dpad'
  color: string
  character: string
}

export interface HighScore {
  initials: string
  score: number
  mode: 'campaign' | 'battle'
  level: number
  date: number
}

interface SaveData {
  settings: Settings
  scores: HighScore[]
}

const DEFAULTS: SaveData = {
  settings: { musicVol: 70, sfxVol: 80, shake: true, touch: 'auto', moveStyle: 'joystick', color: '#00e5ff', character: 'bomber' },
  scores: [],
}

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULTS)
    const parsed = JSON.parse(raw)
    return {
      settings: { ...DEFAULTS.settings, ...parsed.settings },
      scores: Array.isArray(parsed.scores) ? parsed.scores : [],
    }
  } catch {
    return structuredClone(DEFAULTS)
  }
}

let data: SaveData = load()

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* private mode */ }
}

export const settings: Settings = data.settings

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch)
  persist()
}

export function getScores(): HighScore[] {
  return [...data.scores].sort((a, b) => b.score - a.score).slice(0, 10)
}

export function isHighScore(score: number): boolean {
  const list = getScores()
  return score > 0 && (list.length < 10 || score > list[list.length - 1].score)
}

export function addScore(entry: HighScore) {
  data.scores.push(entry)
  data.scores.sort((a, b) => b.score - a.score)
  data.scores = data.scores.slice(0, 10)
  persist()
}
