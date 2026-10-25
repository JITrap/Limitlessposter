// Per-network daily post limits ("3 Posts auf Instagram, nicht 3 insgesamt"). Defaults here,
// overridden by limitless.config.json → dailyPostLimits and finally by Julius in
// Strategie.md → frontmatter `daily_post_limits:` (the note wins, it is his control surface).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseNote } from './vault/frontmatter.js'

export type Limits = Record<string, number>

export const DEFAULT_LIMITS: Limits = { instagram: 4, tiktok: 4, facebook: 2, linkedin: 1, gmb: 1, pinterest: 2, youtube: 1 }

export function limitFor(limits: Limits, network: string): number {
  return limits[network.toLowerCase()] ?? limits.default ?? 1
}

export function totalLimit(limits: Limits): number {
  return Object.entries(limits).filter(([k]) => k !== 'default').reduce((s, [, v]) => s + v, 0)
}

export function parseLimits(raw: unknown): Limits {
  const out: Limits = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v)
      if (Number.isInteger(n) && n >= 0) out[k.toLowerCase()] = n
    }
  }
  return out
}

/** Strategie.md → `daily_post_limits: { instagram: 4, … }`; missing note or key → {} */
export async function strategieLimits(vaultRoot: string): Promise<Limits> {
  try {
    const { data } = parseNote(await readFile(join(vaultRoot, 'Strategie.md'), 'utf8'))
    return parseLimits(data.daily_post_limits)
  } catch {
    return {}
  }
}

/** defaults ← config ← Strategie.md */
export async function loadLimits(configLimits: Limits | undefined, vaultRoot: string): Promise<Limits> {
  return { ...DEFAULT_LIMITS, ...(configLimits ?? {}), ...(vaultRoot ? await strategieLimits(vaultRoot) : {}) }
}

// --- Soll-Mengen je Netzwerk ("daily_targets") ------------------------------------------
// Julius schreibt sie lesbar in Strategie.md: `instagram: "3 Reels + 1 Karussell + 4 Stories"`,
// `linkedin: "1 Post Mo/Mi/Fr (Autolist)"`. Wir lesen daraus Anzahl, Wochentage und ob eine
// Metricool-Autolist das Netz bedient (dann ist eine Lücke kein Fehler des Systems).

export interface Target {
  /** Beiträge pro Tag (inklusive Stories), an den genannten Wochentagen */
  count: number
  /** davon Stories (jede Story hängt an einem Beitrag – eine Content-Aufgabe deckt beides ab) */
  stories: number
  /** false = Netz steht nicht in Marke/Kanäle.md `metricool_netzwerke` → kein Soll, keine Lücke */
  verbunden: boolean
  /** 0 = So … 6 = Sa; null = jeden Tag */
  days: number[] | null
  /** Metricool-Autolist füllt das Netz – Lücken werden angezeigt, aber nicht als fehlend gezählt */
  autolist: boolean
  text: string
}

export type Targets = Record<string, Target>

const WEEKDAY_TOKEN: Record<string, number> = { so: 0, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6 }

export const DEFAULT_TARGETS: Targets = {
  instagram: parseTarget('3 Reels + 1 Karussell'),
  tiktok: parseTarget('3 Videos + 1 Fotobeitrag'),
}

/** `"3 Reels + 1 Karussell + 4 Stories"` → 8 pro Tag; `"1 Post Mo/Mi/Fr (Autolist)"` → 1 an Mo, Mi, Fr. */
export function parseTarget(raw: unknown): Target {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { count: Math.max(0, Math.round(raw)), stories: 0, days: null, autolist: false, verbunden: true, text: String(raw) }
  const text = String(raw ?? '').trim()
  let count = 0
  let stories = 0
  for (const m of text.matchAll(/(?:^|[^\d:.,])(\d{1,2})(?=\s*([A-Za-zÄÖÜäöüß×]))/g)) {
    count += Number(m[1])
    if (/^\s*stor/i.test(text.slice(m.index! + m[0].length))) stories += Number(m[1])
  }
  const days = new Set<number>()
  for (const m of text.matchAll(/(?:^|[^A-Za-zÄÖÜäöü])(Mo|Di|Mi|Do|Fr|Sa|So)(?=$|[^A-Za-zÄÖÜäöü])/g)) days.add(WEEKDAY_TOKEN[m[1].toLowerCase()])
  return { count, stories, days: days.size ? [...days].sort() : null, autolist: /autolist/i.test(text), verbunden: true, text }
}

export function parseTargets(raw: unknown): Targets {
  const out: Targets = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const t = parseTarget(v)
      if (t.count > 0 || t.text) out[k.toLowerCase()] = t
    }
  }
  return out
}

/** Soll für ein Netz an einem Datum (0, wenn kein Ziel oder nicht dieser Wochentag). */
export function targetFor(targets: Targets, network: string, date: Date): number {
  const t = targets[network.toLowerCase()]
  if (!t || t.verbunden === false) return 0
  if (t.days && !t.days.includes(date.getDay())) return 0
  return t.count
}

/** Marke/Kanäle.md → `metricool_netzwerke: [instagram, tiktok, …]`; fehlt die Liste → null (alles gilt als verbunden). */
export async function verbundeneNetze(vaultRoot: string): Promise<string[] | null> {
  try {
    const { data } = parseNote(await readFile(join(vaultRoot, 'Marke', 'Kanäle.md'), 'utf8'))
    const raw = data.metricool_netzwerke
    if (!Array.isArray(raw)) return null
    return raw.map((n) => String(n).toLowerCase().trim()).filter(Boolean)
  } catch {
    return null
  }
}

/** Strategie.md → `daily_targets:`; fehlt die Notiz oder der Schlüssel → {} */
export async function strategieTargets(vaultRoot: string): Promise<Targets> {
  try {
    const { data } = parseNote(await readFile(join(vaultRoot, 'Strategie.md'), 'utf8'))
    return parseTargets(data.daily_targets)
  } catch {
    return {}
  }
}

/**
 * defaults ← Strategie.md (die Notiz ersetzt die Vorgaben vollständig, sobald sie Ziele nennt); Netze, die
 * Marke/Kanäle.md nicht als verbunden führt (z. B. Facebook vor der Verbindung), bekommen kein Soll.
 */
export async function loadTargets(vaultRoot: string): Promise<Targets> {
  const fromNote = vaultRoot ? await strategieTargets(vaultRoot) : {}
  const targets: Targets = Object.keys(fromNote).length ? fromNote : { ...DEFAULT_TARGETS }
  const verbunden = vaultRoot ? await verbundeneNetze(vaultRoot) : null
  if (verbunden) for (const [n, t] of Object.entries(targets)) targets[n] = { ...t, verbunden: verbunden.includes(n) }
  return targets
}

