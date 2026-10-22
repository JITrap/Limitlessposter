import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Decision, FamilyUsage, ModelFamily, RateLimitSignal, Tier } from '../types.js'
import type { Ledger } from './ledger.js'
import { isNight, nextWeekReset, SESSION_MS, sessionStartFor, weekFraction, weekStart, type WeekReset } from './windows.js'

export interface GuardConfig {
  reserveForJuliusPct: number
  weekReset: WeekReset
  budget: {
    /** Placeholder capacities (USD estimate per week) until the guard has learned real ones. */
    initialWeeklyCapacityUsd: Partial<Record<ModelFamily, number>>
    /** Session capacity = weekly capacity × this fraction. */
    sessionFraction: number
  }
}

export interface GuardState {
  learned: Partial<Record<ModelFamily, { weeklyUsd: number; sessionUsd: number }>>
  pausedUntil: string | null
  pauseReason: string | null
  cheapOnlyUntil: string | null
  sessionAnchor: string | null
}

const FAMILIES: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'other']
const LABEL: Record<ModelFamily, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', other: 'Sonstige' }
const ALL_TIERS: Tier[] = ['cheap', 'standard', 'premium']

// Pacing thresholds (spec §6.3)
const WEEK_PAUSE_RATIO = 1.2
const WEEK_CHEAP_RATIO = 1.1
const WEEK_RELAXED_RATIO = 0.8
const SESSION_PAUSE_SHARE = 0.85
const SESSION_CHEAP_SHARE = 0.7
const FALLBACK_PAUSE_MS = 30 * 60_000
const EMA_ALPHA = 0.5

const emptyState = (): GuardState => ({
  learned: {},
  pausedUntil: null,
  pauseReason: null,
  cheapOnlyUntil: null,
  sessionAnchor: null,
})

const pct = (n: number): string => `${Math.round(n * 100)} %`

/**
 * Measures subscription usage from the ledger and official rate-limit signals
 * and decides which tiers may run right now (spec §6).
 */
export class BudgetGuard {
  private state: GuardState = emptyState()

