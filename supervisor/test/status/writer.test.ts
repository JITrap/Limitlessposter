import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderStatusMd, writeStatus, bar, type SupervisorState } from '../../src/status/writer.js'
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
  today: { posts: 1, postLimit: 3, shopChanges: 0, shopLimit: 5 },
  nextWeekReset: '2026-10-22T18:00:00',
  waiting: [{ id: 't7', title: 'Reel: Druckprozess', station: 'content' }],
  ticker: ['10:05 content · Lauf gestartet', '10:11 reviewer · fertig'],
  zentrale: { kennzahlen: null, printify: null, aktualisierung_laeuft: false, links: [] },
}

describe('bar', () => {
  it('renders a 20-character bar clamped to 0..100 %', () => {
    expect(bar(0)).toBe('░░░░░░░░░░░░░░░░░░░░')
    expect(bar(0.5)).toBe('██████████░░░░░░░░░░')
    expect(bar(1.7)).toBe('████████████████████')
    expect(bar(-1)).toBe('░░░░░░░░░░░░░░░░░░░░')
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
    expect(readSection(body, 'Heute')).toContain('Posts: 1/3')
    expect(readSection(body, 'Heute')).toContain('Shop-Änderungen: 0/5')
    expect(readSection(body, 'Nächster Wochen-Reset')).toContain('Donnerstag, 22.10.2026 18:00')
  })

  it('lists waiting tasks as wikilinks', () => {
    expect(readSection(body, 'Wartet auf dich')).toContain('[[Aufgaben/t7|Reel: Druckprozess]]')
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
