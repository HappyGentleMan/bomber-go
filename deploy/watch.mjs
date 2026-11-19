#!/usr/bin/env node
/**
 * BOMBER GO auto-deploy watcher.
 *
 * Watches the game sources and, ~1.5s after they stop changing, runs
 * deploy/build.mjs which typechecks, builds and atomically publishes the site.
 * A failed build leaves the previously published version live.
 *
 * Runs under launchd (com.anson.bomber-go-watch) so it survives reboots.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const deployDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.dirname(deployDir)
const targets = ['src', 'public', 'index.html', 'package.json', 'vite.config.ts', 'tsconfig.json']
const DEBOUNCE_MS = 1500

let timer = null
let building = false
let queued = false

function log(msg) {
  console.log(`[${new Date().toISOString()}] [watch] ${msg}`)
}

function schedule(reason) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    build(reason)
  }, DEBOUNCE_MS)
}

function build(reason) {
  if (building) {
    queued = true
    return
  }
  building = true
  log(`change (${reason}) → building`)
  const r = spawnSync(process.execPath, [path.join(deployDir, 'build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })
  log(`build ${r.status === 0 ? 'ok' : `failed (exit ${r.status})`}`)
  building = false
  if (queued) {
    queued = false
    schedule('queued change')
  }
}

for (const target of targets) {
  const p = path.join(root, target)
  try {
    fs.watch(p, { recursive: true }, (_event, filename) => {
      if (!filename) return
      if (filename.includes('node_modules')) return
      schedule(`${target}/${filename}`)
    })
  } catch (err) {
    log(`cannot watch ${target}: ${err.message}`)
  }
}

log(`watching ${targets.join(', ')}`)
build('startup')
