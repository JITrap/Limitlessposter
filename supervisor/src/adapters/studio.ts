// Studio renderer (spec §7.2 "studio", Task 16): GPU-free poster mockups, carousel
// slides and short motion clips from HTML templates via Playwright + ffmpeg.
//   node supervisor/dist/adapters/studio.js render-image --template carousel-slide --data '{"headline":"…"}' --out <png> [--size 1080x1350]
//   node supervisor/dist/adapters/studio.js render-clip  --template clip-zoom      --data '{…}' --out <mp4> [--size 1080x1920] [--seconds 4] [--fps 30]
// Produktion (Szenen in stations/produktion/vorlagen, Vertrag: window.DURATION + window.renderFrame(t)):
//   node supervisor/dist/adapters/studio.js render-reel  --scene t01-vorher-nachher --data <json|@datei> --out <mp4> [--fps 30] [--size 1080x1920]
//        [--duration N] [--audio <wav>] [--music <mp3|wav>] [--music-gain -14] [--subs <json|@datei>] [--stills 0,2,4] [--cover <jpg>] [--cover-time 0]
//        [--background <mp4|png>]  → Szene (transparent) über einen Hintergrund-Clip/ein Bild legen (z. B. aus Higgsfield)
//   node supervisor/dist/adapters/studio.js render-still --scene karussell-slide --data <json|@datei> --out <png> [--size 1080x1350] [--time 0]
//   node supervisor/dist/adapters/studio.js beat --bpm 120 --seconds 12 --out <wav>
//   node supervisor/dist/adapters/studio.js fetch --url <https://…> --out <Vault>/LimitlessOS/Assets/content/<id>/<datei>
//        → lädt eine erzeugte Bild-/Video-Datei (z. B. Higgsfield-Ergebnis) in den Vault; nur https, nur Medien, nur unter Assets/
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile, open as openFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

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

export interface RenderResult {
  out: string
  /** `<img>` elements that actually loaded (naturalWidth > 0). */
  imagesLoaded: number
  /** image requests that failed (e.g. a poster path that does not exist). */
  imagesFailed: number
}

/**
 * Open the substituted HTML as a real file:// document. `page.setContent()` runs on
 * about:blank, where Chromium refuses to load local resources – the poster would
 * silently fall back to the placeholder.
 */
async function openTemplate(page: import('playwright').Page, html: string, onFailed: () => void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'los-html-'))
  const file = join(dir, 'index.html')
  await writeFile(file, html, 'utf8')
  page.on('requestfailed', (req) => {
    if (req.resourceType() === 'image' || req.resourceType() === 'media') onFailed()
  })
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
    await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function countLoadedImages(page: import('playwright').Page): Promise<number> {
  return page.evaluate(() => Array.from(document.images).filter((img) => img.complete && img.naturalWidth > 0).length)
}

export async function renderImageDetailed(o: RenderImageOptions): Promise<RenderResult> {
  const env = o.env ?? process.env
  const html = await loadTemplate(o.template, o.data)
  const b = await getBrowser(env)
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 })
  let imagesFailed = 0
  try {
    await openTemplate(page, html, () => imagesFailed++)
    const imagesLoaded = await countLoadedImages(page)
    await mkdir(dirname(o.out), { recursive: true })
    await page.screenshot({ path: o.out, type: 'png', fullPage: false })
    return { out: o.out, imagesLoaded, imagesFailed }
  } finally {
    await page.close()
  }
}

export async function renderImage(o: RenderImageOptions): Promise<string> {
  return (await renderImageDetailed(o)).out
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
    await openTemplate(page, html, () => {})
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

// --- Produktion: Szenen mit renderFrame(t) ------------------------------------

export const SCENES_DIR = join(repoRoot, 'stations', 'produktion', 'vorlagen')

/** Bare names resolve to `stations/produktion/vorlagen/<name>.html`; paths are used as given. */
export function resolveScene(scene: string): string {
  if (scene.endsWith('.html') || isAbsolute(scene) || scene.includes('/') || scene.includes('\\')) return scene
  return join(SCENES_DIR, `${scene}.html`)
}

/** Existing local file paths (also nested in arrays/objects) become file:// URLs. */
export function fileUrls(v: unknown): unknown {
  if (typeof v === 'string') {
    if (v.length < 1024 && !/^[a-z]+:\/\//i.test(v) && existsSync(v)) return pathToFileURL(v).href
    return v
  }
  if (Array.isArray(v)) return v.map(fileUrls)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fileUrls(x)]))
  return v
}

