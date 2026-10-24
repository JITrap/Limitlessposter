// Qualitäts-Gate der Produktion – Hülle um stations/produktion/gate.py (Preis, Preiszeile, Größen,
// verbotene Rabatt-/Material-/Lieferzeit-Wörter, Marken, Personen, Hashtags, Längen, Produktlink).
//   node supervisor/dist/adapters/gate.js <plattform> <plan.json> [--platforms <json>]
//        Tagesplan im Format der alten Produktion (items[] mit id/type/caption/tags/products/link/media/slot)
//   node supervisor/dist/adapters/gate.js <plattform> --post <post.json> [--product <handle>=<Shop-Titel>]... [--date YYYY-MM-DD]
//        post.json im Metricool-Format (wie für metricool.js schedule) → wird in ein Gate-Item übersetzt
// Plattformen: instagram | tiktok | facebook | linkedin | gbp (gmb wird zu gbp)
// Ausgabe: Zeilen `PASS <id>` / `SKIP <id>: <Gründe>`; Exit 0 = alles bestanden, 1 = mindestens ein SKIP, 2 = Plan/Konfiguration unlesbar.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolvePython } from './stimme.js'

const here = dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = resolve(here, '..', '..', '..')

export const PLATFORMS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'gbp'] as const
export type GatePlatform = (typeof PLATFORMS)[number]

export function normalizePlatform(p: string): GatePlatform {
  const x = p.trim().toLowerCase()
  if (x === 'gmb' || x === 'google' || x === 'googlebusiness') return 'gbp'
  if ((PLATFORMS as readonly string[]).includes(x)) return x as GatePlatform
  throw new Error(`Unbekannte Plattform „${p}“ – erlaubt: ${PLATFORMS.join(', ')} (gmb = gbp)`)
}

interface MetricoolPost {
  text?: string
  media?: string[]
  firstCommentText?: string
  mediaAltText?: Array<string | null>
  publicationDate?: { dateTime?: string }
  instagramData?: { type?: string }
  tiktokData?: { title?: string }
  facebookData?: { type?: string }
  linkedinData?: { type?: string }
}

const PREFIX: Record<GatePlatform, string> = { instagram: 'ig', tiktok: 'tt', facebook: 'fb', linkedin: 'li', gbp: 'gbp' }
const VIDEO_RE = /\.(mp4|mov|webm|m4v)(\?|$)/i
const PRODUCT_URL_RE = /https?:\/\/(?:www\.)?limitlessposter\.com\/products\/[a-z0-9-]+/i

function itemType(platform: GatePlatform, post: MetricoolPost, isVideo: boolean): string {
  if (platform === 'instagram') return isVideo ? 'reel' : 'post'
  if (platform === 'tiktok') return isVideo ? 'video' : 'photos'
  if (platform === 'facebook') return isVideo ? 'reel' : 'post'
  if (platform === 'linkedin') return isVideo ? 'video' : (post.media?.length ?? 0) > 1 ? 'document' : 'image'
  return 'update'
}

/** Metricool-Post → Gate-Item + Plan-Dokument, wie es gate.py erwartet. */
export function planFromPost(platform: GatePlatform, post: MetricoolPost, opts: { products?: Array<[string, string]>; date?: string; time?: string } = {}): Record<string, unknown> {
  const media = post.media ?? []
  const video = media.find((m) => VIDEO_RE.test(m))
  const images = media.filter((m) => !VIDEO_RE.test(m))
  const isVideo = !!video
  const date = opts.date ?? (post.publicationDate?.dateTime ?? '').slice(0, 10) ?? ''
  const time = opts.time ?? (post.publicationDate?.dateTime ?? '').slice(11, 16) ?? ''
  const text = String(post.text ?? '')
  const link = (text.match(PRODUCT_URL_RE) ?? String(post.firstCommentText ?? '').match(PRODUCT_URL_RE) ?? [])[0]
  const item: Record<string, unknown> = {
    id: `${date || '0000-00-00'}-${PREFIX[platform]}1`,
    type: itemType(platform, post, isVideo),
    caption: text,
    tags: null,
    products: opts.products ?? [],
    slot: { time: time || '12:00' },
  }
  if (link) item.link = link
  if (post.firstCommentText) item.firstComment = post.firstCommentText
  if (post.mediaAltText?.length) item.alt = post.mediaAltText.map((a) => a ?? '')
  item.media = isVideo ? { main: video, poster: images[0] ?? video } : images.length === 1 ? { image: images[0] } : { slides: images }
  if (platform === 'tiktok') item.network = { title: post.tiktokData?.title ?? '' }
  return {
    date: date || '0000-00-00',
    platform,
    source: { collection: 'days', date: date || '0000-00-00' },
    generatedAt: new Date().toISOString(),
    items: [item],
    stories: [],
  }
}

