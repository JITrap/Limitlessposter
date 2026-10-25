// Metricool adapter – THE only way a worker may publish (hard duplicate guard, spec "nie wieder").
// REST API with the brand's own key (`.env` → METRICOOL_API_KEY, METRICOOL_USER_ID, METRICOOL_BLOG_ID).
//   node supervisor/dist/adapters/metricool.js ping
//   node supervisor/dist/adapters/metricool.js scheduled [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//   node supervisor/dist/adapters/metricool.js schedule --file <post.json> [--quelle <task-id>] [--dry-run]
//        post.json = { text, media[], providers[{network}], publicationDate{dateTime,timezone}, autoPublish, instagramData|tiktokData|…, firstCommentText, mediaAltText[] }
//        exit 0 geplant · 2 Dublette · 3 Tageslimit · 4 gesperrt (Freigabe/Autopilot/Tageslimit laut Aufseher) · 1 Fehler
//   node supervisor/dist/adapters/metricool.js draft --uuid <uuid>   → Beitrag auf Entwurf (pausiert), Liste aktualisiert
//   node supervisor/dist/adapters/metricool.js published --network instagram --days 60 [--sync]  → Historie (best effort), optional in die Liste
// Every successful `schedule` writes the post into Pläne/Veröffentlicht.md before it returns.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, parseDotenv, stripBom } from '../config.js'
import { parseNote } from '../vault/frontmatter.js'
import { countForDay, findDuplicate, loadPublog, mergeEntries, normalizeDate, savePublog, type PubInput } from '../publog.js'
import { localStamp } from './posts.js'
import { limitFor, loadLimits } from '../limits.js'

export const METRICOOL_API = 'https://app.metricool.com/api'
const USER_AGENT = 'LimitlessOS/1.0 (+https://limitlessposter.com)'

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

export interface MetricoolAuth {
  apiKey: string
  userId: string
  blogId: string
  timezone: string
}

export interface ScheduledPost {
  id?: number | string
  uuid?: string
  text?: string
  media?: string[]
  providers?: Array<{ network: string; status?: string; publicUrl?: string }>
  publicationDate?: { dateTime: string; timezone: string }
  draft?: boolean
  autoPublish?: boolean
  plannerUrl?: string
  instagramData?: Record<string, unknown>
  tiktokData?: Record<string, unknown>
  facebookData?: Record<string, unknown>
  linkedinData?: Record<string, unknown>
  gmbData?: Record<string, unknown>
  pinterestData?: Record<string, unknown>
  youtubeData?: Record<string, unknown>
  firstCommentText?: string
  mediaAltText?: Array<string | null>
  [k: string]: unknown
}

export function authFrom(env: NodeJS.ProcessEnv, kanaele?: { blogId?: string; timezone?: string }): MetricoolAuth | null {
  const apiKey = (env.METRICOOL_API_KEY ?? env.METRICOOL_TOKEN ?? '').trim()
  const userId = (env.METRICOOL_USER_ID ?? '').trim()
  const blogId = (env.METRICOOL_BLOG_ID ?? kanaele?.blogId ?? '').trim()
  if (!apiKey || !userId || !blogId) return null
  return { apiKey, userId, blogId, timezone: (env.METRICOOL_TIMEZONE ?? kanaele?.timezone ?? 'Europe/Berlin').trim() }
}

export async function readKanaele(vaultRoot: string): Promise<{ blogId?: string; timezone?: string }> {
  try {
    const { data } = parseNote(await readFile(join(vaultRoot, 'Marke', 'Kanäle.md'), 'utf8'))
    return { blogId: data.metricool_blog_id ? String(data.metricool_blog_id) : undefined, timezone: typeof data.metricool_timezone === 'string' ? data.metricool_timezone : undefined }
  } catch {
    return {}
  }
}

export class MetricoolError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function request<T>(auth: MetricoolAuth, method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, string>, body: unknown, fetchFn: FetchLike): Promise<T> {
  const q = new URLSearchParams({ ...query, blogId: auth.blogId, userId: auth.userId })
  const url = `${METRICOOL_API}/${path}?${q.toString()}`
  let last: MetricoolError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    try {
      const res = await fetchFn(url, {
        method,
        headers: { 'X-Mc-Auth': auth.apiKey, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      })
      const text = await res.text()
      if (!res.ok) {
        last = new MetricoolError(`Metricool ${res.status}: ${text.slice(0, 300)}`, res.status)
        if (res.status >= 500 || res.status === 429) continue
        throw last
      }
      return (text ? JSON.parse(text) : {}) as T
    } catch (err) {
      if (err instanceof MetricoolError) throw err
      last = new MetricoolError(`Metricool nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`, 0)
    } finally {
      clearTimeout(timer)
    }
  }
  throw last ?? new MetricoolError('Metricool: unbekannter Fehler', 0)
}