export interface Sub {
  start: number
  end: number
  text: string
}

/** Scenes are laid out at 1080 px width; smaller/larger viewports get the whole page scaled, not cropped. */
export const SCENE_WIDTH = 1080

/** Scene HTML with `<base>` (so base.css/lib.js/fonts resolve) and window.DATA / window.SUBS injected. */
export async function loadScene(scene: string, data: Record<string, unknown>, subs: Sub[] = [], viewportWidth = SCENE_WIDTH): Promise<string> {
  const path = resolve(resolveScene(scene))
  let html: string
  try {
    html = await readFile(path, 'utf8')
  } catch {
    throw new Error(`Szene nicht gefunden: ${path}`)
  }
  const base = pathToFileURL(dirname(path) + sep).href
  const json = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c')
  const scale = viewportWidth / SCENE_WIDTH
  const fit = Math.abs(scale - 1) > 0.001 ? `<style>html{transform-origin:0 0;transform:scale(${scale.toFixed(5)})}</style>` : ''
  const inject = `<base href="${base}">${fit}<script>window.DATA=${json(fileUrls(data))};window.SUBS=${json(subs)};</script>`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html
}

async function setSceneTime(page: Page, t: number): Promise<void> {
  await page.evaluate((sec) => {
    const w = window as unknown as { renderFrame?: (s: number) => void; __setTime?: (s: number) => void }
    if (typeof w.renderFrame === 'function') w.renderFrame(sec)
    else if (typeof w.__setTime === 'function') w.__setTime(sec)
  }, t)
}

async function sceneDuration(page: Page, fallback: number): Promise<number> {
  const d = await page.evaluate(() => {
    const w = window as unknown as { DURATION?: unknown }
    return typeof w.DURATION === 'number' && w.DURATION > 0 ? w.DURATION : null
  })
  return d ?? fallback
}

async function waitForImages(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).map((img) =>
        img.complete ? null : new Promise<void>((r) => {
          img.addEventListener('load', () => r(), { once: true })
          img.addEventListener('error', () => r(), { once: true })
        }),
      ),
    ),
  )
}

async function openScene(page: Page, html: string, onFailed: () => void): Promise<void> {
  await openTemplate(page, html, onFailed)
  await setSceneTime(page, 0)
  await waitForImages(page)
}

export interface RenderStillOptions {
  scene: string
  data: Record<string, unknown>
  out: string
  width: number
  height: number
  time?: number
  subs?: Sub[]
  env?: NodeJS.ProcessEnv
}

export async function renderStill(o: RenderStillOptions): Promise<RenderResult> {
  const env = o.env ?? process.env
  const html = await loadScene(o.scene, o.data, o.subs ?? [], o.width)
  const b = await getBrowser(env)
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 })
  let imagesFailed = 0
  try {
    await openScene(page, html, () => imagesFailed++)
    await setSceneTime(page, o.time ?? 0)
    const imagesLoaded = await countLoadedImages(page)
    await mkdir(dirname(o.out), { recursive: true })
    const type = /\.jpe?g$/i.test(o.out) ? 'jpeg' : 'png'
    await page.screenshot({ path: o.out, type, ...(type === 'jpeg' ? { quality: 92 } : {}), fullPage: false })
    return { out: o.out, imagesLoaded, imagesFailed }
  } finally {
    await page.close()
  }
}

export interface RenderReelOptions {
  scene: string
  data: Record<string, unknown>
  out: string
  width: number
  height: number
  fps: number
  /** overrides window.DURATION */
  duration?: number
  /** voice track (WAV/MP3), padded to the video length */
  audio?: string
  /** music bed, looped, mixed at musicGain dB (default -14) and faded out */
  music?: string
  musicGain?: number
  subs?: Sub[]
  /** seconds at which to save PNG stills next to the video */
  stills?: number[]
  cover?: string
  coverTime?: number
  /** re-encode harder when the file exceeds this (default 15 MB) */
  maxBytes?: number
  /**
   * Hintergrund-Clip (mp4/mov/webm, wird geloopt) oder Bild (png/jpg): die Szene wird mit transparentem
   * Hintergrund gerendert und darüber gelegt – so werden Higgsfield-Clips zu Reels mit Hook, Untertiteln und Endcard.
   */
  background?: string
  env?: NodeJS.ProcessEnv
}

