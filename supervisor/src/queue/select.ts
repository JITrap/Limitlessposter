import type { Task, TaskFrontmatter, Tier } from '../types.js'

export interface SelectContext {
  /** Stations whose `requires` are satisfied right now. */
  available: Set<string>
  allowedTiers: Set<Tier>
  running: Map<string, Task>
  maxParallel: number
}

/** A frontmatter change the scheduler applies via `TaskRepo.update`. */
export interface PatchRow {
  id: string
  patch: Partial<TaskFrontmatter>
  log: string
}

const byDue = (a: string | null, b: string | null): number => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Pick the tasks to start now (spec §5.1 step 5): `todo`, station available,
 * tier allowed, not running; ordered by priority ↑, due ↑ (null last), created ↑;
 * at most `maxParallel − running` and at most one premium in flight.
 */
export function selectRunnable(tasks: Task[], ctx: SelectContext): Task[] {
  const slots = ctx.maxParallel - ctx.running.size
  if (slots <= 0) return []
  let premiumInFlight = [...ctx.running.values()].some((t) => t.fm.tier === 'premium')

  const candidates = tasks
    .filter(
      (t) =>
        t.fm.status === 'todo' &&
        t.fm.station !== 'manual' &&
        ctx.available.has(t.fm.station) &&
        ctx.allowedTiers.has(t.fm.tier) &&
        !ctx.running.has(t.fm.id),
    )
    .sort(
      (a, b) =>
        (Number(a.fm.priority) || 3) - (Number(b.fm.priority) || 3) ||
        byDue(a.fm.due ?? null, b.fm.due ?? null) ||
        str(a.fm.created).localeCompare(str(b.fm.created)),
    )

  const picked: Task[] = []
  for (const t of candidates) {
    if (picked.length >= slots) break
    if (t.fm.tier === 'premium') {
      if (premiumInFlight) continue
      premiumInFlight = true
    }
    picked.push(t)
  }
  return picked
}

/**
 * Julius' approvals (spec §4.2): a `review` task whose `needs_approval` was
 * cleared (world button or frontmatter edit) goes back to `todo` for the
 * publishing run. A task moved to `todo` with `needs_approval` still set is
 * NOT approved – that is how a reviewer or Julius sends a draft back, and it
 * simply re-runs as a draft.
 */
export function normalizeApprovals(tasks: Task[]): PatchRow[] {
  const rows: PatchRow[] = []
  for (const t of tasks) {
    if (t.fm.status === 'review' && !t.fm.needs_approval) {
      rows.push({ id: t.fm.id, patch: { status: 'todo' }, log: 'Freigabe durch Julius' })
    }
  }
  return rows
}

/** `doing` notes with no live worker (crash/restart) go back to the queue (spec §4.3). */
export function recoverOrphans(tasks: Task[], runningIds: Set<string>): PatchRow[] {
  return tasks
    .filter((t) => t.fm.status === 'doing' && !runningIds.has(t.fm.id))
    .map((t) => ({
      id: t.fm.id,
      patch: { status: 'todo' as const, started: null },
      log: 'Lauf nicht mehr aktiv – zurück in Warteschlange',
    }))
}
