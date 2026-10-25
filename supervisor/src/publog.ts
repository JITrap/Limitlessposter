// Veröffentlichungs-Liste ("publish log"): every post that ever went out or is scheduled, per
// network, in one vault note – `<Vault>/LimitlessOS/Pläne/Veröffentlicht.md`. It is the single
// source the duplicate guard reads: nothing is scheduled whose text or media already appears
// here for the same network, and the per-network day quotas count against it too.
// Seeded from Metricool's history, kept fresh by the kennzahlen station (MCP) and by the
// Metricool adapter after every scheduling call.
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { parseNote, stringifyNote } from './vault/frontmatter.js'
import { writeFileAtomic } from './vault/atomic.js'

export const PUBLOG_FILE = join('Pläne', 'Veröffentlicht.md')
/** Entries older than this are not compared (an identical post after a quarter is a re-run, not a slip). */
export const DUPLICATE_WINDOW_DAYS = 120
export const STALE_AFTER_HOURS = 12

export type PubStatus = 'geplant' | 'veröffentlicht' | 'entwurf' | 'storniert'

export interface PubEntry {
  /** YYYY-MM-DDTHH:mm (local time of the brand) */
  date: string
  network: string
  /** reel | post | video | photos | story | text | update */
  type: string
  status: PubStatus
  /** first 140 characters, single line – for humans */
  text: string
  /** hash of the normalized full text – for the guard */
  key: string
  /** media file basenames (query strings stripped) */
  media: string[]
  url: string
  quelle: string
}

export interface Publog {
  /** YYYY-MM-DDTHH:mm:ss of the last Metricool sync, null when never synced */
  synced: string | null
  entries: PubEntry[]
}

const HASHTAG = /#[\p{L}\p{N}_]+/gu
const URL = /https?:\/\/\S+|\b[\w.-]+\.(?:com|de|net|org|io)\b\S*/giu
const MENTION = /@[\w.]+/g
const NOT_WORD = /[^\p{L}\p{N}\s]/gu

/** Lower-case words only: no links, hashtags, mentions, emojis or punctuation. */
export function normalizeText(text: string): string {
  return (text ?? '')
    .replace(URL, ' ')
    .replace(HASHTAG, ' ')
    .replace(MENTION, ' ')
    .toLowerCase()
    .replace(NOT_WORD, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function textKey(text: string): string {
  return createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 12)
}

const words = (norm: string): Set<string> => new Set(norm.split(' ').filter((w) => w.length >= 3))

/** Jaccard similarity of the word sets of two normalized texts (0..1). */
export function similarity(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

export function mediaName(url: string): string {
  const clean = url.split('?')[0].split('#')[0]
  return clean.slice(clean.lastIndexOf('/') + 1).toLowerCase()
}

/** Generic names (Metricool re-hosts files under random names) never count as a media match. */
const GENERIC_MEDIA = /^(\d+-file-\d+\.\w+|image\.\w+|video\.\w+|file\.\w+)$/

export interface Candidate {
  network: string
  text: string
  media?: string[]
  /** reel | post | video | photos | story … – Stories vergleichen sich nur mit Stories (das Cover gehört auch zum Reel) */
  type?: string
}

export interface DuplicateHit {
  entry: PubEntry
  reason: 'text' | 'anfang' | 'aehnlich' | 'enthalten' | 'medien'
  similarity: number
}

/** Share of the smaller word set that also appears in the larger one (0..1). */
export function containment(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa]
  if (small.size === 0) return 0
  let inter = 0
  for (const w of small) if (large.has(w)) inter++
  return inter / small.size
}

/**
 * The guard. A candidate is a duplicate of an entry for the SAME network when the normalized
 * text is identical, one text begins with the other (≥ 25 characters), the first 60 normalized
 * characters are identical, the word sets overlap strongly (Jaccard ≥ 0.6), the smaller word set
 * is almost fully contained in the larger (≥ 0.8 with at least 5 words – the "same post, longer
 * caption" case that slipped through on 24.10.), or a non-generic media file name is the same. Cancelled entries never count;
 * the same video on Instagram and TikTok is a cross-post, not a duplicate.
 */
export function findDuplicate(candidate: Candidate, entries: PubEntry[], now: Date, windowDays = DUPLICATE_WINDOW_DAYS): DuplicateHit | null {
  const norm = normalizeText(candidate.text)
  const key = textKey(candidate.text)
  const head = norm.slice(0, 60)
  const media = new Set((candidate.media ?? []).map(mediaName).filter((m) => m && !GENERIC_MEDIA.test(m)))
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000)
  // Stories und andere Beiträge ohne Text: nur die Medien-Regel (sonst wäre jede Story die Dublette der vorigen).
  const textless = words(norm).size === 0
  // Die Medien-Regel gilt nur unter Gleichartigen: die Story zum Reel nutzt dessen Cover und ist keine Dublette des Reels.
  const storyCand = (candidate.type ?? '').toLowerCase() === 'story'
  let best: DuplicateHit | null = null
  for (const e of entries) {
    if (e.network !== candidate.network.toLowerCase() || e.status === 'storniert') continue
    const d = new Date(e.date.length === 16 ? `${e.date}:00` : e.date)
    if (!Number.isNaN(d.getTime()) && d < cutoff) continue
    const gleicheArt = (e.type === 'story') === storyCand
    if (textless) {
      if (gleicheArt) for (const m of e.media) if (media.has(m)) return { entry: e, reason: 'medien', similarity: 1 }
      continue
    }
    if (e.key && e.key === key) return { entry: e, reason: 'text', similarity: 1 }
    const eNorm = normalizeText(e.text)
    const shorter = Math.min(norm.length, eNorm.length)
    if (shorter >= 25 && (norm.startsWith(eNorm) || eNorm.startsWith(norm))) return { entry: e, reason: 'anfang', similarity: 1 }
    if (head.length >= 25 && eNorm.slice(0, 60) === head) return { entry: e, reason: 'anfang', similarity: 1 }
    const sim = similarity(norm, eNorm)
    if (sim >= 0.6 && (!best || sim > best.similarity)) best = { entry: e, reason: 'aehnlich', similarity: sim }
    const cont = containment(norm, eNorm)
    if (cont >= 0.8 && Math.min(words(norm).size, words(eNorm).size) >= 5 && (!best || cont > best.similarity)) best = { entry: e, reason: 'enthalten', similarity: cont }
    if (gleicheArt) for (const m of e.media) if (media.has(m)) return { entry: e, reason: 'medien', similarity: 1 }
  }
  return best
}