export interface ReelResult {
  out: string
  frames: number
  duration: number
  fps: number
  audio: boolean
  music: boolean
  stills: string[]
  cover: string | null
  bytes: number
  imagesFailed: number
}

function audioGraph(o: { audio?: string; music?: string; musicGain: number; duration: number; firstInput?: number }): { args: string[]; filter: string | null } {
  const args: string[] = []
  let idx = o.firstInput ?? 1
  let voice: string | null = null
  let music: string | null = null
  if (o.audio) {
    args.push('-i', o.audio)
    voice = `${idx++}:a`
  }
  if (o.music) {
    args.push('-stream_loop', '-1', '-i', o.music)
    music = `${idx++}:a`
  }
  if (!voice && !music) return { args, filter: null }
  const fadeStart = Math.max(0, o.duration - 0.8).toFixed(2)
  // Stimme −2 dB (Piper liefert Vollaussteuerung), Musik leiser und ausgeblendet, Summe durch den Limiter
  const parts: string[] = []
  if (voice) parts.push(`[${voice}]aresample=48000,volume=-2dB,apad[v]`)
  if (music) parts.push(`[${music}]aresample=48000,volume=${o.musicGain}dB,afade=t=out:st=${fadeStart}:d=0.8[m]`)
  const limiter = 'alimiter=limit=0.95:level=false'
  if (voice && music) parts.push(`[v][m]amix=inputs=2:duration=first:normalize=0,${limiter}[a]`)
  else parts.push(`${voice ? '[v]' : '[m]'}${limiter}[a]`)
  return { args, filter: parts.join(';') }
}