const unwrap = <T>(r: unknown): T => ((r as { data?: T })?.data ?? (r as T))

export async function listScheduled(auth: MetricoolAuth, from: string, to: string, fetchFn: FetchLike): Promise<ScheduledPost[]> {
  const r = await request<unknown>(auth, 'GET', 'v2/scheduler/posts', { start: `${from}T00:00:00`, end: `${to}T23:59:59`, timezone: auth.timezone }, undefined, fetchFn)
  const d = unwrap<ScheduledPost[]>(r)
  return Array.isArray(d) ? d : []
}

export async function createPost(auth: MetricoolAuth, post: ScheduledPost, fetchFn: FetchLike): Promise<ScheduledPost> {
  const r = await request<unknown>(auth, 'POST', 'v2/scheduler/posts', {}, post, fetchFn)
  return unwrap<ScheduledPost>(r)
}

export async function updatePost(auth: MetricoolAuth, id: string | number, post: ScheduledPost, fetchFn: FetchLike): Promise<ScheduledPost> {
  const r = await request<unknown>(auth, 'PUT', `v2/scheduler/posts/${id}`, {}, post, fetchFn)
  return unwrap<ScheduledPost>(r)
}

/** Published posts per network from the analytics API (best effort – endpoint names differ per network). */
export async function listPublished(auth: MetricoolAuth, network: string, from: string, to: string, fetchFn: FetchLike): Promise<PubInput[]> {
  const paths: Record<string, string[]> = {
    instagram: ['v2/analytics/posts/instagram', 'v2/analytics/reels/instagram'],
    tiktok: ['v2/analytics/posts/tiktok'],
    facebook: ['v2/analytics/posts/facebook', 'v2/analytics/reels/facebook'],
    linkedin: ['v2/analytics/posts/linkedin'],
    gmb: ['v2/analytics/posts/googlebusinessprofile'],
  }
  const out: PubInput[] = []
  for (const p of paths[network] ?? []) {
    const r = await request<unknown>(auth, 'GET', p, { from: `${from}T00:00:00`, to: `${to}T23:59:59`, timezone: auth.timezone }, undefined, fetchFn)
    const rows = unwrap<Array<Record<string, unknown>>>(r)
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const text = String(row.content ?? row.description ?? row.text ?? row.caption ?? '')
      const date = String(row.publishedAt ?? row.timestamp ?? row.created ?? row.date ?? '')
      const url = String(row.url ?? row.shareurl ?? row.permalink ?? '')
      if (!text && !url) continue
      out.push({ network, date: normalizeDate(date), type: p.includes('reels') ? 'reel' : network === 'tiktok' ? 'video' : 'post', status: 'veröffentlicht', text, url, quelle: 'metricool' })
    }
  }
  return out
}

// --- the guard around scheduling -------------------------------------------------------

export interface GuardEnv {
  LIMITLESS_PUBLISH_ALLOWED?: string
  LIMITLESS_ALLOW_WRITES?: string
  LIMITLESS_GATED?: string
}

/** The supervisor's verdict travels in the worker env; the adapter refuses to publish against it. */
export function gateReason(env: GuardEnv): string | null {
  if (env.LIMITLESS_GATED === '1') return 'gesperrt: Lauf nur als Entwurf (Freigabe nötig, Autopilot 0 oder Tageslimit)'
  if (env.LIMITLESS_PUBLISH_ALLOWED === '0') return 'gesperrt: Veröffentlichen heute nicht erlaubt (Tageslimit)'
  if (env.LIMITLESS_ALLOW_WRITES === '0') return 'gesperrt: Freigabe nötig'
  return null
}

export function postType(post: ScheduledPost, network: string): string {
  const t = (d: unknown): string => String((d as { type?: string } | undefined)?.type ?? '').toLowerCase()
  if (network === 'instagram') return t(post.instagramData) === 'reel' || t(post.instagramData) === 'trial_reel' ? 'reel' : t(post.instagramData) === 'story' ? 'story' : 'post'
  if (network === 'tiktok') return (post.media ?? []).some((m) => /\.(mp4|mov|webm)(\?|$)/i.test(m)) ? 'video' : 'photos'
  if (network === 'facebook') return t(post.facebookData) === 'story' ? 'story' : t(post.facebookData) || 'post'
  if (network === 'gmb') return t(post.gmbData) || 'publication'
  return 'post'
}

export interface ScheduleOutcome {
  code: 0 | 1 | 2 | 3 | 4
  result: Record<string, unknown>
}

