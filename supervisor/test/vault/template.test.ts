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
  'Kennzahlen.md',
  'Marke/Kern.md',
  'Marke/Tonalität.md',
  'Marke/Produkte.md',
  'Marke/Visuell.md',
  'Marke/Hashtags.md',
  'Marke/Kanäle.md',
  'Pläne/Content-Kalender.md',
  'Pläne/Wochenplan.md',
  'Pläne/Content-Bank.md',
  'Pläne/Veröffentlicht.md',
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
    expect((data.autopilot as Record<string, number>).content).toBe(2)
    expect((data.autopilot as Record<string, number>)['shop-analyst']).toBe(1)
    expect(body).toContain('## Wertleiter')
    expect(body.match(/^\| \d+ \|/gm)?.length).toBe(13)
  })

  it('Content-Bank.md lists all 41 cards of Julius\' content bank with a status column', async () => {
    const { data, body } = parseNote(await readFile(join(root, 'Pläne/Content-Bank.md'), 'utf8'))
    expect(data.karten).toBe(41)
    const rows = body.match(/^\| (?:\d+|–) \| `[a-z]\d\d` \|/gm) ?? []
    expect(rows.length).toBe(41)
    expect(body).toContain('| Status | Geplant für | plannerUrl |')
    expect(body).toContain('## Profil (Metricool / Bio)')
  })

  it('Veröffentlicht.md seeds the duplicate guard with the real Instagram and TikTok history', async () => {
    const { data, body } = parseNote(await readFile(join(root, 'Pläne/Veröffentlicht.md'), 'utf8'))
    expect(data.type).toBe('veroeffentlichungen')
    const rows = body.split('\n').filter((l) => /^\| 2026-/.test(l))
    expect(rows.length).toBeGreaterThanOrEqual(45)
    expect(body).toContain('https://www.instagram.com/p/DeZhypQCnu1/')
    expect(body).toMatch(/\| tiktok \| video \|/)
    expect(body).toMatch(/\| entwurf \|/)
  })

  it('Strategie.md carries per-network limits', async () => {
    const { data } = parseNote(await readFile(join(root, 'Strategie.md'), 'utf8'))
    expect((data.daily_post_limits as Record<string, number>).instagram).toBe(8)
    expect((data.daily_post_limits as Record<string, number>).tiktok).toBe(4)
    expect((data.daily_post_limits as Record<string, number>).facebook).toBe(8)
    const targets = data.daily_targets as Record<string, string>
    expect(targets.instagram).toBe('3 Reels + 1 Karussell + 4 Stories')
    expect(targets.tiktok).toBe('3 Videos + 1 Fotobeitrag')
    expect(targets.facebook).toMatch(/3 Reels \+ 1 Post \+ 4 Stories/)
    expect(data.max_open_tasks).toBe(40)
    expect(data.reserve_wachstum).toBe(6)
  })

  it('manual cards that the supervisor can verify carry auto_done conditions', async () => {
    const logins = parseNote(await readFile(join(root, 'Aufgaben/20261023-020000-logins-claude-metricool-shopify.md'), 'utf8'))
    expect(logins.data.auto_done).toBe('claude-login, mcp:metricool, mcp:shopify')
    const printify = parseNote(await readFile(join(root, 'Aufgaben/20261023-020900-printify-api-token-anlegen.md'), 'utf8'))
    expect(printify.data.auto_done).toBe('env:PRINTIFY_API_TOKEN')
    const higgsfield = parseNote(await readFile(join(root, 'Aufgaben/20261026-090000-higgsfield-mcp-anmelden.md'), 'utf8'))
    expect(higgsfield.data.auto_done).toBe('mcp:higgsfield')
    expect(higgsfield.data.station).toBe('manual')
  })

  it('Wachstum.md is a complete growth catalog with numbered packages, prerequisites and planner rules', async () => {
    const { data, body } = parseNote(await readFile(join(root, 'Pläne/Wachstum.md'), 'utf8'))
    expect(data.type).toBe('plan')
    const rows = body.match(/^\| W\d\d \| /gm) ?? []
    expect(rows.length).toBeGreaterThanOrEqual(40)
    expect(data.pakete).toBe(rows.length)
    for (const h of ['## Shop', '## Reichweite', '## Daten', '## Kunde', '## Marke & Saison', '## Braucht erst Werkzeug oder Julius', '## Regeln für den Planer', '## Saisonkalender']) expect(body).toContain(h)
    expect(body).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('Produktion.md mirrors the slot table of the old automation including Facebook', async () => {
    const prod = await readFile(join(root, 'Pläne/Produktion.md'), 'utf8')
    expect(prod).toContain('| Mo | 12:30 · 16:30 · 19:30 | 07:30 | 12:30 · 16:30 · 20:00 | 07:30 | 12:00 · 15:30 · 18:30 | 09:00 | 08:15 | – |')
    expect(prod).toContain('| So | 10:00 · 14:00 · 21:00 | 17:30 | 10:00 · 14:00 · 20:00 | 17:00 | 10:30 · 14:30 · 20:30 | 17:00 | – | – |')
    expect(parseNote(prod).data.stories).toBe('ja')
    expect(parseNote(prod).data.higgsfield).toBe('ja')
    expect(parseNote(prod).data.higgsfield_pro_tag).toBe(2)
    expect(prod).toContain('**H01**')
  })

  it('Home.md embeds Status and the dashboard views and links to the world', async () => {
    const home = await readFile(join(root, 'Home.md'), 'utf8')
    expect(home).toContain('![[Status]]')
    expect(home).toContain('![[Dashboard.base#Wartet auf dich]]')
    expect(home).toContain('![[Dashboard.base#Kanban]]')
    expect(home).toContain('![[Dashboard.base#Heute]]')
    expect(home).toContain('http://localhost:4242')
  })

  it('brand notes carry Julius\' confirmed answers and set brand defaults', async () => {
    const kern = await readFile(join(root, 'Marke/Kern.md'), 'utf8')
    expect(kern).toContain('Marke aus Deutschland')
    expect(kern).toContain('## Tabus')
    expect(kern).toContain('[[Pläne/Content-Bank]]')
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
    expect(files.length).toBeGreaterThanOrEqual(9)
    const stations = new Set<string>()
    for (const f of files) {
      const { data, body } = parseNote(await readFile(join(dir, f), 'utf8'))
      expect(data.type).toBe('task')
      expect(data.id).toBe(f.replace(/\.md$/, ''))
      expect(['todo', 'done']).toContain(data.status)
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