/** Posts that count against a day's quota for one network: scheduled or published that day. */
export function countForDay(entries: PubEntry[], network: string, day: string): number {
  return entries.filter((e) => e.network === network.toLowerCase() && e.date.startsWith(day) && (e.status === 'geplant' || e.status === 'veröffentlicht')).length
}

export function isStale(log: Publog | null, now: Date, hours = STALE_AFTER_HOURS): boolean {
  if (!log?.synced) return true
  const t = new Date(log.synced).getTime()
  return Number.isNaN(t) || now.getTime() - t > hours * 3_600_000
}

// --- note format -----------------------------------------------------------------------

const cell = (s: string): string => s.replace(/\|/g, '¦').replace(/\s+/g, ' ').trim()

export function oneLine(text: string, max = 140): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function renderPublog(log: Publog): string {
  const sorted = [...log.entries].sort((a, b) => b.date.localeCompare(a.date) || a.network.localeCompare(b.network))
  const lines = [
    '# Veröffentlicht – alles, was draußen ist oder eingeplant',
    '',
    '> [!info] Diese Liste ist der **Dubletten-Schutz**. Jeder Post, der je rausging oder in Metricool eingeplant ist, steht hier',
    '> (Text-Anfang, Schlüssel des ganzen Textes, Mediendateien). Vor jedem Einplanen prüft das System dagegen –',
    '> gleicher Text oder gleiche Datei im selben Netzwerk innerhalb von 120 Tagen wird abgelehnt. Die Zentrale gleicht',
    '> die Liste alle 6 Stunden mit Metricool ab; ist sie älter als 12 Stunden, wird nichts veröffentlicht.',
    '> Status: `veröffentlicht` · `geplant` · `entwurf` (pausiert) · `storniert`. Von Hand ändern ist erlaubt, Zeilen löschen nicht.',
    '',
    `Stand der Synchronisation: ${log.synced ?? 'noch nie'} · Einträge: ${sorted.length}`,
    '',
    '| Datum | Netzwerk | Typ | Status | Text | Medien | Link | Quelle | Key |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const e of sorted) {
    lines.push(`| ${e.date} | ${e.network} | ${e.type} | ${e.status} | ${cell(oneLine(e.text))} | ${cell(e.media.join(' '))} | ${cell(e.url)} | ${cell(e.quelle)} | ${e.key} |`)
  }
  return stringifyNote({ type: 'veroeffentlichungen', synced: log.synced ?? '', eintraege: sorted.length }, lines.join('\n') + '\n')
}

const STATUSES = new Set<PubStatus>(['geplant', 'veröffentlicht', 'entwurf', 'storniert'])

