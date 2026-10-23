import { describe, it, expect } from 'vitest'
import { access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { parseNote } from '../../src/vault/frontmatter.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'vault-template', 'LimitlessOS')

const FILES = [
  'Home.md',
  'Dashboard.base',
  'Status.md',
  'Strategie.md',
  'Marke/Kern.md',
  'Marke/Tonalität.md',
  'Marke/Produkte.md',
  'Marke/Visuell.md',
  'Marke/Hashtags.md',
  'Marke/Kanäle.md',
  'Pläne/Content-Kalender.md',
  'Pläne/Wochenplan.md',
  'Ideen/README.md',
  'Inbox/README.md',
  'Assets/poster/README.md',
  'Assets/content/.gitkeep',
  'Aufgaben/.gitkeep',
  'Berichte/.gitkeep',
  'Archiv/.gitkeep',
]

describe('vault template', () => {
  it('contains every planned file', async () => {
    for (const f of FILES) await access(join(root, f))
  })

  it('Dashboard.base is valid YAML with a base-wide task filter and the five views', async () => {
    const base = parse(await readFile(join(root, 'Dashboard.base'), 'utf8')) as { filters: unknown; views: Array<{ name: string; type: string }> }
    expect(base.filters).toEqual({ and: ['note.type == "task"'] })
    expect(base.views.map((v) => v.name)).toEqual(['Heute', 'Kanban', 'Wartet auf dich', 'Nach Station', 'Kosten'])
    expect(base.views.find((v) => v.name === 'Kanban')!.type).toBe('kanban')
  })

  it('Strategie.md frontmatter mirrors the config keys and holds the value ladder', async () => {
    const { data, body } = parseNote(await readFile(join(root, 'Strategie.md'), 'utf8'))
    expect(data).toMatchObject({
      reserve_for_julius: 30,
      week_reset: 'Thu 18:00',
      daily_post_limit: 3,
      daily_shop_change_limit: 5,
    })
    expect((data.autopilot as Record<string, number>).content).toBe(1)
    expect((data.autopilot as Record<string, number>)['shop-analyst']).toBe(1)
    expect(body).toContain('## Wertleiter')
    expect(body.match(/^\| \d+ \|/gm)?.length).toBe(12)
  })

  it('Home.md embeds Status and the dashboard views and links to the world', async () => {
    const home = await readFile(join(root, 'Home.md'), 'utf8')
    expect(home).toContain('![[Status]]')
    expect(home).toContain('![[Dashboard.base#Wartet auf dich]]')
    expect(home).toContain('![[Dashboard.base#Kanban]]')
    expect(home).toContain('![[Dashboard.base#Heute]]')
    expect(home).toContain('http://localhost:4242')
  })

  it('brand notes ask Julius questions as callouts and set brand defaults', async () => {
    const kern = await readFile(join(root, 'Marke/Kern.md'), 'utf8')
    expect(kern).toContain('> [!question]')
    const ton = await readFile(join(root, 'Marke/Tonalität.md'), 'utf8')
    expect(ton).toMatch(/Du-Ansprache/)
    const produkte = await readFile(join(root, 'Marke/Produkte.md'), 'utf8')
    expect(produkte).toContain('| Produkt | Handle | GID | Preis | Lager | Verkauft 60 T | Umsatz 60 T | Titel optimiert? | Pins? |')
    const kanaele = await readFile(join(root, 'Marke/Kanäle.md'), 'utf8')
    expect(kanaele).toContain('limitlessposter')
    expect(kanaele).toContain('Europe/Berlin')
  })

  it('Produkte.md carries the real catalogue snapshot with image URLs and facts', async () => {
    const { data, body } = parseNote(await readFile(join(root, 'Marke/Produkte.md'), 'utf8'))
    expect(data.produkte).toBe(125)
    const rows = body.split('\n').filter((l) => l.startsWith('| ') && l.includes('gid://shopify/Product/'))
    expect(rows.length).toBe(125)
    for (const r of rows) expect(r).toMatch(/https:\/\/cdn\.shopify\.com\//)
    expect(body).toContain('## Feste Produktfakten')
    expect(body).toContain('versandkostenfrei innerhalb Deutschlands')
    expect(body).not.toMatch(/Eugen-Bolz|@gmail/)
  })

  it('ships the first task cards for Julius and the stations, all parseable', async () => {
    const dir = join(root, 'Aufgaben')
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThanOrEqual(8)
    const stations = new Set<string>()
    for (const f of files) {
      const { data, body } = parseNote(await readFile(join(dir, f), 'utf8'))
      expect(data.type).toBe('task')
      expect(data.id).toBe(f.replace(/\.md$/, ''))
      expect(data.status).toBe('todo')
      expect(body).toContain('## Auftrag')
      expect(body).toContain('## Offene Fragen an Julius')
      stations.add(String(data.station))
      if (data.station === 'content' || data.station === 'shop-analyst') expect(data.needs_approval).toBe(true)
    }
    expect([...stations].sort()).toEqual(['content', 'manual', 'shop-analyst', 'studio'])
  })

  it('Status.md placeholder parses as a status note', async () => {
    const { data } = parseNote(await readFile(join(root, 'Status.md'), 'utf8'))
    expect(data.type).toBe('status')
  })
})
