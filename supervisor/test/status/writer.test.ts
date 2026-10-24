import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderStatusMd, writeStatus, bar, tagLabel, type SupervisorState } from '../../src/status/writer.js'
import { parseNote, readSection } from '../../src/vault/frontmatter.js'

const state: SupervisorState = {
  now: '2026-10-22T10:15:00',
  vaultName: 'MeinVault',
  health: { ok: true, problems: [] },
  paused: { active: false, reason: null, until: null },
  decision: {
    mode: 'cheap-only',
    allowedTiers: new Set(['cheap']),
    reason: 'Wochenbudget Sonnet über Soll (112 %) – nur günstige Aufgaben',
    until: null,
    usage: {
      week: {
        opus: { used: 10, target: 52.5, capacity: 300 },
        sonnet: { used: 235, target: 105, capacity: 600 },
        haiku: { used: 0, target: 35, capacity: 200 },
        other: { used: 0, target: 0, capacity: 0 },
      },
      session: { used: 7.2, capacity: 60 },
    },
  },
  workers: [
    { taskId: 't1', title: 'Karussell 5 Räume', station: 'content', model: 'sonnet', startedAt: '2026-10-22T10:05:00', tokens: 14231 },
  ],
  counts: { todo: 4, doing: 1, review: 2, blocked: 1, done: 17, cancelled: 0 },
  stations: [
    { name: 'content', display: 'Content-Studio', available: true, reason: null, autopilot: 1 },
    { name: 'shop-analyst', display: 'Shop-Büro', available: false, reason: 'Umgebungsvariable SHOPIFY_CLIENT_ID fehlt', autopilot: 1 },
  ],
  today: { posts: 1, postLimit: 3, byNetwork: { instagram: { used: 1, limit: 4 } }, publogSynced: '2026-10-24T07:00:00', publogStale: false, shopChanges: 0, shopLimit: 5 },
  nextWeekReset: '2026-10-22T18:00:00',
  waiting: [{ id: 't7', title: 'Reel: Druckprozess', station: 'content' }],
  ticker: ['10:05 content · Lauf gestartet', '10:11 reviewer · fertig'],
  zentrale: { kennzahlen: null, printify: null, aktualisierung_laeuft: false, links: [] },
  fabrik: {
    leer: false,
    leerSeit: null,
    grund: 'läuft',
    naechsteAusloeser: [
      { name: 'Zentrale: Kennzahlen', wann: '2026-10-22T12:00:00' },
      { name: 'Tagesbericht', wann: '2026-10-23T07:30:00' },
    ],
    letzterPlaner: '2026-10-22T09:50:00',
  },
  kalender: {
    tage: [
      { datum: '2026-10-21', heute: false, eintraege: [] },
      {
        datum: '2026-10-22',
        heute: true,
        eintraege: [{ zeit: '18:30', netzwerk: 'instagram', typ: 'reel', status: 'geplant', text: 'Ein Poster, fünf Räume – so wirkt dieselbe Wand ganz anders', url: 'https://app.metricool.com/p/1' }],
      },
    ],
    heute: { instagram: { used: 1, limit: 4 } },
  },
  medien: [
    { pfad: 'Assets/content/t1/slide-1.png', url: '/media/Assets/content/t1/slide-1.png', typ: 'bild', groesse: 1234, geaendert: '2026-10-22T09:58:00', aufgabe: 't1', titel: 'Karussell 5 Räume' },
  ],
  stimme: { installed: true, engine: 'chatterbox', cuda: true, voices: ['julius'], lastSample: 'Assets/content/stimme/probe.wav', lastError: null, updated: '2026-10-22T09:00:00' },
}

describe('bar', () => {
  it('renders a 20-character bar clamped to 0..100 %', () => {
    expect(bar(0)).toBe('░░░░░░░░░░░░░░░░░░░░')
    expect(bar(0.5)).toBe('██████████░░░░░░░░░░')
    expect(bar(1.7)).toBe('████████████████████')
    expect(bar(-1)).toBe('░░░░░░░░░░░░░░░░░░░░')
  })
})

describe('tagLabel', () => {
  it('renders weekday and day.month. in German, tolerating junk', () => {
    expect(tagLabel('2026-10-22')).toBe('Do 22.10.')
    expect(tagLabel('2026-10-24')).toBe('Sa 24.10.')
    expect(tagLabel('kein Datum')).toBe('kein Datum')
  })
})