  constructor(
    private readonly ledger: Ledger,
    private readonly cfg: GuardConfig,
    private readonly stateFile: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.stateFile, 'utf8')) as Partial<GuardState>
      this.state = { ...emptyState(), ...raw, learned: raw.learned ?? {} }
    } catch {
      this.state = emptyState()
    }
  }

  /** Call when a worker starts so the 5-hour window gets anchored at the first run after idle. */
  noteRunStart(): void {
    const now = this.clock()
    const anchor = this.state.sessionAnchor ? new Date(this.state.sessionAnchor) : null
    if (!anchor || now.getTime() - anchor.getTime() >= SESSION_MS * 2) {
      this.state.sessionAnchor = now.toISOString()
      void this.save()
    }
  }

  /** Feed an official `rate_limit_event` / 429 signal from a worker stream. */
  async observe(sig: RateLimitSignal): Promise<void> {
    const now = this.clock()
    if (sig.status === 'rejected') {
      const until = sig.resetsAt ?? new Date(now.getTime() + FALLBACK_PAUSE_MS)
      this.state.pausedUntil = until.toISOString()
      this.state.pauseReason = `Claude-Limit erreicht (${windowLabel(sig.window)}) – Pause bis ${fmt(until)}`
      await this.learnFromRejection(sig, now)
    } else if (sig.status === 'allowed_warning') {
      const until = sig.resetsAt ?? this.sessionEnd(now)
      this.state.cheapOnlyUntil = until.toISOString()
    }
    await this.save()
  }

  async decide(): Promise<Decision> {
    const now = this.clock()
    const usage = await this.usage(now)

    // 1. Hard pause from a rejected request.
    if (this.state.pausedUntil) {
      const until = new Date(this.state.pausedUntil)
      if (until.getTime() > now.getTime()) {
        return { mode: 'paused', allowedTiers: new Set(), reason: this.state.pauseReason ?? 'Pause', until, usage }
      }
      this.state.pausedUntil = null
      this.state.pauseReason = null
      await this.save()
    }

    // 2. Weekly pacing per family.
    let worst: { family: ModelFamily; ratio: number } | null = null
    for (const f of FAMILIES) {
      const u = usage.week[f]
      if (u.used <= 0) continue
      const ratio = u.used / Math.max(u.target, 1e-6)
      if (!worst || ratio > worst.ratio) worst = { family: f, ratio }
    }
    if (worst && worst.ratio > WEEK_PAUSE_RATIO) {
      const until = this.catchUpTime(now, usage.week[worst.family])
      return {
        mode: 'paused',
        allowedTiers: new Set(),
        reason: `Wochenbudget ${LABEL[worst.family]} weit über Soll (${pct(worst.ratio)}) – Pause bis ${fmt(until)}`,
        until,
        usage,
      }
    }

    // 3. Session window.
    const sessionShare = usage.session.capacity > 0 ? usage.session.used / usage.session.capacity : 0
    if (sessionShare >= SESSION_PAUSE_SHARE) {
      const until = this.sessionEnd(now)
      return {
        mode: 'paused',
        allowedTiers: new Set(),
        reason: `5-Stunden-Fenster zu ${pct(sessionShare)} verbraucht – Pause bis ${fmt(until)}`,
        until,
        usage,
      }
    }

    const cheapOnly: string[] = []
    if (worst && worst.ratio > WEEK_CHEAP_RATIO) cheapOnly.push(`Wochenbudget ${LABEL[worst.family]} über Soll (${pct(worst.ratio)})`)
    if (sessionShare >= SESSION_CHEAP_SHARE) cheapOnly.push(`5-Stunden-Fenster zu ${pct(sessionShare)} verbraucht`)
    if (this.state.cheapOnlyUntil) {
      const until = new Date(this.state.cheapOnlyUntil)
      if (until.getTime() > now.getTime()) cheapOnly.push(`Claude-Warnung vor dem Limit (bis ${fmt(until)})`)
      else {
        this.state.cheapOnlyUntil = null
        await this.save()
      }
    }
    if (cheapOnly.length > 0) {
      return {
        mode: 'cheap-only',
        allowedTiers: new Set<Tier>(['cheap']),
        reason: `${cheapOnly.join('; ')} – nur günstige Aufgaben`,
        until: null,
        usage,
      }
    }

    // 4. Normal: optionally without premium at night unless well under target.
    const tiers = new Set<Tier>(ALL_TIERS)
    const relaxed = !worst || worst.ratio < WEEK_RELAXED_RATIO
    let reason = 'Im Plan'
    if (isNight(now) && !relaxed) {
      tiers.delete('premium')
      reason = 'Nachtbetrieb – keine Premium-Aufgaben'
    } else if (worst) {
      reason = `Im Plan (${LABEL[worst.family]} bei ${pct(worst.ratio)} des Solls)`
    }
    return { mode: 'normal', allowedTiers: tiers, reason, until: null, usage }
  }

  // ---------------------------------------------------------------------------

  private capacity(f: ModelFamily): number {
    return this.state.learned[f]?.weeklyUsd ?? this.cfg.budget.initialWeeklyCapacityUsd[f] ?? 0
  }

  private sessionCapacity(f: ModelFamily): number {
    return this.state.learned[f]?.sessionUsd ?? this.capacity(f) * this.cfg.budget.sessionFraction
  }

  private reserveFactor(): number {
    return 1 - this.cfg.reserveForJuliusPct / 100
  }

  private sessionStart(now: Date): Date {
    const anchor = this.state.sessionAnchor ? new Date(this.state.sessionAnchor) : now
    return sessionStartFor(anchor, now)
  }

  private sessionEnd(now: Date): Date {
    return new Date(this.sessionStart(now).getTime() + SESSION_MS)
  }

  private async usage(now: Date): Promise<Decision['usage']> {
    const since = weekStart(now, this.cfg.weekReset)
    const fraction = weekFraction(now, this.cfg.weekReset)
    const week = {} as Record<ModelFamily, FamilyUsage>
    for (const f of FAMILIES) {
      const capacity = this.capacity(f)
      week[f] = {
        used: await this.ledger.sumCostSince(since, f),
        target: capacity * this.reserveFactor() * fraction,
        capacity,
      }
    }
    const sessionSince = this.sessionStart(now)
    const sessionUsed = await this.ledger.sumCostSince(sessionSince)
    // Session capacity is shared across models: sum the per-family session capacities that are in use
    // this week, falling back to the largest configured one so an idle account still has a number.
    let sessionCap = 0
    for (const f of FAMILIES) if (week[f].used > 0) sessionCap += this.sessionCapacity(f)
    if (sessionCap === 0) sessionCap = Math.max(...FAMILIES.map((f) => this.sessionCapacity(f)))
    return { week, session: { used: sessionUsed, capacity: sessionCap } }
  }

  /** Instant at which target(t) = used, i.e. the pacing curve has caught up. */
  private catchUpTime(now: Date, u: FamilyUsage): Date {
    const perWeek = u.capacity * this.reserveFactor()
    const start = weekStart(now, this.cfg.weekReset)
    const end = nextWeekReset(now, this.cfg.weekReset)
    if (perWeek <= 0) return end
    const fraction = Math.min(1, u.used / perWeek)
    return new Date(start.getTime() + fraction * (end.getTime() - start.getTime()))
  }

  private async learnFromRejection(sig: RateLimitSignal, now: Date): Promise<void> {
    const families = sig.family === 'all' ? FAMILIES : [sig.family]
    const weekSince = weekStart(now, this.cfg.weekReset)
    const sessionSince = this.sessionStart(now)
    for (const f of families) {
      const usedWeek = await this.ledger.sumCostSince(weekSince, f)
      const usedSession = await this.ledger.sumCostSince(sessionSince, f)
      if (usedWeek <= 0 && usedSession <= 0) continue
      // The configured capacities are placeholders, not measurements: the first
      // observation replaces them, later ones are smoothed with an EMA.
      const prev = this.state.learned[f]
      const next = prev ? { ...prev } : { weeklyUsd: this.capacity(f), sessionUsd: this.sessionCapacity(f) }
      if (sig.window === 'seven_day' && usedWeek > 0) next.weeklyUsd = prev ? ema(prev.weeklyUsd, usedWeek) : usedWeek
      if (sig.window !== 'seven_day' && usedSession > 0) next.sessionUsd = prev ? ema(prev.sessionUsd, usedSession) : usedSession
      this.state.learned[f] = next
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.stateFile), { recursive: true })
    await writeFile(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8')
  }
}

function ema(prev: number, sample: number): number {
  return prev * (1 - EMA_ALPHA) + sample * EMA_ALPHA
}

function windowLabel(w: RateLimitSignal['window']): string {
  return w === 'five_hour' ? '5-Stunden-Fenster' : w === 'seven_day' ? 'Wochenfenster' : 'Fenster unbekannt'
}

function fmt(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`
}
