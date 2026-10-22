import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskRepo, slugify, makeTaskId, nowStamp, todayStamp } from '../../src/vault/tasks.js'
import { parseNote, readSection, SECTIONS, stringifyNote } from '../../src/vault/frontmatter.js'

const T0 = new Date('2026-10-22T09:30:00')

describe('ids and stamps', () => {
  it('slugify transliterates umlauts and trims to 40 chars', () => {
    expect(slugify('Test Ö')).toBe('test-oe')
    expect(slugify('Größe & Übersicht!! ß')).toBe('groesse-uebersicht-ss')
    expect(slugify('a'.repeat(60)).length).toBe(40)
    expect(slugify('---Hallo---')).toBe('hallo')
  })

  it('makeTaskId combines timestamp and slug', () => {
    expect(makeTaskId(T0, 'Test Ö')).toBe('20261022-093000-test-oe')
  })

  it('nowStamp/todayStamp use local time without timezone suffix', () => {
    expect(nowStamp(T0)).toBe('2026-10-22T09:30:00')
    expect(todayStamp(T0)).toBe('2026-10-22')
  })
})

describe('TaskRepo', () => {
  let vault: string
  let repo: TaskRepo
  let clock = T0

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'los-vault-'))
    clock = T0
    repo = new TaskRepo(vault, () => clock)
  })

  it('create writes the full schema with defaults and all sections', async () => {
    const t = await repo.create({
      title: 'Test Ö',
      station: 'content',
      tier: 'standard',
      priority: 2,
      origin: 'planer',
      auftrag: 'Mach X',
    })
    expect(t.fm.id).toBe('20261022-093000-test-oe')
    expect(t.path).toBe(join(vault, 'Aufgaben', '20261022-093000-test-oe.md'))
    expect(t.fm).toMatchObject({
      type: 'task',
      status: 'todo',
      attempts: 0,
      max_attempts: 3,
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      needs_approval: false,
      due: null,
      started: null,
      completed: null,
      model_used: null,
      parent: null,
      published_at: null,
      outputs: [],
      tags: ['task'],
      created: '2026-10-22T09:30:00',
      updated: '2026-10-22T09:30:00',
    })
    expect(readSection(t.body, 'Auftrag')).toBe('Mach X')
    for (const h of SECTIONS) expect(t.body).toContain(`## ${h}`)
    const onDisk = parseNote(await readFile(t.path, 'utf8'))
    expect(onDisk.data.id).toBe(t.fm.id)
  })

  it('create avoids id collisions within the same second', async () => {
    const a = await repo.create({ title: 'Gleich', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'a' })
    const b = await repo.create({ title: 'Gleich', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'b' })
    expect(a.fm.id).not.toBe(b.fm.id)
    expect(b.fm.id.startsWith('20261022-093000-gleich')).toBe(true)
  })

  it('update preserves unknown frontmatter keys and untouched body sections', async () => {
    const t = await repo.create({ title: 'Merge', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'A' })
    // Julius edits the note by hand while nothing else is running.
    const raw = parseNote(await readFile(t.path, 'utf8'))
    const edited = stringifyNote(
      { ...raw.data, meine_notiz: 'hallo' },
      raw.body.replace('## Kontext\n', '## Kontext\nJulius war hier\n'),
    )
    await writeFile(t.path, edited, 'utf8')

    clock = new Date('2026-10-22T09:31:00')
    const u = await repo.update(t.fm.id, { status: 'doing', started: '2026-10-22T09:31:00' }, { log: 'Lauf 1' })

    const after = parseNote(await readFile(t.path, 'utf8'))
    expect(after.data.meine_notiz).toBe('hallo')
    expect(after.data.status).toBe('doing')
    expect(after.data.updated).toBe('2026-10-22T09:31:00')
    expect(readSection(after.body, 'Kontext')).toBe('Julius war hier')
    expect(readSection(after.body, 'Protokoll')).toMatch(/^- 2026-10-22 09:31 doing · - · Lauf 1$/)
    expect(u.fm.status).toBe('doing')
  })

  it('update can replace a body section', async () => {
    const t = await repo.create({ title: 'Sek', station: 'content', tier: 'standard', priority: 2, origin: 'planer', auftrag: 'A' })
    await repo.update(t.fm.id, {}, { section: { heading: 'Ergebnis', content: 'Fertig.' } })
    const after = await repo.get(t.fm.id)
    expect(readSection(after!.body, 'Ergebnis')).toBe('Fertig.')
  })

  it('update throws a German error for an unknown id', async () => {
    await expect(repo.update('gibt-es-nicht', { status: 'done' })).rejects.toThrow(/Aufgabe .*gibt-es-nicht.* nicht gefunden/)
  })

  it('list ignores non-task notes and sorts by created', async () => {
    clock = new Date('2026-10-22T10:00:00')
    await repo.create({ title: 'Zwei', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'b' })
    clock = new Date('2026-10-22T09:00:00')
    await repo.create({ title: 'Eins', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'a' })
    await writeFile(join(vault, 'Aufgaben', 'notiz.md'), '# Keine Aufgabe\n', 'utf8')
    await writeFile(join(vault, 'Aufgaben', 'kaputt.md'), '---\ntype: task\nid: [\n---\n', 'utf8')
    const list = await repo.list()
    expect(list.map((t) => t.fm.title)).toEqual(['Eins', 'Zwei'])
  })

  it('get returns null for a missing task', async () => {
    expect(await repo.get('nope')).toBeNull()
  })

  it('archiveOld moves done tasks completed more than N days ago', async () => {
    const old = await repo.create({ title: 'Alt', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'a' })
    await repo.update(old.fm.id, { status: 'done', completed: '2026-09-01T10:00:00' })
    const fresh = await repo.create({ title: 'Neu', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'b' })
    await repo.update(fresh.fm.id, { status: 'done', completed: '2026-10-20T10:00:00' })
    const open = await repo.create({ title: 'Offen', station: 'content', tier: 'cheap', priority: 3, origin: 'system', auftrag: 'c' })

    const moved = await repo.archiveOld(30)
    expect(moved).toEqual([old.fm.id])
    expect(await readdir(join(vault, 'Archiv'))).toEqual([`${old.fm.id}.md`])
    const remaining = (await repo.list()).map((t) => t.fm.id).sort()
    expect(remaining).toEqual([fresh.fm.id, open.fm.id].sort())
  })

  it('works when Aufgaben/ does not exist yet', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'los-vault-empty-'))
    const r = new TaskRepo(empty, () => clock)
    expect(await r.list()).toEqual([])
    await mkdir(join(empty, 'x'))
    const t = await r.create({ title: 'Erst', station: 'planer', tier: 'standard', priority: 1, origin: 'system', auftrag: 'go' })
    expect((await r.list()).map((x) => x.fm.id)).toEqual([t.fm.id])
  })
})