describe('renderStatusMd', () => {
  const md = renderStatusMd(state)
  const { data, body } = parseNote(md)

  it('has status frontmatter', () => {
    expect(data).toMatchObject({ type: 'status', updated: '2026-10-22T10:15:00' })
  })

  it('renders budget per family with bar, week share, target and session share', () => {
    const budget = readSection(body, 'Budget')!
    expect(budget).toContain('Sonnet: 39 % der Woche (Soll 18 %) ')
    expect(budget).toMatch(/Sonnet:.*█{7}░{13}/)
    expect(budget).toContain('Session: 12 %')
    expect(budget).toContain('Modus: nur günstige Aufgaben')
    expect(budget).toContain('Wochenbudget Sonnet über Soll')
  })

  it('lists workers and counts', () => {
    expect(readSection(body, 'Arbeiter')).toContain('Content-Studio · sonnet · Karussell 5 Räume · seit 10:05 · 14.231 Tokens')
    const counts = readSection(body, 'Aufgaben')!
    expect(counts).toContain('todo: 4')
    expect(counts).toContain('review: 2')
  })

  it('marks stations with ✅/⛔ and the reason', () => {
    const st = readSection(body, 'Stationen')!
    expect(st).toContain('✅ Content-Studio (Autopilot 1)')
    expect(st).toContain('⛔ Shop-Büro – Umgebungsvariable SHOPIFY_CLIENT_ID fehlt')
  })

  it('shows daily counters and the next reset', () => {
    expect(readSection(body, 'Heute')).toContain('Posts gesamt: 1/3')
    expect(readSection(body, 'Heute')).toContain('instagram: 1/4')
    expect(readSection(body, 'Heute')).toContain('Dubletten-Schutz')
    expect(readSection(body, 'Heute')).toContain('Shop-Änderungen: 0/5')
    expect(readSection(body, 'Nächster Wochen-Reset')).toContain('Donnerstag, 22.10.2026 18:00')
  })

  it('lists waiting tasks as wikilinks', () => {
    expect(readSection(body, 'Wartet auf dich')).toContain('[[Aufgaben/t7|Reel: Druckprozess]]')
  })

  it('says whether the factory runs, when the planner was last nudged and what fires next', () => {
    const f = readSection(body, 'Fabrik')!
    expect(f).toContain('- Läuft – 1 Arbeiter · läuft')
    expect(f).toContain('- Letzter Planer-Anstoß: 2026-10-22 09:50')
    expect(f).toContain('- Nächster Auslöser: Zentrale: Kennzahlen – 2026-10-22 12:00')
    expect(f).toContain('- Nächster Auslöser: Tagesbericht – 2026-10-23 07:30')
    const idle = renderStatusMd({ ...state, workers: [], fabrik: { ...state.fabrik, leer: true, leerSeit: '2026-10-22T09:00:00', grund: 'keine Aufgaben', letzterPlaner: null } })
    const fi = readSection(parseNote(idle).body, 'Fabrik')!
    expect(fi).toContain('- **Steht** seit 2026-10-22 09:00 – keine Aufgaben')
    expect(fi).toContain('- Letzter Planer-Anstoß: noch nie')
  })

  it('renders the 7-day calendar with today in bold and long texts shortened', () => {
    const k = readSection(body, 'Kalender (7 Tage)')!
    expect(k).toContain('- Mi 21.10.: –')
    expect(k).toContain('- **Do 22.10. (heute)**: instagram 18:30 geplant „Ein Poster, fünf Räume – so wirkt diese…“')
    const leer = renderStatusMd({ ...state, kalender: { tage: [], heute: {} } })
    expect(readSection(parseNote(leer).body, 'Kalender (7 Tage)')).toContain('Noch keine Einträge → [[Pläne/Veröffentlicht]]')
  })

  it('lists the latest media as wikilinks and the state of the voice under Produktion', () => {
    const p = readSection(body, 'Produktion')!
    expect(p).toContain('- [[Assets/content/t1/slide-1.png]] · bild · Karussell 5 Räume · 2026-10-22 09:58')
    expect(p).toContain('- Stimme: chatterbox (GPU) · 1 Stimmen · letzte Probe [[Assets/content/stimme/probe.wav]]')
    const ohne = renderStatusMd({
      ...state,
      medien: [],
      stimme: { installed: false, engine: null, cuda: false, voices: [], lastSample: null, lastError: 'Python 3.11 fehlt', updated: null },
    })
    const po = readSection(parseNote(ohne).body, 'Produktion')!
    expect(po).toContain('- Noch nichts erzeugt (Assets/content ist leer).')
    expect(po).toContain('- Stimme: nicht installiert – Python 3.11 fehlt')
  })

  it('renders the ticker and an idle worker line', () => {
    expect(readSection(body, 'Ticker')).toContain('- 10:11 reviewer · fertig')
    const idle = renderStatusMd({ ...state, workers: [] })
    expect(readSection(parseNote(idle).body, 'Arbeiter')).toBe('Niemand arbeitet gerade.')
  })

  it('shows problems in red when unhealthy', () => {
    const sick = renderStatusMd({ ...state, health: { ok: false, problems: ['Nicht angemeldet'] } })
    expect(sick).toContain('> [!danger] Aufseher gestoppt')
    expect(sick).toContain('Nicht angemeldet')
  })

  it('shows the pause reason when paused', () => {
    const paused = renderStatusMd({ ...state, paused: { active: true, reason: 'PAUSE-Datei vorhanden', until: null } })
    expect(paused).toContain('> [!warning] Pause: PAUSE-Datei vorhanden')
  })
})

describe('writeStatus', () => {
  it('writes Status.md atomically into the vault root', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'los-status-'))
    await writeStatus(vault, state)
    const text = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(text.startsWith('---\ntype: status')).toBe(true)
  })
})
