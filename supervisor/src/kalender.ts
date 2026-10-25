// Kalender-Soll: Soll-Mengen je Netz und Tag (Strategie.md → daily_targets) gegen die
// Veröffentlichungs-Liste (geplant + veröffentlicht) und die Aufgaben in Arbeit. Daraus weiß die
// Welt, wo die Woche Lücken hat, und der Planer bekommt sie wörtlich in den Auftrag.
import type { Task } from './types.js'
import type { PubEntry } from './publog.js'
import { countForDay } from './publog.js'
import { targetFor, type Targets } from './limits.js'

export interface NetzSoll {
  soll: number
  /** geplant + veröffentlicht laut Veröffentlichungs-Liste */
  ist: number
  /** offene Content-Aufgaben (todo/doing/review) für diesen Tag und dieses Netz */
  inArbeit: number
  /** Metricool-Autolist bedient das Netz – Lücke wird gezeigt, aber nicht als fehlend gezählt */
  autolist: boolean
  fehlen: number
}

export const NETZ_WORTE: Record<string, string> = {
  instagram: 'instagram',
  insta: 'instagram',
  ig: 'instagram',
  tiktok: 'tiktok',
  tt: 'tiktok',
  facebook: 'facebook',
  fb: 'facebook',
  linkedin: 'linkedin',
  li: 'linkedin',
  gmb: 'gmb',
  google: 'gmb',
  pinterest: 'pinterest',
  youtube: 'youtube',
}

/** `Content 2026-10-27 Instagram+TikTok 12:30: T01 – Tiger` → { day, networks } */
export function contentTaskTarget(task: Task): { day: string; networks: string[] } | null {
  if (task.fm.station !== 'content') return null
  const m = /^content\s+(\d{4}-\d{2}-\d{2})\b(.*)$/i.exec(task.fm.title)
  const day = m ? m[1] : task.fm.due
  if (!day) return null
  const rest = (m ? m[2] : task.fm.title).toLowerCase()
  const networks = new Set<string>()
  for (const w of rest.split(/[^a-zäöü]+/)) if (NETZ_WORTE[w]) networks.add(NETZ_WORTE[w])
  return { day, networks: [...networks] }
}

/** Offene Content-Aufgaben je Tag und Netz (Titel „Content <Datum> <Netze> …“, sonst `due`). */
export function inArbeitProTag(tasks: Task[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  for (const t of tasks) {
    if (t.fm.status !== 'todo' && t.fm.status !== 'doing' && t.fm.status !== 'review') continue
    const target = contentTaskTarget(t)
    if (!target) continue
    const row = out.get(target.day) ?? {}
    for (const n of target.networks) row[n] = (row[n] ?? 0) + 1
    out.set(target.day, row)
  }
  return out
}

export function sollFuerTag(entries: PubEntry[], targets: Targets, inArbeit: Record<string, number>, day: string, zukunft: boolean): Record<string, NetzSoll> {
  const date = new Date(`${day}T12:00:00`)
  const netze = new Set<string>([...Object.keys(targets), ...entries.filter((e) => e.date.startsWith(day) && (e.status === 'geplant' || e.status === 'veröffentlicht')).map((e) => e.network)])
  const out: Record<string, NetzSoll> = {}
  for (const n of [...netze].sort()) {
    const soll = targetFor(targets, n, date)
    const ist = countForDay(entries, n, day)
    const arbeit = inArbeit[n] ?? 0
    const autolist = targets[n]?.autolist === true
    const fehlen = zukunft && !autolist ? Math.max(0, soll - ist - arbeit) : 0
    if (soll === 0 && ist === 0 && arbeit === 0) continue
    out[n] = { soll, ist, inArbeit: arbeit, autolist, fehlen }
  }
  return out
}

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const label = (day: string): string => {
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime()) ? day : `${WOCHENTAG[d.getDay()]} ${day.slice(8, 10)}.${day.slice(5, 7)}.`
}

/** Für den Planer-Auftrag: „Mo 26.10.: instagram 0/4 (+1 in Arbeit), tiktok 0/4 · Di 27.10.: …“ – leer, wenn nichts fehlt. */
export function lueckenText(tage: Array<{ datum: string; soll: Record<string, NetzSoll> }>): string {
  const parts: string[] = []
  for (const t of tage) {
    const netze = Object.entries(t.soll).filter(([, v]) => v.fehlen > 0)
    if (!netze.length) continue
    parts.push(`${label(t.datum)}: ${netze.map(([n, v]) => `${n} ${v.ist}/${v.soll}${v.inArbeit ? ` (+${v.inArbeit} in Arbeit)` : ''}`).join(', ')}`)
  }
  return parts.join(' · ')
}

export function fehlenGesamt(tage: Array<{ soll: Record<string, NetzSoll> }>): number {
  return tage.reduce((s, t) => s + Object.values(t.soll).reduce((x, v) => x + v.fehlen, 0), 0)
}
