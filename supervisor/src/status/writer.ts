import { join } from 'node:path'
import type { Decision, ModelFamily, TaskStatus } from '../types.js'
import type { Kennzahlen } from '../kennzahlen.js'
import type { PrintifySummary } from '../adapters/printify.js'
import { stringifyNote } from '../vault/frontmatter.js'
import { writeFileAtomic } from '../vault/atomic.js'

export interface WorkerView {
  taskId: string
  title: string
  station: string
  model: string
  startedAt: string
  tokens: number
}

export interface StationView {
  name: string
  display: string
  available: boolean
  reason: string | null
  autopilot: number
}

/** The Zentrale: everything the dashboard needs from outside the supervisor. */
export interface ZentraleView {
  /** from `Kennzahlen.md` (written by the kennzahlen station), null until the first run */
  kennzahlen: Kennzahlen | null
  /** read directly by the supervisor every hour; ok=false carries the German reason */
  printify: PrintifySummary | null
  /** a kennzahlen task is open or running right now */
  aktualisierung_laeuft: boolean
  /** deep links Julius uses daily */
  links: { name: string; url: string }[]
}

/** Snapshot the supervisor exposes to Status.md and the world view (spec §9, §11). */
export interface SupervisorState {
  now: string
  vaultName: string
  health: { ok: boolean; problems: string[] }
  paused: { active: boolean; reason: string | null; until: string | null }
  decision: Decision | null
  workers: WorkerView[]
  counts: Record<TaskStatus, number>
  stations: StationView[]
  today: {
    posts: number
    postLimit: number
    /** per network from the Veröffentlichungs-Liste (today's scheduled + published) */
    byNetwork: Record<string, { used: number; limit: number }>
    publogSynced: string | null
    /** older than 12 h → the content station only drafts */
    publogStale: boolean
    shopChanges: number
    shopLimit: number
  }
  nextWeekReset: string
  waiting: { id: string; title: string; station: string }[]
  ticker: string[]
  zentrale: ZentraleView
}

