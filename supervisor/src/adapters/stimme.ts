// Stimme – lokale Sprachausgabe (tools/stimme/server.py: Chatterbox oder Piper, kein Cloud-Dienst, kein Schlüssel).
//   node supervisor/dist/adapters/stimme.js status
//   node supervisor/dist/adapters/stimme.js voices
//   node supervisor/dist/adapters/stimme.js speak --text "<Text>" | --text-file <pfad> --out <wav> [--voice thorsten] [--speed 1.0] [--emotion 0.5]
//        schreibt <out> (WAV, mono) und <out>.json (Sätze mit Start/Ende für Untertitel) und aktualisiert supervisor/data/stimme.json
//   node supervisor/dist/adapters/stimme.js stop
// Der Server wird bei Bedarf gestartet (Python aus tools/stimme/.venv, sonst STIMME_PYTHON / python3 / python / py -3).
// Umgebung: STIMME_PORT (4243), STIMME_PYTHON, STIMME_ENGINE (auto|chatterbox|piper), STIMME_NO_AUTOSTART=1
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../config.js'

const here = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(here, '..', '..', '..')

export interface StimmeStatus {
  ok: boolean
  engine: string | null
  cuda: boolean
  model_loaded: boolean
  loading?: boolean
  voices: Array<{ id: string; art: string; engine: string }>
  fehler: string[]
  python?: string
}

export interface SpeakResult {
  ok: boolean
  engine: string
  wav_base64: string
  sample_rate: number
  duration: number
  segments: Array<{ text: string; start: number; end: number }>
  text: string
}

export interface StimmeFile {
  installed: boolean
  engine: string | null
  cuda: boolean
  voices: string[]
  lastSample: string | null
  lastError: string | null
  updated: string
  python?: string
}

export interface PythonCandidate {
  cmd: string
  args: string[]
}

/** Python für die Stimme: STIMME_PYTHON, sonst die venv aus install.ps1, sonst was im PATH ist. */
export function resolvePython(env: NodeJS.ProcessEnv, repoRoot = defaultRepoRoot): PythonCandidate | null {
  const explicit = env.STIMME_PYTHON?.trim()
  if (explicit) return { cmd: explicit, args: [] }
  const venvWin = join(repoRoot, 'tools', 'stimme', '.venv', 'Scripts', 'python.exe')
  const venvNix = join(repoRoot, 'tools', 'stimme', '.venv', 'bin', 'python')
  if (existsSync(venvWin)) return { cmd: venvWin, args: [] }
  if (existsSync(venvNix)) return { cmd: venvNix, args: [] }
  const candidates: PythonCandidate[] = [
    { cmd: 'python3', args: [] },
    { cmd: 'python', args: [] },
    { cmd: 'py', args: ['-3'] },
  ]
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.args, '-c', 'import sys;print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true, timeout: 8000 })
      if (r.status === 0 && r.stdout.trim() === '3') return c
    } catch {
      // nächster Kandidat
    }
  }
  return null
}

export function serverUrl(env: NodeJS.ProcessEnv): string {
  const port = Number(env.STIMME_PORT?.trim() || 4243)
  return `http://127.0.0.1:${port}`
}

function stamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