export async function schedule(
  post: ScheduledPost,
  opts: { vaultRoot: string; limits: Record<string, number>; env: NodeJS.ProcessEnv; auth: MetricoolAuth | null; fetchFn: FetchLike; now: Date; quelle: string; dryRun: boolean },
): Promise<ScheduleOutcome> {
  const gate = gateReason(opts.env)
  if (gate) return { code: 4, result: { ok: false, grund: gate } }
  const providers = (post.providers ?? []).map((p) => String(p.network ?? '').toLowerCase()).filter(Boolean)
  const story = providers.every((n) => postType(post, n) === 'story')
  if (!providers.length || !post.publicationDate?.dateTime || (!post.text?.trim() && !(story && (post.media ?? []).length > 0))) {
    return { code: 1, result: { ok: false, fehler: 'post.json braucht text, providers und publicationDate (Story: media statt text)' } }
  }
  if (post.draft) return { code: 1, result: { ok: false, fehler: 'Entwürfe nicht über schedule anlegen – draft entfernen oder gar nicht planen' } }
  const log = await loadPublog(opts.vaultRoot)
  const day = String(post.publicationDate.dateTime).slice(0, 10)
  for (const network of providers) {
    const hit = findDuplicate({ network, text: post.text ?? '', media: post.media ?? [] }, log.entries, opts.now)
    if (hit) {
      return { code: 2, result: { ok: false, dublette: true, netzwerk: network, grund: hit.reason, aehnlichkeit: Number(hit.similarity.toFixed(2)), treffer: { datum: hit.entry.date, status: hit.entry.status, text: hit.entry.text, link: hit.entry.url, quelle: hit.entry.quelle } } }
    }
    const used = countForDay(log.entries, network, day)
    const limit = limitFor(opts.limits, network)
    if (used >= limit) return { code: 3, result: { ok: false, tageslimit: true, netzwerk: network, tag: day, genutzt: used, limit } }
  }
  if (opts.dryRun) return { code: 0, result: { ok: true, geprueft: providers, tag: day, dryRun: true } }
  if (!opts.auth) return { code: 1, result: { ok: false, fehler: 'Metricool-API nicht konfiguriert: METRICOOL_API_KEY, METRICOOL_USER_ID (und METRICOOL_BLOG_ID) in der .env' } }
  const created = await createPost(opts.auth, { ...post, autoPublish: post.autoPublish ?? true, draft: false }, opts.fetchFn)
  const plannerUrl = created.plannerUrl ?? (created.uuid ? `https://app.metricool.com/planner/calendar?blogId=${opts.auth.blogId}&openWithPostUuid=${created.uuid}` : '')
  const inputs: PubInput[] = providers.map((network) => ({
    network,
    date: normalizeDate(String(post.publicationDate!.dateTime)),
    type: postType(post, network),
    status: 'geplant',
    text: post.text ?? '',
    media: post.media ?? [],
    url: plannerUrl,
    quelle: opts.quelle,
  }))
  const merged = mergeEntries(log, inputs)
  await savePublog(opts.vaultRoot, merged.log)
  return { code: 0, result: { ok: true, id: created.id ?? null, uuid: created.uuid ?? null, plannerUrl, netzwerke: providers, tag: day, listeEintraege: merged.log.entries.length } }
}