export function parsePublog(text: string): Publog {
  const { data, body } = parseNote(text)
  const entries: PubEntry[] = []
  for (const line of body.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Datum') || line.startsWith('|---')) continue
    const cols = line.slice(1, -1).split('|').map((c) => c.trim())
    if (cols.length < 9) continue
    const [date, network, type, statusRaw, txt, media, url, quelle, key] = cols
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue
    const status = (STATUSES.has(statusRaw as PubStatus) ? statusRaw : 'veröffentlicht') as PubStatus
    entries.push({ date, network: network.toLowerCase(), type, status, text: txt, key, media: media ? media.split(' ').filter(Boolean) : [], url, quelle })
  }
  const synced = typeof data.synced === 'string' && data.synced.trim() ? data.synced.trim() : data.synced instanceof Date ? data.synced.toISOString().slice(0, 19) : null
  return { synced, entries }
}

export async function loadPublog(vaultRoot: string): Promise<Publog> {
  try {
    return parsePublog(await readFile(join(vaultRoot, PUBLOG_FILE), 'utf8'))
  } catch {
    return { synced: null, entries: [] }
  }
}

export async function savePublog(vaultRoot: string, log: Publog): Promise<void> {
  const file = join(vaultRoot, PUBLOG_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFileAtomic(file, renderPublog(log))
}

export interface PublogCache {
  mtimeMs: number
  value: Publog
}

/** Re-read only when the note changed on disk (called every tick by the supervisor). */
export async function loadPublogCached(vaultRoot: string, cache: PublogCache | null): Promise<PublogCache> {
  const file = join(vaultRoot, PUBLOG_FILE)
  let mtimeMs: number
  try {
    mtimeMs = (await stat(file)).mtimeMs
  } catch {
    return { mtimeMs: 0, value: { synced: null, entries: [] } }
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache
  return { mtimeMs, value: await loadPublog(vaultRoot) }
}

/** Input shape for `add`/`sync`: everything the guard needs, the key is derived. */
export interface PubInput {
  date: string
  network: string
  type?: string
  status?: PubStatus
  text: string
  media?: string[]
  url?: string
  quelle?: string
}

export function toEntry(i: PubInput): PubEntry {
  return {
    date: normalizeDate(i.date),
    network: (i.network ?? '').toLowerCase().trim(),
    type: (i.type ?? 'post').toLowerCase(),
    status: i.status ?? 'veröffentlicht',
    text: oneLine(i.text ?? ''),
    key: textKey(i.text ?? ''),
    media: (i.media ?? []).map(mediaName).filter(Boolean),
    url: (i.url ?? '').trim(),
    quelle: (i.quelle ?? '').trim(),
  }
}

/** Accepts `20261024120000`, ISO with seconds/offset, or `YYYY-MM-DDTHH:mm`; returns `YYYY-MM-DDTHH:mm`. */
export function normalizeDate(raw: string): string {
  const s = String(raw ?? '').trim()
  const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(s)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}`
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s)
  if (iso) return `${iso[1]}T${iso[2]}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`
  return s
}

/**
 * Merge entries into the log: the same post (same url, or same network + key + day) is updated
 * in place (status/url/quelle win from the newer input), everything else is appended.
 */
export function mergeEntries(log: Publog, inputs: PubInput[]): { log: Publog; added: number; updated: number } {
  const entries = [...log.entries]
  let added = 0
  let updated = 0
  const EMPTY_KEY = textKey('')
  for (const raw of inputs) {
    const e = toEntry(raw)
    if (!e.network || !e.date) continue
    // Textlose Einträge (Stories) teilen denselben Text-Schlüssel – sie werden nur über die URL oder über
    // Netz + Tag + Typ + dieselben Dateien zusammengeführt, nie über den leeren Text.
    const sameDay = (x: PubEntry): boolean => x.network === e.network && x.date.slice(0, 10) === e.date.slice(0, 10)
    const sameMedia = (x: PubEntry): boolean => x.media.length > 0 && x.media.length === e.media.length && x.media.every((m) => e.media.includes(m))
    const idx = entries.findIndex((x) => (e.url && x.url === e.url) || (sameDay(x) && (e.key !== EMPTY_KEY ? x.key === e.key : x.key === EMPTY_KEY && x.type === e.type && sameMedia(x))))
    if (idx >= 0) {
      const old = entries[idx]
      entries[idx] = { ...old, status: e.status, url: e.url || old.url, quelle: e.quelle || old.quelle, media: e.media.length ? e.media : old.media, type: e.type || old.type }
      updated++
    } else {
      entries.push(e)
      added++
    }
  }
  return { log: { ...log, entries }, added, updated }
}