/** Frame-by-frame render of a production scene, muxed with voice and music. */
export async function renderReel(o: RenderReelOptions): Promise<ReelResult> {
  const env = o.env ?? process.env
  if (o.width % 2 || o.height % 2) throw new Error('Breite und Höhe müssen gerade Zahlen sein (H.264)')
  for (const f of [o.audio, o.music, o.background].filter((x): x is string => !!x)) {
    if (!existsSync(f)) throw new Error(`Datei nicht gefunden: ${f}`)
  }
  const bgIsImage = !!o.background && /\.(png|jpe?g|webp)$/i.test(o.background)
  const html = await loadScene(o.scene, o.data, o.subs ?? [], o.width)
  const b = await getBrowser(env)
  const page = await b.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 })
  const dir = await mkdtemp(join(tmpdir(), 'los-reel-'))
  let imagesFailed = 0
  try {
    await openScene(page, html, () => imagesFailed++)
    const duration = o.duration ?? (await sceneDuration(page, 10))
    const frames = Math.max(1, Math.round(duration * o.fps))
    const cdp = await page.context().newCDPSession(page)
    // Mit Hintergrund: Bilder mit Alpha-Kanal, die Szene malt dann nur Hook, Karten, Untertitel und Endcard.
    if (o.background) await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
    for (let i = 0; i < frames; i++) {
      await setSceneTime(page, i / o.fps)
      const shot = (await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })) as { data: string }
      await writeFile(join(dir, `frame-${String(i).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'))
    }
    await cdp.detach().catch(() => {})
    await mkdir(dirname(o.out), { recursive: true })
    const graph = audioGraph({ audio: o.audio, music: o.music, musicGain: o.musicGain ?? -14, duration, firstInput: o.background ? 2 : 1 })
    const args = ['-y', '-framerate', String(o.fps), '-i', join(dir, 'frame-%05d.png')]
    const filters: string[] = []
    let video = '0:v'
    if (o.background) {
      if (bgIsImage) args.push('-loop', '1', '-framerate', String(o.fps), '-i', o.background)
      else args.push('-stream_loop', '-1', '-i', o.background)
      filters.push(
        `[1:v]scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height},setsar=1,fps=${o.fps},format=rgba[bg]`,
        '[0:v]format=rgba[fg]',
        '[bg][fg]overlay=0:0:shortest=1:format=auto[v]',
      )
      video = '[v]'
    }
    args.push(...graph.args)
    if (graph.filter) filters.push(graph.filter)
    if (filters.length) args.push('-filter_complex', filters.join(';'))
    args.push('-map', video)
    if (graph.filter) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(o.fps), '-t', duration.toFixed(3), '-movflags', '+faststart', o.out)
    await runFfmpeg(args, env)
    let bytes = (await stat(o.out)).size
    const maxBytes = o.maxBytes ?? 15 * 1024 * 1024
    if (bytes > maxBytes) {
      const tmp = join(dir, 'small.mp4')
      await runFfmpeg(['-y', '-i', o.out, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', tmp], env)
      await rename(tmp, o.out)
      bytes = (await stat(o.out)).size
    }
    const stills: string[] = []
    const stem = join(dirname(o.out), basename(o.out, extname(o.out)))
    // Standbilder und Cover: ohne Hintergrund aus der Szene, mit Hintergrund aus dem fertigen Video (sonst fehlt der Clip darunter).
    const grab = async (t: number, path: string): Promise<void> => {
      await mkdir(dirname(path), { recursive: true })
      if (o.background) {
        await runFfmpeg(['-y', '-ss', Math.min(t, Math.max(0, duration - 1 / o.fps)).toFixed(3), '-i', o.out, '-frames:v', '1', '-update', '1', ...(/\.png$/i.test(path) ? [] : ['-q:v', '2']), path], env)
      } else {
        await setSceneTime(page, Math.min(t, duration))
        const type = /\.png$/i.test(path) ? 'png' : 'jpeg'
        await page.screenshot({ path, type, ...(type === 'jpeg' ? { quality: 92 } : {}) })
      }
    }
    for (const t of o.stills ?? []) {
      const p = `${stem}-still-${String(t).replace('.', '_')}.png`
      await grab(t, p)
      stills.push(p)
    }
    let cover: string | null = null
    if (o.cover) {
      await grab(o.coverTime ?? 0, o.cover)
      cover = o.cover
    }
    return { out: o.out, frames, duration, fps: o.fps, audio: !!o.audio, music: !!o.music, stills, cover, bytes, imagesFailed }
  } finally {
    await page.close()
    await rm(dir, { recursive: true, force: true })
  }
}

// --- Fetch: erzeugte Medien (Higgsfield & Co.) in den Vault holen ---------------------

export interface FetchFileOptions {
  url: string
  out: string
  fetchFn?: typeof fetch
  /** default 200 MB */
  maxBytes?: number
}

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|mp4|mov|webm|m4v|mp3|wav|m4a)$/i

/**
 * Lädt eine Datei per https in den Vault – nur Medien, nur unter einem `Assets/`-Ordner, nie über die Größe hinaus.
 * Höhere Rechte hat der Arbeiter damit nicht: schreiben darf er dort ohnehin, nur Herunterladen konnte er nicht.
 */
export async function fetchFile(o: FetchFileOptions): Promise<{ out: string; bytes: number; contentType: string }> {
  let u: URL
  try {
    u = new URL(o.url)
  } catch {
    throw new Error('--url ist keine gültige Adresse')
  }
  if (u.protocol !== 'https:') throw new Error('nur https-Adressen')
  if (!isAbsolute(o.out)) throw new Error('--out muss ein absoluter Pfad sein')
  const parts = resolve(o.out).split(sep)
  if (parts.includes('..') || !parts.slice(0, -1).includes('Assets')) throw new Error('--out muss unter einem Assets/-Ordner des Vaults liegen')
  if (!MEDIA_EXT.test(o.out)) throw new Error('--out braucht eine Medien-Endung (png, jpg, webp, mp4, mov, webm, mp3, wav)')
  const fetchFn = o.fetchFn ?? (fetch as typeof fetch)
  const res = await fetchFn(u.toString(), { redirect: 'follow', headers: { 'User-Agent': 'LimitlessOS/1.0 (+https://limitlessposter.com)' } })
  if (!res.ok) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`)
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (contentType && !/^(image|video|audio)\//.test(contentType) && contentType !== 'application/octet-stream' && contentType !== 'binary/octet-stream') {
    throw new Error(`keine Mediendatei (Content-Type ${contentType})`)
  }
  const maxBytes = o.maxBytes ?? 200 * 1024 * 1024
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw new Error(`Datei zu groß (${declared} Bytes, erlaubt ${maxBytes})`)
  if (!res.body) throw new Error('leere Antwort')
  await mkdir(dirname(o.out), { recursive: true })
  const tmp = `${o.out}.teil`
  const fh = await openFile(tmp, 'w')
  let bytes = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error(`Datei zu groß (mehr als ${maxBytes} Bytes)`)
      await fh.write(value)
    }
  } catch (err) {
    await fh.close()
    await rm(tmp, { force: true })
    throw err
  }
  await fh.close()
  if (bytes === 0) {
    await rm(tmp, { force: true })
    throw new Error('leere Datei')
  }
  await rename(tmp, o.out)
  return { out: o.out, bytes, contentType }
}