// --- CLI ----------------------------------------------------------------------------------

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function dayOf(d: Date, offsetDays = 0): string {
  const x = new Date(d.getTime() + offsetDays * 86_400_000)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

export async function withDotenv(env: NodeJS.ProcessEnv, repoRoot: string): Promise<NodeJS.ProcessEnv> {
  try {
    const dotenv = parseDotenv(stripBom(await readFile(join(repoRoot, '.env'), 'utf8')))
    return { ...dotenv, ...env }
  } catch {
    return env
  }
}

export async function main(argv: string[], envIn: NodeJS.ProcessEnv = process.env, fetchFn: FetchLike = fetch as unknown as FetchLike, now = new Date(), repoRoot = process.cwd()): Promise<number> {
  const cmd = argv[0]
  const out = (o: unknown): void => console.log(JSON.stringify(o))
  if (!cmd || cmd === '--help') {
    console.log('Verwendung: metricool.js ping | scheduled | schedule --file <post.json> | draft --uuid <uuid> | published --network <n> [--days N] [--sync]')
    return 1
  }
  const env = await withDotenv(envIn, repoRoot)
  let vaultRoot = env.LIMITLESS_VAULT_ROOT?.trim() ?? ''
  let configLimits: Record<string, number> | undefined
  try {
    const cfg = await loadConfig(repoRoot, env)
    vaultRoot ||= cfg.vaultRoot
    configLimits = cfg.dailyPostLimits
  } catch {
    // tests run outside the repo
  }
  const limits = await loadLimits(configLimits, vaultRoot)
  const kanaele = vaultRoot ? await readKanaele(vaultRoot) : {}
  const auth = authFrom(env, kanaele)

  try {
    if (cmd === 'ping') {
      if (!auth) {
        out({ ok: false, fehler: 'METRICOOL_API_KEY / METRICOOL_USER_ID fehlen in der .env (Blog-ID aus Marke/Kanäle.md oder METRICOOL_BLOG_ID)' })
        return 2
      }
      const posts = await listScheduled(auth, dayOf(now), dayOf(now, 7), fetchFn)
      out({ ok: true, blogId: auth.blogId, geplant_7t: posts.length })
      return 0
    }
    if (cmd === 'scheduled') {
      if (!auth) {
        out({ ok: false, fehler: 'Metricool-API nicht konfiguriert' })
        return 2
      }
      const posts = await listScheduled(auth, arg(argv, '--from') ?? dayOf(now), arg(argv, '--to') ?? dayOf(now, 14), fetchFn)
      out({ ok: true, posts: posts.map((p) => ({ id: p.id, uuid: p.uuid, datum: p.publicationDate?.dateTime, netzwerke: (p.providers ?? []).map((x) => `${x.network}:${x.status ?? ''}`), entwurf: !!p.draft, text: String(p.text ?? '').slice(0, 80) })) })
      return 0
    }
    if (cmd === 'schedule') {
      const file = arg(argv, '--file')
      if (!file) {
        out({ ok: false, fehler: 'schedule braucht --file <post.json>' })
        return 1
      }
      if (!vaultRoot) {
        out({ ok: false, fehler: 'Vault-Ordner unbekannt (LIMITLESS_VAULT_ROOT oder limitless.config.json)' })
        return 1
      }
      const post = JSON.parse(stripBom(await readFile(file, 'utf8'))) as ScheduledPost
      const quelle = arg(argv, '--quelle') ?? (env.LIMITLESS_TASK_ID ? `content:${env.LIMITLESS_TASK_ID}` : 'manuell')
      const r = await schedule(post, { vaultRoot, limits, env, auth, fetchFn, now, quelle, dryRun: argv.includes('--dry-run') })
      out(r.result)
      return r.code
    }
    if (cmd === 'draft') {
      const uuid = arg(argv, '--uuid')
      if (!auth || !uuid) {
        out({ ok: false, fehler: !auth ? 'Metricool-API nicht konfiguriert' : 'draft braucht --uuid' })
        return 1
      }
      const posts = await listScheduled(auth, dayOf(now, -1), dayOf(now, 60), fetchFn)
      const p = posts.find((x) => String(x.uuid) === uuid)
      if (!p || p.id === undefined) {
        out({ ok: false, fehler: `Beitrag ${uuid} nicht unter den geplanten Beiträgen` })
        return 1
      }
      const updated = await updatePost(auth, p.id, { ...p, draft: true }, fetchFn)
      if (vaultRoot) {
        const log = await loadPublog(vaultRoot)
        for (const e of log.entries) if (e.url.includes(uuid) && e.status === 'geplant') e.status = 'entwurf'
        await savePublog(vaultRoot, log)
      }
      out({ ok: true, id: updated.id ?? null, uuid, entwurf: true })
      return 0
    }
    if (cmd === 'published') {
      const network = (arg(argv, '--network') ?? 'instagram').toLowerCase()
      const days = Number(arg(argv, '--days') ?? 60)
      if (!auth) {
        out({ ok: false, fehler: 'Metricool-API nicht konfiguriert' })
        return 2
      }
      const rows = await listPublished(auth, network, dayOf(now, -days), dayOf(now), fetchFn)
      if (argv.includes('--sync') && vaultRoot) {
        const log = await loadPublog(vaultRoot)
        const merged = mergeEntries(log, rows)
        merged.log.synced = localStamp(now)
        await savePublog(vaultRoot, merged.log)
        out({ ok: true, netzwerk: network, gefunden: rows.length, hinzugefuegt: merged.added, aktualisiert: merged.updated, synced: merged.log.synced })
        return 0
      }
      out({ ok: true, netzwerk: network, gefunden: rows.length, posts: rows.map((r) => ({ datum: r.date, typ: r.type, text: r.text.slice(0, 80), link: r.url })) })
      return 0
    }
    out({ ok: false, fehler: `Unbekannter Befehl: ${cmd}` })
    return 1
  } catch (err) {
    out({ ok: false, fehler: err instanceof Error ? err.message : String(err) })
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
