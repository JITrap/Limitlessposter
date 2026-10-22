import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Task, TaskFrontmatter, TaskOrigin, Tier } from '../types.js'
import { appendLine, parseNote, SECTIONS, stringifyNote, upsertSection } from './frontmatter.js'
import { writeFileAtomic } from './atomic.js'

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/** Lowercase ASCII slug: umlauts transliterated, non-alphanumerics collapsed to `-`, max 40 chars. */
export function slugify(input: string): string {
  const lowered = input.toLowerCase().replace(/[äöüß]/g, (c) => TRANSLIT[c] ?? c)
  return lowered
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DDTHH:mm:ss` in local time (Obsidian "Date & time" property). */
export function nowStamp(d: Date): string {
  return `${todayStamp(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `YYYY-MM-DD` in local time (Obsidian "Date" property). */
export function todayStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `YYYYMMDD-HHmmss-<slug>` – also the note's file name without `.md`. */
export function makeTaskId(now: Date, title: string): string {
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const slug = slugify(title) || 'aufgabe'
  return `${ts}-${slug}`
}

export interface NewTask {
  title: string
  station: string
  tier: Tier
  priority: 1 | 2 | 3 | 4
  origin: TaskOrigin
  auftrag: string
  due?: string | null
  kontext?: string
  needs_approval?: boolean
  parent?: string | null
  tags?: string[]
}

export type TaskPatch = Partial<TaskFrontmatter>

export interface UpdateOptions {
  /** Appended to `## Protokoll` as `- <date time> <status> · <model> · <log>`. */
  log?: string
  /** Replace one body section. */
  section?: { heading: string; content: string }
}

/** Order of frontmatter keys as written to disk (spec §4.1). */
const KEY_ORDER: (keyof TaskFrontmatter)[] = [
  'type', 'id', 'title', 'status', 'station', 'priority', 'tier', 'due', 'created', 'updated',
  'started', 'completed', 'attempts', 'max_attempts', 'cost_usd', 'tokens_in', 'tokens_out',
  'model_used', 'outputs', 'needs_approval', 'origin', 'parent', 'published_at', 'tags',
]

function orderKeys(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of KEY_ORDER) if (k in data) out[k] = data[k]
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k]
  return out
}

function protocolStamp(d: Date): string {
  return `${todayStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Repository over `LimitlessOS/Aufgaben/*.md`. One note per task; all state in
 * frontmatter; every write is a re-read + merge + atomic write (spec §4.3).
 */
export class TaskRepo {
  readonly tasksDir: string
  readonly archiveDir: string

  constructor(
    readonly vaultRoot: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.tasksDir = join(vaultRoot, 'Aufgaben')
    this.archiveDir = join(vaultRoot, 'Archiv')
  }

  pathFor(id: string): string {
    return join(this.tasksDir, `${id}.md`)
  }

  async list(): Promise<Task[]> {
    let files: string[]
    try {
      files = await readdir(this.tasksDir)
    } catch {
      return []
    }
    const tasks: Task[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const t = await this.read(join(this.tasksDir, f))
      if (t) tasks.push(t)
    }
    tasks.sort((a, b) => a.fm.created.localeCompare(b.fm.created) || a.fm.id.localeCompare(b.fm.id))
    return tasks
  }

  async get(id: string): Promise<Task | null> {
    try {
      await stat(this.pathFor(id))
    } catch {
      return null
    }
    return this.read(this.pathFor(id))
  }

  async create(input: NewTask): Promise<Task> {
    const now = this.clock()
    const stamp = nowStamp(now)
    let id = makeTaskId(now, input.title)
    let suffix = 2
    while (await this.get(id)) id = `${makeTaskId(now, input.title)}-${suffix++}`

    const fm: TaskFrontmatter = {
      type: 'task',
      id,
      title: input.title,
      status: 'todo',
      station: input.station,
      priority: input.priority,
      tier: input.tier,
      due: input.due ?? null,
      created: stamp,
      updated: stamp,
      started: null,
      completed: null,
      attempts: 0,
      max_attempts: 3,
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      model_used: null,
      outputs: [],
      needs_approval: input.needs_approval ?? false,
      origin: input.origin,
      parent: input.parent ?? null,
      published_at: null,
      tags: input.tags ?? ['task'],
    }
    let body = ''
    for (const h of SECTIONS) {
      const content = h === 'Auftrag' ? input.auftrag : h === 'Kontext' ? (input.kontext ?? '') : ''
      body = upsertSection(body, h, content)
    }
    const path = this.pathFor(id)
    await writeFileAtomic(path, stringifyNote(orderKeys(fm as unknown as Record<string, unknown>), body))
    return { fm, body, path }
  }

  async update(id: string, patch: TaskPatch, opts: UpdateOptions = {}): Promise<Task> {
    const path = this.pathFor(id)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      throw new Error(`Aufgabe „${id}“ nicht gefunden (${path})`)
    }
    const { data, body: oldBody } = parseNote(text)
    const now = this.clock()
    const merged: Record<string, unknown> = { ...data, ...patch, updated: nowStamp(now) }

    let body = oldBody
    if (opts.section) body = upsertSection(body, opts.section.heading, opts.section.content)
    if (opts.log) {
      const status = String(merged.status ?? '-')
      const model = merged.model_used ? String(merged.model_used) : '-'
      body = appendLine(body, 'Protokoll', `- ${protocolStamp(now)} ${status} · ${model} · ${opts.log}`)
    }
    await writeFileAtomic(path, stringifyNote(orderKeys(merged), body))
    return { fm: merged as unknown as TaskFrontmatter, body, path }
  }

  /** Move `done`/`cancelled` tasks whose `completed` (or `updated`) is older than `days` into `Archiv/`. */
  async archiveOld(days: number): Promise<string[]> {
    const cutoff = new Date(this.clock().getTime() - days * 86_400_000)
    const moved: string[] = []
    for (const t of await this.list()) {
      if (t.fm.status !== 'done' && t.fm.status !== 'cancelled') continue
      const when = t.fm.completed ?? t.fm.updated
      if (!when || new Date(when) >= cutoff) continue
      await mkdir(this.archiveDir, { recursive: true })
      await rename(t.path, join(this.archiveDir, `${t.fm.id}.md`))
      moved.push(t.fm.id)
    }
    return moved
  }

  private async read(path: string): Promise<Task | null> {
    try {
      const text = await readFile(path, 'utf8')
      const { data, body } = parseNote(text)
      if (data.type !== 'task' || typeof data.id !== 'string') return null
      return { fm: data as unknown as TaskFrontmatter, body, path }
    } catch {
      return null
    }
  }
}