// --- Beat: synthetischer Takt (Kick, Hi-Hat, Bass) als WAV ----------------------

export interface BeatOptions {
  bpm: number
  seconds: number
  sampleRate?: number
  /** peak level in dBFS (default -6) */
  level?: number
}

export function synthBeat(o: BeatOptions): Buffer {
  const sr = o.sampleRate ?? 44100
  const n = Math.max(1, Math.round(o.seconds * sr))
  const buf = new Float64Array(n)
  const beat = 60 / o.bpm
  let seed = 1234567
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  const add = (start: number, len: number, fn: (t: number, i: number) => number): void => {
    const s = Math.round(start * sr)
    const e = Math.min(n, s + Math.round(len * sr))
    for (let i = s; i < e; i++) buf[i] += fn((i - s) / sr, i - s)
  }
  const beats = Math.ceil(o.seconds / beat)
  for (let bi = 0; bi < beats; bi++) {
    const tb = bi * beat
    // Kick: Sinus-Sweep 140 → 45 Hz
    let phase = 0
    add(tb, 0.28, (t) => {
      const f = 45 + 95 * Math.exp(-t * 28)
      phase += (2 * Math.PI * f) / sr
      return Math.sin(phase) * Math.exp(-t * 14) * 0.9
    })
    // Hi-Hat auf den Achteln (Offbeat lauter)
    for (const off of [0, 0.5]) {
      let prev = 0
      add(tb + off * beat, 0.07, (t) => {
        const w = rnd()
        const hp = w - prev
        prev = w
        return hp * Math.exp(-t * (off ? 55 : 80)) * (off ? 0.32 : 0.18)
      })
    }
    // Bass auf Schlag 1 und 3 jedes Takts (A1 / E1)
    if (bi % 4 === 0 || bi % 4 === 2) {
      const f = bi % 4 === 0 ? 55 : 41.2
      add(tb + 0.02, 0.5, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 5) * 0.55 * (1 - Math.exp(-t * 200)))
    }
  }
  let peak = 0
  for (let i = 0; i < n; i++) {
    buf[i] = Math.tanh(buf[i] * 1.4)
    peak = Math.max(peak, Math.abs(buf[i]))
  }
  const target = Math.pow(10, (o.level ?? -6) / 20)
  const gain = peak > 0 ? target / peak : 1
  const pcm = Buffer.alloc(44 + n * 2)
  pcm.write('RIFF', 0)
  pcm.writeUInt32LE(36 + n * 2, 4)
  pcm.write('WAVE', 8)
  pcm.write('fmt ', 12)
  pcm.writeUInt32LE(16, 16)
  pcm.writeUInt16LE(1, 20)
  pcm.writeUInt16LE(1, 22)
  pcm.writeUInt32LE(sr, 24)
  pcm.writeUInt32LE(sr * 2, 28)
  pcm.writeUInt16LE(2, 32)
  pcm.writeUInt16LE(16, 34)
  pcm.write('data', 36)
  pcm.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), 44 + i * 2)
  return pcm
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

