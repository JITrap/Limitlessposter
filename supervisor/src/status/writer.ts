import { join } from 'node:path'
import type { Decision, ModelFamily, TaskStatus } from '../types.js'
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
  today: { posts: number; postLimit: number; shopChanges: number; shopLimit: number }
  nextWeekReset: string
  waiting: { id: string; title: string; station: string }[]
  ticker: string[]
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

  lines.push('', '## Heute', `- Posts: ${s.today.posts}/${s.today.postLimit}`, `- Shop-Änderungen: ${s.today.shopChanges}/${s.today.shopLimit}`)
  lines.push('', '## Nächster Wochen-Reset', formatReset(s.nextWeekReset))

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