const BAR_WIDTH = 20
const FAMILY_LABEL: Record<ModelFamily, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: 'Sonstige' }
const MODE_LABEL: Record<Decision['mode'], string> = { normal: 'normal', 'cheap-only': 'nur günstige Aufgaben', paused: 'Pause' }
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** 20-character progress bar, share clamped to 0..1. */
export function bar(share: number): string {
  const s = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0))
  const filled = Math.floor(s * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const pct = (share: number): string => `${Math.round(Math.min(9.99, Math.max(0, share)) * 100)} %`
const hhmm = (stamp: string): string => stamp.slice(11, 16)
const de = (n: number): string => n.toLocaleString('de-DE')

function formatReset(stamp: string): string {
  const d = new Date(stamp)
  if (Number.isNaN(d.getTime())) return stamp
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${WEEKDAYS[d.getDay()]}, ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function renderStatusMd(s: SupervisorState): string {
  const lines: string[] = []
  const displayOf = (station: string): string => s.stations.find((x) => x.name === station)?.display ?? station

  if (!s.health.ok) {
    lines.push('> [!danger] Aufseher gestoppt', ...s.health.problems.map((p) => `> - ${p}`), '')
  }
  if (s.paused.active) {
    lines.push(`> [!warning] Pause: ${s.paused.reason ?? 'ohne Grund'}${s.paused.until ? ` (bis ${hhmm(s.paused.until)})` : ''}`, '')
  }

  lines.push('## Budget')
  if (s.decision) {
    const d = s.decision
    for (const f of ['opus', 'sonnet', 'haiku'] as const) {
      const u = d.usage.week[f]
      if (!u || u.capacity <= 0) continue
      const share = u.used / u.capacity
      lines.push(`- ${FAMILY_LABEL[f]}: ${pct(share)} der Woche (Soll ${pct(u.target / u.capacity)}) \`${bar(share)}\``)
    }
    const sess = d.usage.session.capacity > 0 ? d.usage.session.used / d.usage.session.capacity : 0
    lines.push(`- Session: ${pct(sess)} des 5-Stunden-Fensters \`${bar(sess)}\``)
    lines.push(`- Modus: ${MODE_LABEL[d.mode]} – ${d.reason}`)
  } else {
    lines.push('- Noch keine Messung.')
  }

  lines.push('', '## Arbeiter')
  if (s.workers.length === 0) lines.push('Niemand arbeitet gerade.')
  for (const w of s.workers) {
    lines.push(`- ${displayOf(w.station)} · ${w.model} · ${w.title} · seit ${hhmm(w.startedAt)} · ${de(w.tokens)} Tokens → [[Aufgaben/${w.taskId}|Notiz]]`)
  }

  lines.push('', '## Aufgaben')
  for (const st of ['todo', 'doing', 'review', 'blocked', 'done', 'cancelled'] as TaskStatus[]) {
    lines.push(`- ${st}: ${s.counts[st] ?? 0}`)
  }

  lines.push('', '## Stationen')
  for (const st of s.stations) {
    lines.push(st.available ? `- ✅ ${st.display} (Autopilot ${st.autopilot})` : `- ⛔ ${st.display} – ${st.reason ?? 'nicht verbunden'}`)
  }

  lines.push('', '## Heute', `- Posts gesamt: ${s.today.posts}/${s.today.postLimit}`)
  for (const [n, v] of Object.entries(s.today.byNetwork ?? {})) lines.push(`  - ${n}: ${v.used}/${v.limit}`)
  lines.push(`- Shop-Änderungen: ${s.today.shopChanges}/${s.today.shopLimit}`)
  lines.push(`- Dubletten-Schutz: Liste zuletzt abgeglichen ${s.today.publogSynced ?? 'noch nie'}${s.today.publogStale ? ' – **veraltet, es wird nur entworfen**' : ''} → [[Pläne/Veröffentlicht]]`)
  lines.push('', '## Nächster Wochen-Reset', formatReset(s.nextWeekReset))

  lines.push('', '## Zentrale')
  const k = s.zentrale?.kennzahlen
  if (k) {
    const geld = (n: number | null): string => (n === null ? '–' : `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${k.shop.waehrung}`)
    lines.push(`- Shop: ${k.shop.bestellungen_7t ?? '–'} Bestellungen / ${geld(k.shop.umsatz_7t)} (7 T) · ${k.shop.bestellungen_28t ?? '–'} / ${geld(k.shop.umsatz_28t)} (28 T)`)
    for (const [name, n] of Object.entries(k.netzwerke)) {
      const delta = n.follower_7t === null ? '' : ` (${n.follower_7t >= 0 ? '+' : ''}${de(n.follower_7t)})`
      lines.push(`- ${name}: ${n.follower === null ? '–' : de(n.follower)} Follower${delta} · Reichweite 7 T ${n.reichweite_7t === null ? '–' : de(n.reichweite_7t)} · ${n.posts_7t ?? '–'} Posts`)
    }
    lines.push(`- Stand ${k.updated ?? '–'} → [[Kennzahlen]]`)
  } else {
    lines.push('- Noch kein Kennzahlen-Lauf → [[Kennzahlen]]')
  }
  const pf = s.zentrale?.printify
  if (pf?.ok) lines.push(`- Printify: ${pf.auftraege.offen} offen · ${pf.auftraege.in_produktion} in Produktion · ${pf.auftraege.versendet_28t} versendet (28 T) · Marge 28 T ${pf.auftraege.marge_28t.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`)
  else if (pf) lines.push(`- Printify: ${pf.fehler}`)

  lines.push('', '## Wartet auf dich')
  if (s.waiting.length === 0) lines.push('Nichts – alles läuft.')
  for (const w of s.waiting) lines.push(`- [[Aufgaben/${w.id}|${w.title}]] (${displayOf(w.station)})`)

  lines.push('', '## Ticker')
  if (s.ticker.length === 0) lines.push('- (leer)')
  for (const t of s.ticker.slice(-20)) lines.push(`- ${t}`)

  return stringifyNote({ type: 'status', updated: s.now }, lines.join('\n') + '\n')
}

export async function writeStatus(vaultRoot: string, s: SupervisorState): Promise<void> {
  await writeFileAtomic(join(vaultRoot, 'Status.md'), renderStatusMd(s))
}