/** `--data '{…}'` or `--data @datei.json` */
async function jsonArg(argv: string[], name: string): Promise<unknown> {
  const raw = arg(argv, name)
  if (!raw) return undefined
  const text = raw.startsWith('@') ? await readFile(raw.slice(1), 'utf8') : raw
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${name} muss gültiges JSON sein (oder @pfad zu einer JSON-Datei)`)
  }
}

async function productionCommand(cmd: string, argv: string[], env: NodeJS.ProcessEnv, io: StudioIo): Promise<number> {
  const out = arg(argv, '--out')
  if (!out) throw new Error('--out fehlt')
  if (cmd === 'beat') {
    const bpm = Number(arg(argv, '--bpm') ?? 120)
    const seconds = Number(arg(argv, '--seconds') ?? 12)
    if (!(bpm > 40 && bpm < 300) || !(seconds > 0 && seconds <= 120)) throw new Error('--bpm 40–300 und --seconds 1–120')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, synthBeat({ bpm, seconds }))
    io.stdout(JSON.stringify({ ok: true, out, bpm, seconds }) + '\n')
    return 0
  }
  const scene = arg(argv, '--scene')
  if (!scene) throw new Error('--scene fehlt')
  const data = ((await jsonArg(argv, '--data')) ?? {}) as Record<string, unknown>
  const subs = ((await jsonArg(argv, '--subs')) ?? []) as Sub[]
  if (cmd === 'render-still') {
    const [width, height] = parseSize(arg(argv, '--size'), [1080, 1350])
    const r = await renderStill({ scene, data, out, width, height, time: Number(arg(argv, '--time') ?? 0), subs, env })
    io.stdout(JSON.stringify({ ok: true, out, imagesLoaded: r.imagesLoaded, imagesFailed: r.imagesFailed }) + '\n')
    if (r.imagesFailed > 0) io.stderr(`Hinweis: ${r.imagesFailed} Bild(er) konnten nicht geladen werden.\n`)
    return 0
  }
  const [width, height] = parseSize(arg(argv, '--size'), [1080, 1920])
  const stillsRaw = arg(argv, '--stills')
  const r = await renderReel({
    scene,
    data,
    out,
    width,
    height,
    fps: Number(arg(argv, '--fps') ?? 30),
    duration: arg(argv, '--duration') ? Number(arg(argv, '--duration')) : undefined,
    audio: arg(argv, '--audio'),
    music: arg(argv, '--music'),
    musicGain: arg(argv, '--music-gain') ? Number(arg(argv, '--music-gain')) : undefined,
    subs,
    stills: stillsRaw ? stillsRaw.split(',').map(Number).filter((n) => Number.isFinite(n)) : [],
    cover: arg(argv, '--cover'),
    coverTime: arg(argv, '--cover-time') ? Number(arg(argv, '--cover-time')) : undefined,
    background: arg(argv, '--background'),
    env,
  })
  io.stdout(JSON.stringify({ ok: true, ...r }) + '\n')
  if (r.imagesFailed > 0) io.stderr(`Hinweis: ${r.imagesFailed} Bild(er) konnten nicht geladen werden.\n`)
  return 0
}

export async function main(argv: string[], env: NodeJS.ProcessEnv, io: StudioIo): Promise<number> {
  const [cmd] = argv
  const usage = 'Verwendung: studio.js render-image --template <name|pfad> --data <json> --out <png> [--size BxH]\n' +
    '            studio.js render-clip  --template <name|pfad> --data <json> --out <mp4> [--size BxH] [--seconds N] [--fps N]\n' +
    '            studio.js render-reel  --scene <name|pfad> --data <json|@datei> --out <mp4> [--fps N] [--size BxH] [--duration N]\n' +
    '                                   [--audio <wav>] [--music <mp3>] [--music-gain -14] [--subs <json|@datei>] [--stills 0,2,4] [--cover <jpg>]\n' +
    '                                   [--background <mp4|png>]\n' +
    '            studio.js render-still --scene <name|pfad> --data <json|@datei> --out <png> [--size BxH] [--time N]\n' +
    '            studio.js beat --bpm 120 --seconds 12 --out <wav>\n' +
    '            studio.js fetch --url <https://…> --out <Vault>/…/Assets/content/<id>/<datei>\n'
  try {
    if (cmd === 'fetch') {
      const url = arg(argv, '--url')
      const out = arg(argv, '--out')
      if (!url || !out) {
        io.stderr(usage)
        return 1
      }
      const r = await fetchFile({ url, out })
      io.stdout(JSON.stringify({ ok: true, ...r }) + '\n')
      return 0
    }
    if (cmd === 'render-reel' || cmd === 'render-still' || cmd === 'beat') return await productionCommand(cmd, argv, env, io)
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
      const r = await renderImageDetailed({ template, data, width, height, out, env })
      io.stdout(JSON.stringify({ ok: true, out, imagesLoaded: r.imagesLoaded, imagesFailed: r.imagesFailed }) + '\n')
      if (r.imagesFailed > 0) io.stderr(`Hinweis: ${r.imagesFailed} Bild(er) konnten nicht geladen werden – Platzhalter verwendet.\n`)
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
