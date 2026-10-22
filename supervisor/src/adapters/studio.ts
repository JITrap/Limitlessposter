// Studio renderer (spec §7.2 "studio", Task 16): GPU-free poster mockups, carousel
// slides and short motion clips from HTML templates via Playwright + ffmpeg.
//   node supervisor/dist/adapters/studio.js render-image --template carousel-slide --data '{"headline":"…"}' --out <png> [--size 1080x1350]
//   node supervisor/dist/adapters/studio.js render-clip  --template clip-zoom      --data '{…}' --out <mp4> [--size 1080x1920] [--seconds 4] [--fps 30]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
// src/adapters → supervisor/src → supervisor → repo ; dist/adapters → supervisor/dist → supervisor → repo
const repoRoot = resolve(here, '..', '..', '..')

export interface RenderImageOptions {
  template: string
  data: Record<string, string>
  width: number
  height: number
  out: string
  env?: NodeJS.ProcessEnv
}

export interface RenderClipOptions extends RenderImageOptions {
  seconds: number
  fps: number
}

/** Bare names resolve to `stations/studio/templates/<name>.html`; paths are used as given. */
export function resolveTemplate(template: string): string {
  if (template.endsWith('.html') || isAbsolute(template) || template.includes('/') || template.includes('\\')) return template
  return join(repoRoot, 'stations', 'studio', 'templates', `${template}.html`)
}

/**
 * `{{key}}` → value, `{{key|default}}` → default when the key is missing or empty;
 * unknown keys without a default become empty strings. Existing local file paths
 * become file:// URLs so templates can reference poster files directly.
 */
export function substitute(html: string, data: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g, (_m, key: string, fallback: string | undefined) => {
    const v = data[key]
    if (v === undefined || v === null || v === '') return fallback ?? ''
    if (typeof v === 'string' && v.length < 1024 && !/^[a-z]+:\/\//i.test(v) && existsSync(v)) return pathToFileURL(v).href
    return String(v)
  })
}

let browser: Browser | null = null

async function getBrowser(env: NodeJS.ProcessEnv): Promise<Browser> {
  if (browser && browser.isConnected()) return browser
  const executablePath = env.PLAYWRIGHT_CHROMIUM?.trim() || undefined
  browser = await chromium.launch({ headless: true, executablePath })
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {})
    browser = null
  }
}

async function loadTemplate(template: string, data: Record<string, string>): Promise<string> {
  const path = resolveTemplate(template)
  let html: string
  try {
    html = await readFile(path, 'utf8')
  } catch {
    throw new Error(`Vorlage nicht gefunden: ${path}`)
  }
  return substitute(html, data)
}

export async function renderImage(o: RenderImageOptions): Promise<string> {
  const env = o.env ?? process.env
  const html = await loadTemplate(o.template, o.data)
  const b = await getBrowser(env)
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 })
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready)
    await mkdir(dirname(o.out), { recursive: true })
    await page.screenshot({ path: o.out, type: 'png', fullPage: false })
  } finally {
    await page.close()
  }
  return o.out
}

function runFfmpeg(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((ok, fail) => {
    const bin = env.FFMPEG_BIN?.trim() || 'ffmpeg'
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8')))
    child.on('error', (e) => fail(new Error(`ffmpeg konnte nicht gestartet werden (${bin}): ${e.message}`)))
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg beendet mit Code ${code}: ${err.slice(-400)}`))))
  })
}

/** Frame-by-frame capture: the template exposes `window.__setTime(seconds)`; ffmpeg encodes H.264. */
export async function renderClip(o: RenderClipOptions): Promise<string> {
  const env = o.env ?? process.env
  if (o.width % 2 || o.height % 2) throw new Error('Breite und Höhe müssen gerade Zahlen sein (H.264)')
  const html = await loadTemplate(o.template, o.data)
  const frames = Math.max(1, Math.round(o.seconds * o.fps))
  const b = await getBrowser(env)
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 })
  const dir = await mkdtemp(join(tmpdir(), 'los-frames-'))
  try {
    await page.setContent(html, { waitUntil: 'load' })
    for (let i = 0; i < frames; i++) {
      const t = i / o.fps
      await page.evaluate((sec) => {
        const w = window as unknown as { __setTime?: (s: number) => void }
        if (typeof w.__setTime === 'function') w.__setTime(sec)
      }, t)
      await page.screenshot({ path: join(dir, `frame-${String(i).padStart(4, '0')}.png`), type: 'png' })
    }
    await mkdir(dirname(o.out), { recursive: true })
    await runFfmpeg(
      ['-y', '-framerate', String(o.fps), '-i', join(dir, 'frame-%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.out],
      env,
    )
  } finally {
    await page.close()
    await rm(dir, { recursive: true, force: true })
  }
  return o.out
}

// --- CLI ---------------------------------------------------------------------

export interface StudioIo {
  stdout: (s: string) => void
  stderr: (s: string) => void
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function parseSize(s: string | undefined, fallback: [number, number]): [number, number] {
  if (!s) return fallback
  const m = /^(\d+)x(\d+)$/.exec(s)
  if (!m) throw new Error(`--size muss wie 1080x1350 aussehen (ist „${s}“)`)
  return [Number(m[1]), Number(m[2])]
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, io: StudioIo): Promise<number> {
  const [cmd] = argv
  const usage = 'Verwendung: studio.js render-image --template <name|pfad> --data <json> --out <png> [--size BxH]\n' +
    '            studio.js render-clip  --template <name|pfad> --data <json> --out <mp4> [--size BxH] [--seconds N] [--fps N]\n'
  try {
    if (cmd !== 'render-image' && cmd !== 'render-clip') {
      io.stderr(usage)
      return 1
    }
    const template = arg(argv, '--template')
    const out = arg(argv, '--out')
    if (!template || !out) {
      io.stderr(usage)
      return 1
    }
    let data: Record<string, string> = {}
    const rawData = arg(argv, '--data')
    if (rawData) {
      try {
        data = JSON.parse(rawData) as Record<string, string>
      } catch {
        io.stderr('--data muss gültiges JSON sein\n')
        return 1
      }
    }
    if (cmd === 'render-image') {
      const [width, height] = parseSize(arg(argv, '--size'), [1080, 1350])
      await renderImage({ template, data, width, height, out, env })
      io.stdout(JSON.stringify({ ok: true, out }) + '\n')
    } else {
      const [width, height] = parseSize(arg(argv, '--size'), [1080, 1920])
      const seconds = Number(arg(argv, '--seconds') ?? 4)
      const fps = Number(arg(argv, '--fps') ?? 30)
      await renderClip({ template, data, width, height, seconds, fps, out, env })
      io.stdout(JSON.stringify({ ok: true, out, frames: Math.max(1, Math.round(seconds * fps)) }) + '\n')
    }
    return 0
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  } finally {
    await closeBrowser()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env, { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }).then((code) =>
    process.exit(code),
  )
}