export interface GateOutcome {
  code: number
  stdout: string
  stderr: string
  results: Array<{ id: string; passed: boolean; reasons: string[] }>
}

export function parseGateOutput(stdout: string): GateOutcome['results'] {
  const out: GateOutcome['results'] = []
  for (const line of stdout.split(/\r?\n/)) {
    const pass = /^PASS (.+)$/.exec(line)
    const skip = /^SKIP ([^:]+): ?(.*)$/.exec(line)
    if (pass) out.push({ id: pass[1].trim(), passed: true, reasons: [] })
    else if (skip) out.push({ id: skip[1].trim(), passed: false, reasons: skip[2].split('; ').map((s) => s.trim()).filter(Boolean) })
  }
  return out
}

export async function runGate(platform: GatePlatform, planPath: string, opts: { platformsPath?: string; env?: NodeJS.ProcessEnv; repoRoot?: string } = {}): Promise<GateOutcome> {
  const env = opts.env ?? process.env
  const repoRoot = opts.repoRoot ?? defaultRepoRoot
  const py = resolvePython(env, repoRoot)
  if (!py) throw new Error('Kein Python gefunden – auf dem PC tools\\stimme\\install.ps1 ausführen oder Python 3 installieren.')
  const script = join(repoRoot, 'stations', 'produktion', 'gate.py')
  const platforms = opts.platformsPath ?? join(repoRoot, 'stations', 'produktion', 'platforms.json')
  return new Promise((ok, fail) => {
    const child = spawn(py.cmd, [...py.args, '-I', script, platform, planPath, '--platforms', platforms], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', (e) => fail(new Error(`Gate konnte nicht gestartet werden (${py.cmd}): ${e.message}`)))
    child.on('close', (code) => ok({ code: code ?? 1, stdout, stderr, results: parseGateOutput(stdout) }))
  })
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function args(argv: string[], name: string): string[] {
  const out: string[] = []
  argv.forEach((a, i) => {
    if (a === name && argv[i + 1]) out.push(argv[i + 1])
  })
  return out
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, repoRoot = defaultRepoRoot): Promise<number> {
  const usage = 'Verwendung: gate.js <plattform> <plan.json> [--platforms <json>]\n' +
    '            gate.js <plattform> --post <post.json> [--product <handle>=<Shop-Titel>]... [--date YYYY-MM-DD]\n'
  if (!argv[0] || argv[0] === '--help') {
    process.stderr.write(usage)
    return 2
  }
  let tmp: string | null = null
  try {
    const platform = normalizePlatform(argv[0])
    let planPath = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    const postPath = arg(argv, '--post')
    if (!planPath && !postPath) {
      process.stderr.write(usage)
      return 2
    }
    if (postPath) {
      const post = JSON.parse(await readFile(postPath, 'utf8')) as MetricoolPost
      const products = args(argv, '--product').map((p): [string, string] => {
        const i = p.indexOf('=')
        return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), p.trim()]
      })
      const plan = planFromPost(platform, post, { products, date: arg(argv, '--date') })
      tmp = await mkdtemp(join(tmpdir(), 'los-gate-'))
      planPath = join(tmp, 'plan.json')
      await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8')
    }
    const r = await runGate(platform, planPath!, { platformsPath: arg(argv, '--platforms'), env, repoRoot })
    if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n')
    if (r.stderr) process.stderr.write(r.stderr)
    return r.code
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
