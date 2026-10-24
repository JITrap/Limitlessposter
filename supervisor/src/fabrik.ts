// Die Fabrik: läuft sie oder steht sie? Reine Rechnung aus dem Tick-Zustand des Aufsehers, damit
// die Welt sagen kann, warum gerade niemand arbeitet und wann der nächste Auslöser kommt.
import type { Task } from './types.js'

export interface Ausloeser {
  name: string
  /** YYYY-MM-DDTHH:mm:ss (Ortszeit) */
  wann: string
}

export interface FabrikView {
  /** niemand arbeitet und nichts ist startbar */
  leer: boolean
  leerSeit: string | null
  /** „läuft“, „keine Aufgaben“, „Budget-Pause“, „Stationen nicht verbunden: …“, … */
  grund: string
  naechsteAusloeser: Ausloeser[]
  letzterPlaner: string | null
}

export interface FabrikInput {
  tasks: Task[]
  /** Station → verfügbar */
  available: Map<string, boolean>
  running: number
  paused: { active: boolean; reason: string | null }
  budgetMode: 'normal' | 'cheap-only' | 'paused' | null
  healthOk: boolean
  prevLeerSeit: string | null
  now: Date
  nowStamp: string
  lastPlannerCreated: string | null
  produktionGeladen: boolean
  /** two planner runs in a row produced nothing → the empty nudge waits 2 h */
  plannerBackoff?: boolean
}

/** Startbar = `todo`, keine manuelle Station, Station verfügbar. */
export function runnableTasks(tasks: Task[], available: Map<string, boolean>): Task[] {
  return tasks.filter((t) => t.fm.status === 'todo' && t.fm.station !== 'manual' && available.get(t.fm.station) === true)
}

export function computeFabrik(i: FabrikInput): FabrikView {
  const runnable = runnableTasks(i.tasks, i.available)
  const leer = i.running === 0 && runnable.length === 0
  let grund = 'läuft'
  if (!i.healthOk) grund = 'Aufseher gestoppt (Vorab-Prüfung)'
  else if (i.paused.active) grund = `Pause: ${i.paused.reason ?? 'ohne Grund'}`
  else if (i.budgetMode === 'paused') grund = 'Budget-Pause'
  else if (leer) {
    const blocked = i.tasks.filter((t) => t.fm.status === 'todo' && t.fm.station !== 'manual' && i.available.get(t.fm.station) !== true)
    const stations = [...new Set(blocked.map((t) => t.fm.station))]
    grund = stations.length ? `Stationen nicht verbunden: ${stations.join(', ')}` : i.plannerBackoff ? 'keine Aufgaben – Planer gedrosselt (letzte Läufe brachten nichts Neues)' : 'keine Aufgaben'
  } else if (i.running === 0 && i.budgetMode === 'cheap-only') grund = 'nur günstige Aufgaben (Budget)'
  return {
    leer,
    leerSeit: leer ? (i.prevLeerSeit ?? i.nowStamp) : null,
    grund,
    naechsteAusloeser: naechsteAusloeser(i.now, { lastPlannerCreated: i.lastPlannerCreated, leer, produktionGeladen: i.produktionGeladen, backoff: i.plannerBackoff === true }),
    letzterPlaner: i.lastPlannerCreated,
  }
}

const stamp = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function nextDaily(now: Date, hour: number, minute: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d
}

function nextWeekly(now: Date, weekday: number, hour: number, minute: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  let delta = (weekday - now.getDay() + 7) % 7
  if (delta === 0 && d.getTime() <= now.getTime()) delta = 7
  d.setDate(d.getDate() + delta)
  return d
}

export const PLANER_INTERVAL_MS = 2 * 60 * 60_000
export const PLANER_LEER_INTERVAL_MS = 30 * 60_000

/** Die bekannten Auslöser des Aufsehers, aufsteigend nach Zeit. */
export function naechsteAusloeser(now: Date, o: { lastPlannerCreated: string | null; leer: boolean; produktionGeladen: boolean; backoff?: boolean }): Ausloeser[] {
  const out: Ausloeser[] = []
  const slotHours = 6
  const nextSlot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (Math.floor(now.getHours() / slotHours) + 1) * slotHours, 0, 0, 0)
  out.push({ name: 'Zentrale: Kennzahlen', wann: stamp(nextSlot) })
  out.push({ name: 'Tagesbericht', wann: stamp(nextDaily(now, 7, 30)) })
  out.push({ name: 'Wochenbericht', wann: stamp(nextWeekly(now, 4, 17, 0)) })
  out.push({ name: 'Wochenstrategie', wann: stamp(nextWeekly(now, 3, 20, 0)) })
  if (o.produktionGeladen) out.push({ name: 'Tagesproduktion planen', wann: stamp(nextDaily(now, 5, 30)) })
  const last = o.lastPlannerCreated ? new Date(o.lastPlannerCreated).getTime() : null
  const interval = o.leer && !o.backoff ? PLANER_LEER_INTERVAL_MS : PLANER_INTERVAL_MS
  const planer = last === null || Number.isNaN(last) ? now : new Date(Math.max(now.getTime(), last + interval))
  out.push({ name: o.leer ? 'Planer (Fabrik leer)' : 'Planer (Warteschlange prüfen)', wann: stamp(planer) })
  return out.sort((a, b) => a.wann.localeCompare(b.wann))
}
