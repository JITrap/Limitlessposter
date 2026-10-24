// Produktion sichtbar machen: alles, was die Stationen unter `<Vault>/LimitlessOS/Assets/content/**`
// erzeugen (Slides, Clips, Stimmproben, Captions), als Liste für die Welt und Status.md – neueste
// zuerst, je Datei Typ, Größe, Änderungszeit und die Aufgabe (Ordnername = Aufgaben-ID), dazu die
// Stimme (`<dataDir>/stimme.json`, geschrieben vom Stimm-Adapter). Nur lesen, nie schreiben.
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { parseNote } from './vault/frontmatter.js'

export type MedienTyp = 'bild' | 'video' | 'audio' | 'text'

export interface MedienEintrag {
  /** vault-relativ, mit Schrägstrichen: `Assets/content/<task-id>/slide-1.png` */
  pfad: string
  /** Pfad für den Browser: `/media/Assets/content/…` */
  url: string
  typ: MedienTyp
  /** Bytes */
  groesse: number
  /** YYYY-MM-DDTHH:mm:ss (Ortszeit) */
  geaendert: string
  /** Ordnername unter Assets/content – meist eine Aufgaben-ID */
  aufgabe: string
  /** Titel der Aufgabe, wenn `Aufgaben/<id>.md` existiert, sonst der Ordnername */
  titel: string
}

export interface StimmeView {
  installed: boolean
  engine: 'chatterbox' | 'piper' | null
  cuda: boolean
  voices: string[]
  /** vault-relativ (z. B. `Assets/content/stimme/probe.wav`) oder null */
  lastSample: string | null
  lastError: string | null
  updated: string | null
}

export const MEDIEN_ROOT = posix.join('Assets', 'content')
export const MEDIEN_CACHE_MS = 30_000
const MAX_DEPTH = 4

const TYP_BY_EXT: Record<string, MedienTyp> = {
  '.png': 'bild', '.jpg': 'bild', '.jpeg': 'bild', '.webp': 'bild', '.gif': 'bild', '.svg': 'bild',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.wav': 'audio', '.mp3': 'audio', '.m4a': 'audio', '.ogg': 'audio',
  '.txt': 'text', '.json': 'text', '.md': 'text', '.srt': 'text', '.vtt': 'text',
}

/** MIME-Typen für die /media-Route der Welt (nur, was wir ausliefern). */
export const MEDIEN_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8',
}

export function medienTyp(file: string): MedienTyp | null {
  return TYP_BY_EXT[extname(file).toLowerCase()] ?? null
}

/** `/media/` + jedes Pfadsegment einzeln kodiert (Umlaute, Leerzeichen), Schrägstriche bleiben. */
export function medienUrl(vaultRelativePath: string): string {
  return '/media/' + vaultRelativePath.split('/').map((s) => encodeURIComponent(s)).join('/')
}

export function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function walk(dir: string, rel: string, depth: number, out: Array<{ rel: string; size: number; mtimeMs: number }>): Promise<void> {
  if (depth > MAX_DEPTH) return
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const relPath = rel ? `${rel}/${name}` : name
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) await walk(full, relPath, depth + 1, out)
    else if (st.isFile() && medienTyp(name)) out.push({ rel: relPath, size: st.size, mtimeMs: st.mtimeMs })
  }
}

const titleCache = new Map<string, { mtimeMs: number; title: string }>()

async function taskTitle(vaultRoot: string, id: string): Promise<string> {
  const file = join(vaultRoot, 'Aufgaben', `${id}.md`)
  try {
    const st = await stat(file)
    const hit = titleCache.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.title
    const { data } = parseNote(await readFile(file, 'utf8'))
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : id
    titleCache.set(file, { mtimeMs: st.mtimeMs, title })
    return title
  } catch {
    return id
  }
}

/** Neueste zuerst, höchstens `limit` Dateien. */
export async function listMedien(vaultRoot: string, limit = 40): Promise<MedienEintrag[]> {
  const root = join(vaultRoot, 'Assets', 'content')
  const found: Array<{ rel: string; size: number; mtimeMs: number }> = []
  await walk(root, '', 0, found)
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const out: MedienEintrag[] = []
  for (const f of found.slice(0, limit)) {
    const pfad = `${MEDIEN_ROOT}/${f.rel}`
    const aufgabe = f.rel.includes('/') ? f.rel.slice(0, f.rel.indexOf('/')) : '(Ordner)'
    out.push({
      pfad,
      url: medienUrl(pfad),
      typ: medienTyp(f.rel) ?? 'text',
      groesse: f.size,
      geaendert: localStamp(new Date(f.mtimeMs)),
      aufgabe,
      titel: aufgabe === '(Ordner)' ? aufgabe : await taskTitle(vaultRoot, aufgabe),
    })
  }
  return out
}

export interface MedienCache {
  at: number
  value: MedienEintrag[]
}

/** Höchstens alle 30 s neu lesen – die Welt fragt jeden Tick. */
export async function listMedienCached(vaultRoot: string, cache: MedienCache | null, now: Date, limit = 40): Promise<MedienCache> {
  if (cache && now.getTime() - cache.at < MEDIEN_CACHE_MS) return cache
  return { at: now.getTime(), value: await listMedien(vaultRoot, limit) }
}

export const STIMME_FILE = 'stimme.json'

export const STIMME_LEER: StimmeView = { installed: false, engine: null, cuda: false, voices: [], lastSample: null, lastError: null, updated: null }

/** `<dataDir>/stimme.json` tolerant lesen; fehlt die Datei → „nicht installiert“. */
export function parseStimme(text: string): StimmeView {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const engine = raw.engine === 'chatterbox' || raw.engine === 'piper' ? raw.engine : null
    return {
      installed: raw.installed === true,
      engine,
      cuda: raw.cuda === true,
      voices: Array.isArray(raw.voices) ? raw.voices.map(String) : [],
      lastSample: typeof raw.lastSample === 'string' && raw.lastSample ? raw.lastSample.replace(/\\/g, '/') : null,
      lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError : null,
      updated: typeof raw.updated === 'string' && raw.updated ? raw.updated : null,
    }
  } catch {
    return { ...STIMME_LEER, lastError: 'stimme.json nicht lesbar' }
  }
}

export interface StimmeCache {
  mtimeMs: number
  value: StimmeView
}

export async function loadStimmeCached(dataDir: string, cache: StimmeCache | null): Promise<StimmeCache> {
  const file = join(dataDir, STIMME_FILE)
  let mtimeMs: number
  try {
    mtimeMs = (await stat(file)).mtimeMs
  } catch {
    return { mtimeMs: 0, value: STIMME_LEER }
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache
  try {
    return { mtimeMs, value: parseStimme(await readFile(file, 'utf8')) }
  } catch {
    return { mtimeMs, value: cache?.value ?? STIMME_LEER }
  }
}