async function fetchJson<T>(url: string, init: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 5000),
  })
  const text = await res.text()
  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    throw new Error(`Stimme antwortet nicht mit JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const f = (data as unknown as { fehler?: string }).fehler
    throw new Error(`Stimme meldet Fehler (HTTP ${res.status}): ${f ?? text.slice(0, 200)}`)
  }
  return data
}

export async function getStatus(env: NodeJS.ProcessEnv): Promise<StimmeStatus | null> {
  try {
    return await fetchJson<StimmeStatus>(`${serverUrl(env)}/status`, { timeoutMs: 3000 })
  } catch {
    return null
  }
}

export interface ServerOptions {
  env: NodeJS.ProcessEnv
  repoRoot?: string
  vaultRoot?: string
  waitMs?: number
  log?: (s: string) => void
}

async function resolveVaultRoot(env: NodeJS.ProcessEnv, repoRoot: string): Promise<string> {
  const direct = env.LIMITLESS_VAULT_ROOT?.trim()
  if (direct) return direct
  try {
    return (await loadConfig(repoRoot, env)).vaultRoot
  } catch {
    return ''
  }
}

/** Startet tools/stimme/server.py im Hintergrund, falls er nicht läuft, und wartet bis /status antwortet. */
export async function ensureServer(o: ServerOptions): Promise<StimmeStatus> {
  const env = o.env
  const repoRoot = o.repoRoot ?? defaultRepoRoot
  const already = await getStatus(env)
  if (already) return already
  if (env.STIMME_NO_AUTOSTART === '1') throw new Error(`Stimme läuft nicht (${serverUrl(env)}) und darf nicht automatisch starten (STIMME_NO_AUTOSTART=1)`)
  const py = resolvePython(env, repoRoot)
  if (!py) throw new Error('Kein Python gefunden. Auf dem PC einmal tools\\stimme\\install.ps1 ausführen (installiert Python-Umgebung und Stimme).')
  const script = join(repoRoot, 'tools', 'stimme', 'server.py')
  if (!existsSync(script)) throw new Error(`Stimme-Server fehlt: ${script}`)
  const vaultRoot = o.vaultRoot ?? (await resolveVaultRoot(env, repoRoot))
  const voicesDir = vaultRoot ? join(vaultRoot, 'Assets', 'stimmen') : join(repoRoot, 'tools', 'stimme', 'stimmen')
  const dataDir = join(repoRoot, 'tools', 'stimme', 'data')
  const logDir = join(repoRoot, 'supervisor', 'data', 'logs')
  await mkdir(logDir, { recursive: true })
  const logFd = openSync(join(logDir, 'stimme.log'), 'a')
  const port = String(Number(env.STIMME_PORT?.trim() || 4243))
  const args = [...py.args, '-I', script, '--port', port, '--voices-dir', voicesDir, '--data-dir', dataDir, '--preload']
  if (env.STIMME_ENGINE?.trim()) args.push('--engine', env.STIMME_ENGINE.trim())
  o.log?.(`Starte Stimme: ${py.cmd} ${args.join(' ')}\n`)
  const child = spawn(py.cmd, args, { detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...env, PYTHONUTF8: '1' } })
  child.on('error', () => {})
  child.unref()
  const deadline = Date.now() + (o.waitMs ?? 90_000)
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = await getStatus(env)
    if (s) return s
    if (child.exitCode !== null) break
  }
  throw new Error(`Stimme startet nicht (Port ${port}). Log: supervisor/data/logs/stimme.log`)
}

export interface SpeakOptions {
  text: string
  out: string
  voice?: string
  speed?: number
  emotion?: number
  env: NodeJS.ProcessEnv
  repoRoot?: string
  vaultRoot?: string
  waitMs?: number
  log?: (s: string) => void
}

export interface SpeakOutcome {
  out: string
  timeline: string
  engine: string
  duration: number
  sampleRate: number
  segments: SpeakResult['segments']
}

export function statusFilePath(repoRoot = defaultRepoRoot): string {
  return join(repoRoot, 'supervisor', 'data', 'stimme.json')
}

export async function readStatusFile(repoRoot = defaultRepoRoot): Promise<StimmeFile | null> {
  try {
    return JSON.parse(await readFile(statusFilePath(repoRoot), 'utf8')) as StimmeFile
  } catch {
    return null
  }
}

export async function writeStatusFile(patch: Partial<StimmeFile>, repoRoot = defaultRepoRoot, now = new Date()): Promise<StimmeFile> {
  const prev = (await readStatusFile(repoRoot)) ?? { installed: false, engine: null, cuda: false, voices: [], lastSample: null, lastError: null, updated: '' }
  const next: StimmeFile = { ...prev, ...patch, updated: stamp(now) }
  await mkdir(dirname(statusFilePath(repoRoot)), { recursive: true })
  await writeFile(statusFilePath(repoRoot), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

function vaultRelative(path: string, vaultRoot: string): string {
  if (!vaultRoot) return path
  const rel = relative(vaultRoot, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return path
  return rel.split('\\').join('/')
}

/** Text → WAV + Zeitleiste. Aktualisiert supervisor/data/stimme.json (auch bei Fehlern: lastError). */
export async function speak(o: SpeakOptions): Promise<SpeakOutcome> {
  const repoRoot = o.repoRoot ?? defaultRepoRoot
  const text = o.text.trim()
  if (!text) throw new Error('Kein Text zum Sprechen')
  const vaultRoot = o.vaultRoot ?? (await resolveVaultRoot(o.env, repoRoot))
  try {
    const status = await ensureServer({ env: o.env, repoRoot, vaultRoot, waitMs: o.waitMs, log: o.log })
    const body = JSON.stringify({ text, voice: o.voice ?? 'thorsten', language: 'de', speed: o.speed ?? 1.0, emotion: o.emotion ?? 0.5 })
    // Erstes Sprechen lädt das Modell (Minuten auf CPU) – großzügig warten.
    const res = await fetchJson<SpeakResult>(`${serverUrl(o.env)}/speak`, { method: 'POST', body, timeoutMs: 15 * 60_000 })
    await mkdir(dirname(o.out), { recursive: true })
    await writeFile(o.out, Buffer.from(res.wav_base64, 'base64'))
    const timeline = `${o.out}.json`
    await writeFile(
      timeline,
      JSON.stringify({ text: res.text, engine: res.engine, sample_rate: res.sample_rate, duration: res.duration, segments: res.segments }, null, 2) + '\n',
      'utf8',
    )
    await writeStatusFile(
      {
        installed: true,
        engine: res.engine,
        cuda: status.cuda,
        voices: status.voices.map((v) => v.id),
        lastSample: vaultRelative(o.out, vaultRoot),
        lastError: null,
        python: status.python,
      },
      repoRoot,
    )
    return { out: o.out, timeline, engine: res.engine, duration: res.duration, sampleRate: res.sample_rate, segments: res.segments }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await writeStatusFile({ lastError: msg }, repoRoot).catch(() => {})
    throw err
  }
}

/** Untertitel-Liste für die Szenen (window.SUBS): Sätze in Blöcke ≤ maxChars. */
export function toSubs(segments: SpeakResult['segments'], maxChars = 42): Array<{ start: number; end: number; text: string }> {
  const out: Array<{ start: number; end: number; text: string }> = []
  for (const seg of segments) {
    const words = seg.text.split(/\s+/).filter(Boolean)
    if (!words.length) continue
    const chunks: string[][] = [[]]
    for (const w of words) {
      const cur = chunks[chunks.length - 1]
      if (cur.join(' ').length + w.length + 1 > maxChars && cur.length) chunks.push([w])
      else cur.push(w)
    }
    const total = words.length
    let t = seg.start
    for (const c of chunks) {
      const dur = ((seg.end - seg.start) * c.length) / total
      out.push({ start: Number(t.toFixed(3)), end: Number((t + dur).toFixed(3)), text: c.join(' ') })
      t += dur
    }
  }
  return out
}

// --- CLI ---------------------------------------------------------------------

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, repoRoot = defaultRepoRoot): Promise<number> {
  const cmd = argv[0]
  const out = (o: unknown): void => console.log(JSON.stringify(o))
  const usage = 'Verwendung: stimme.js status | voices | speak --text "…" | --text-file <pfad> --out <wav> [--voice thorsten] [--speed 1.0] [--emotion 0.5] | stop'
  try {
    if (cmd === 'status') {
      const live = await getStatus(env)
      const file = await readStatusFile(repoRoot)
      const py = resolvePython(env, repoRoot)
      out({ ok: true, laeuft: !!live, server: live, installiert: file, python: py ? `${py.cmd} ${py.args.join(' ')}`.trim() : null })
      return 0
    }
    if (cmd === 'voices') {
      const s = await ensureServer({ env, repoRoot, log: (m) => process.stderr.write(m) })
      out({ ok: true, engine: s.engine, stimmen: s.voices })
      return 0
    }
    if (cmd === 'stop') {
      try {
        await fetchJson(`${serverUrl(env)}/shutdown`, { method: 'POST', body: '{}', timeoutMs: 3000 })
        out({ ok: true, gestoppt: true })
      } catch {
        out({ ok: true, gestoppt: false, hinweis: 'lief nicht' })
      }
      return 0
    }
    if (cmd === 'speak') {
      const file = arg(argv, '--text-file')
      const text = file ? await readFile(file, 'utf8') : (arg(argv, '--text') ?? '')
      const outPath = arg(argv, '--out')
      if (!text.trim() || !outPath) {
        console.error(usage)
        return 1
      }
      const r = await speak({
        text,
        out: outPath,
        voice: arg(argv, '--voice'),
        speed: arg(argv, '--speed') ? Number(arg(argv, '--speed')) : undefined,
        emotion: arg(argv, '--emotion') ? Number(arg(argv, '--emotion')) : undefined,
        env,
        repoRoot,
        log: (m) => process.stderr.write(m),
      })
      out({ ok: true, out: r.out, zeitleiste: r.timeline, engine: r.engine, dauer: r.duration, saetze: r.segments.length })
      return 0
    }
    console.error(usage)
    return 1
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
