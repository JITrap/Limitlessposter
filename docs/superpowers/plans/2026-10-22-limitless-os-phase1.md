# Limitless OS – Phase 1 (Kern) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the always-on local supervisor, the Obsidian vault template, the live "Welt" view, the six core stations and the Windows installer so Limitless OS can run unattended on Julius' PC under his Claude Max subscription.

**Architecture:** A Node/TypeScript supervisor (`supervisor/`) treats the Obsidian folder `<Vault>/LimitlessOS/` as its database (one Markdown note per task, state in frontmatter), picks runnable tasks under a budget pacer, spawns `claude -p` workers with a station skill, parses the `stream-json` output, writes results back, and serves a localhost dashboard. Stations are declarative folders (`stations/<name>/station.yaml + SKILL.md`) from which the `.claude/skills` and `.claude/agents` files are generated. Adapters (Shopify GraphQL, Playwright studio renderer) are small CLIs the workers call via Bash.

**Tech Stack:** Node ≥ 22 (ESM, TypeScript 5, `tsx` for dev, `tsc` for build), `yaml@^2.9`, `chokidar@^6`, `vitest@^5`, `playwright@^1.64` (Chromium), `ffmpeg` (external), Node built-in `http`/`fetch`/`process.loadEnvFile`. No Express, no dotenv, no front-end build step.

**Spec:** `docs/superpowers/specs/2026-10-22-limitless-os-design.md`

## Global Constraints

- Node ≥ 22; code must run on Windows 11 (use `path.join`, spawn `claude.exe`/`claude.cmd` via `shell: false` with resolved binary; never assume `/`).
- Never pass `--bare` to `claude`; always `--permission-mode auto --permission-prompts none --output-format stream-json --verbose --no-session-persistence` (spec 5.2).
- Vault writes are atomic (temp file in same dir + `rename`) and merge-based (spec 4.3).
- Frontmatter: flat keys, lowercase, dates `YYYY-MM-DD`, datetimes `YYYY-MM-DDTHH:mm:ss`, numbers unquoted, empty values rendered as `key:` (spec 4.1).
- Week reset: Thursday 18:00 local machine time (`Europe/Berlin` on the PC); tests run with `TZ=Europe/Berlin` (spec 6.1).
- Tiers → models → per-run budget: `cheap→haiku→0.30`, `standard→sonnet→1.50`, `premium→opus→6.00` with `--fallback-model sonnet` only for premium (spec 6.4).
- Default limits: `max_parallel: 2` (max 1 premium), `reserve_for_julius: 30`, `daily_post_limit: 3`, `daily_shop_change_limit: 5`, max 15 open planner tasks (spec 6.3, 8, 11).
- Secrets only in `.env` (gitignored); never written into vault notes or logs (spec 11).
- All user-facing text in vault template, station SKILL.md files, Status.md, world page and README is **German**; code identifiers, comments and commit messages are English.
- Workers may only write under `LimitlessOS/**`; the supervisor is the only writer of frontmatter fields `status, started, completed, attempts, cost_usd, tokens_in, tokens_out, model_used, updated` (spec 11).

## Review Focus

1. A task note hand-edited by Julius in Obsidian while a worker runs it: the supervisor's merge must keep his body edits and only touch its own fields — test in Task 3 (`update() preserves unknown frontmatter keys and untouched body sections`).
2. A `claude -p` run killed by the 5-hour limit mid-stream (`rate_limit_event status: rejected` then process exit without `result`): the task must return to `todo` with `attempts` unchanged and the guard must pause until `resets_at` — tests in Task 7 (stream without result) and Task 9 (runner returns `ok:false, reason:'rate_limited'`).
3. Frontmatter containing German umlauts and a title with a colon/quotes: must round-trip without YAML corruption — test in Task 2.
4. Clock skew / machine asleep across the Thursday 18:00 reset: `weekStart` must be the most recent Thursday 18:00 even when `now` is exactly 18:00 or 17:59:59 — tests in Task 4.
5. `.env` missing entirely or containing `ANTHROPIC_API_KEY`: preflight must refuse to start workers with a German reason in Status.md rather than silently billing the API — tests in Task 13.

---

## File Structure

```
limitlessposter/
  package.json                      root scripts delegate to supervisor/ (npm -w not needed: single package in supervisor/)
  .gitignore, .env.example, limitless.config.json, .mcp.json
  .claude/CLAUDE.md, .claude/settings.json, .claude/skills/ (generated), .claude/agents/ (generated)
  supervisor/
    package.json, tsconfig.json, vitest.config.ts
    src/
      index.ts                      entry: load config → preflight → Supervisor.start()
      config.ts                     Config type, loadConfig(repoRoot)
      types.ts                      Tier, TaskStatus, TaskFrontmatter, Task, Station, RunSummary, StreamEvent, Decision
      vault/frontmatter.ts          parseNote/stringifyNote/section helpers
      vault/atomic.ts               writeFileAtomic
      vault/tasks.ts                TaskRepo (list/get/create/update/archiveOld), makeTaskId, slugify
      budget/windows.ts             weekStart/nextWeekReset/sessionWindow
      budget/models.ts              modelForTier, familyOf, budgetUsdForTier
      budget/ledger.ts              Ledger (jsonl append, sums)
      budget/guard.ts               BudgetGuard (observe events, learn capacity, decide)
      runner/stream.ts              parseStreamLine, summarizeResult
      runner/claude.ts              buildArgs, resolveClaudeBin, runWorker
      stations/loader.ts            loadStations, checkAvailability
      stations/generate.ts          generateClaudeFiles
      queue/select.ts               selectRunnable, normalizeApprovals, recoverOrphans
      status/writer.ts              renderStatusMd, writeStatus
      world/server.ts               startWorld (http + SSE + approve/pause)
      world/public/index.html       die Welt (inline CSS/JS, no deps)
      scheduler.ts                  Supervisor class: tick loop, triggers, counters, inbox
      preflight.ts                  preflight(cfg)
      adapters/shopify.ts           CLI: products | orders | update-product
      adapters/studio.ts            CLI: render-image | render-clip
    test/                           *.test.ts mirrors src/; fixtures/stream/*.jsonl; fixtures/fake-claude.mjs
  stations/<name>/station.yaml, SKILL.md, examples/*.md, templates/ (studio)
  vault-template/LimitlessOS/...    copied by install.ps1
  scripts/install.ps1, doctor.ps1, build-stations.ts
  docs/anleitung/ (German how-tos: shopify-app.md, metricool-mcp.md, erste-schritte.md)
```

---

### Task 1: Repository scaffold and toolchain

**Files:**
- Create: `package.json` (root), `supervisor/package.json`, `supervisor/tsconfig.json`, `supervisor/vitest.config.ts`, `.gitignore`, `.env.example`, `limitless.config.json`, `.mcp.json`, `supervisor/src/types.ts`, `supervisor/test/smoke.test.ts`
- Modify: `README.md`

**Interfaces:**
- Produces: `supervisor/src/types.ts` exporting
  `type Tier = 'cheap'|'standard'|'premium'`,
  `type TaskStatus = 'todo'|'doing'|'review'|'blocked'|'done'|'cancelled'`,
  `interface TaskFrontmatter { type:'task'; id:string; title:string; status:TaskStatus; station:string; priority:1|2|3|4; tier:Tier; due:string|null; created:string; updated:string; started:string|null; completed:string|null; attempts:number; max_attempts:number; cost_usd:number; tokens_in:number; tokens_out:number; model_used:string|null; outputs:string[]; needs_approval:boolean; origin:'planer'|'julius'|'inbox'|'system'; parent:string|null; published_at:string|null; tags:string[] }`,
  `interface Task { fm: TaskFrontmatter; body: string; path: string }`,
  `type ModelFamily = 'opus'|'sonnet'|'haiku'|'other'`.
- Produces: root `npm test` → `vitest run` in `supervisor/`; `npm run build` → `tsc -p supervisor`; `npm run dev` → `tsx supervisor/src/index.ts`; `npm run build:stations` → `tsx scripts/build-stations.ts`.

- [ ] **Step 1: Write the smoke test**

```ts
// supervisor/test/smoke.test.ts
import { describe, it, expect } from 'vitest'
describe('toolchain', () => {
  it('runs with Europe/Berlin timezone', () => {
    expect(process.env.TZ).toBe('Europe/Berlin')
    expect(new Date('2026-10-22T18:00:00').getHours()).toBe(18)
  })
})
```

- [ ] **Step 2: Create `supervisor/package.json`** (`"type":"module"`, deps `yaml@^2.9.1`, `chokidar@^6.0.0`, `playwright@^1.64.1`; devDeps `typescript@^5`, `tsx`, `vitest@^5.0.5`, `@types/node@^22`), `tsconfig.json` (`module: NodeNext`, `target: ES2022`, `strict`, `outDir: dist`, `rootDir: src`), `vitest.config.ts` with `setupFiles` that sets `process.env.TZ = 'Europe/Berlin'` **before** any Date use (vitest `env: { TZ: 'Europe/Berlin' }` is not enough on Windows — set it in `globalSetup` too).

- [ ] **Step 3: Create root files**: `package.json` scripts delegating with `npm --prefix supervisor run …`; `.gitignore` (`.env`, `supervisor/data/`, `supervisor/dist/`, `node_modules/`, `.claude/skills/`, `.claude/agents/`, `*.log`); `.env.example` with commented empty keys `SHOPIFY_STORE_DOMAIN=`, `SHOPIFY_CLIENT_ID=`, `SHOPIFY_CLIENT_SECRET=`, `METRICOOL_USER_TOKEN=`, `METRICOOL_USER_ID=`, `METRICOOL_BLOG_ID=`, `COMFYUI_URL=http://127.0.0.1:8188`, `VOICESTUDIO_URL=http://127.0.0.1:3900`, `LIMITLESS_USAGE_PROBE=0`; `limitless.config.json`:

```json
{
  "vaultRoot": "",
  "maxParallel": 2,
  "reserveForJuliusPct": 30,
  "weekReset": { "weekday": 4, "hour": 18, "minute": 0 },
  "dailyPostLimit": 3,
  "dailyShopChangeLimit": 5,
  "maxOpenPlannerTasks": 15,
  "worldPort": 4242,
  "tickSeconds": 30,
  "tiers": {
    "cheap":    { "model": "haiku",  "maxBudgetUsd": 0.30 },
    "standard": { "model": "sonnet", "maxBudgetUsd": 1.50 },
    "premium":  { "model": "opus",   "maxBudgetUsd": 6.00, "fallbackModel": "sonnet" }
  },
  "budget": {
    "initialWeeklyCapacityUsd": { "opus": 300, "sonnet": 600, "haiku": 200 },
    "sessionFraction": 0.1
  }
}
```
and `.mcp.json`: `{"mcpServers":{"metricool":{"type":"http","url":"https://ai.metricool.com/mcp"}}}`.

- [ ] **Step 4: Install and run** `npm install` (in `supervisor/`), then `npm test`. Expected: 1 test PASS.

- [ ] **Step 5: Commit** `chore: scaffold supervisor toolchain and config`

---

### Task 2: Frontmatter and section helpers

**Files:**
- Create: `supervisor/src/vault/frontmatter.ts`, `supervisor/src/vault/atomic.ts`
- Test: `supervisor/test/vault/frontmatter.test.ts`, `supervisor/test/vault/atomic.test.ts`

**Interfaces:**
- Produces: `parseNote(text: string): { data: Record<string, unknown>; body: string }` (no frontmatter → `data: {}`), `stringifyNote(data: Record<string, unknown>, body: string): string`, `readSection(body: string, heading: string): string | null` (content between `## <heading>` and next `## `), `upsertSection(body: string, heading: string, content: string): string` (appends section at end if missing), `appendLine(body: string, heading: string, line: string): string`, `const SECTIONS = ['Auftrag','Kontext','Ergebnis','Protokoll','Offene Fragen an Julius'] as const`, `writeFileAtomic(filePath: string, text: string): Promise<void>`.

- [ ] **Step 1: Write failing tests**

```ts
it('round-trips umlauts, colons and quotes', () => {
  const data = { type:'task', title:'Karussell: „Ein Poster, 5 Räume“ für Instagram', due:'2026-10-25', completed:null, outputs:[], priority:2 }
  const out = stringifyNote(data, '## Auftrag\nText\n')
  expect(out).toContain('completed:\n')           // empty, not "null"
  expect(out).toContain('due: 2026-10-25')        // unquoted date string
  expect(parseNote(out).data).toEqual(data)
})
it('readSection/upsertSection/appendLine', () => {
  const body = '## Auftrag\nA\n\n## Protokoll\n- x\n'
  expect(readSection(body,'Auftrag')).toBe('A')
  expect(readSection(body,'Ergebnis')).toBeNull()
  expect(upsertSection(body,'Ergebnis','E')).toMatch(/## Ergebnis\nE\n$/)
  expect(appendLine(body,'Protokoll','- y')).toContain('- x\n- y\n')
})
it('writeFileAtomic leaves no temp file and replaces content', ...)
```

- [ ] **Step 2: Run tests → FAIL** (`Cannot find module`).

- [ ] **Step 3: Implement** with `yaml` `stringify(data, { nullStr: '', lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' })` and `parse` (YAML 1.2 core schema keeps `2026-10-25` a string). `parseNote` splits on the first `---\n…\n---\n` only at file start. `writeFileAtomic` writes `<name>.tmp-<pid>-<rand>` in the same directory then `fs.rename`.

- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit** `feat(vault): frontmatter and section helpers with atomic writes`

---

### Task 3: TaskRepo

**Files:**
- Create: `supervisor/src/vault/tasks.ts`
- Test: `supervisor/test/vault/tasks.test.ts` (uses `fs.mkdtemp` vault)

**Interfaces:**
- Consumes: Task 2 helpers, `types.ts`.
- Produces: `slugify(s: string): string` (ä→ae, ö→oe, ü→ue, ß→ss, lowercase, `[^a-z0-9]+`→`-`, trim `-`, max 40), `makeTaskId(now: Date, title: string): string` → `YYYYMMDD-HHmmss-<slug>`, `nowStamp(d: Date): string` → `YYYY-MM-DDTHH:mm:ss` local, `todayStamp(d): string`,
  `interface NewTask { title; station; tier; priority; due?: string|null; origin; auftrag: string; kontext?: string; needs_approval?: boolean; parent?: string|null; tags?: string[] }`,
  `class TaskRepo { constructor(vaultRoot: string, clock: () => Date = () => new Date()); list(): Promise<Task[]>; get(id): Promise<Task|null>; create(input: NewTask): Promise<Task>; update(id, patch: Partial<TaskFrontmatter>, opts?: { log?: string; section?: { heading: string; content: string } }): Promise<Task>; archiveOld(days: number): Promise<string[]> }`.
  Paths: tasks in `<vaultRoot>/Aufgaben/<id>.md`, archive to `<vaultRoot>/Archiv/<id>.md`. Protocol line format: `- ${YYYY-MM-DD HH:mm} ${status} · ${model_used ?? '-'} · ${log}`.

- [ ] **Step 1: Write failing tests**

```ts
it('create writes full schema with defaults', async () => {
  const t = await repo.create({ title:'Test Ö', station:'content', tier:'standard', priority:2, origin:'planer', auftrag:'Mach X' })
  expect(t.fm.id).toMatch(/^20261022-093000-test-oe$/)
  expect(t.fm).toMatchObject({ status:'todo', attempts:0, max_attempts:3, cost_usd:0, needs_approval:false, tags:['task'] })
  expect(readSection(t.body,'Auftrag')).toBe('Mach X')
  for (const h of SECTIONS) expect(t.body).toContain(`## ${h}`)
})
it('update preserves unknown frontmatter keys and untouched body sections', async () => {
  // hand-edit the file: add `meine_notiz: hallo` and text under Kontext, then update status
  ... expect(parseNote(text).data.meine_notiz).toBe('hallo'); expect(readSection(body,'Kontext')).toBe('Julius war hier')
  expect(readSection(body,'Protokoll')).toMatch(/doing · - · Lauf 1/)
  expect(fm.updated).toBe('2026-10-22T09:31:00')
})
it('list ignores non-task notes and sorts by created', ...)
it('archiveOld moves done tasks completed > 30 days ago', ...)
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `update` re-reads the file, shallow-merges patch into `data`, sets `updated`, applies `section`/`log`, writes atomically. `list` skips files whose `data.type !== 'task'`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(vault): TaskRepo with merge-safe updates and archive`

---

### Task 4: Budget windows

**Files:**
- Create: `supervisor/src/budget/windows.ts`
- Test: `supervisor/test/budget/windows.test.ts`

**Interfaces:**
- Produces: `interface WeekReset { weekday: number /*0=Sun*/; hour: number; minute: number }`, `weekStart(now: Date, r: WeekReset): Date` (most recent reset instant ≤ now), `nextWeekReset(now, r): Date`, `weekFraction(now, r): number` (0..1 elapsed), `sessionStartFor(firstRunAt: Date, now: Date): Date` (5-h windows anchored at `firstRunAt`, returns start of the window containing `now`), `isNight(now): boolean` (00:00–06:59).

- [ ] **Step 1: Tests** with `r = {weekday:4,hour:18,minute:0}`:
  `weekStart(2026-10-22T18:00:00)` → `2026-10-22T18:00:00` (Thursday, exact instant); `weekStart(2026-10-22T17:59:59)` → `2026-10-15T18:00:00`; `nextWeekReset(2026-10-26T12:00)` → `2026-10-29T18:00`; `weekFraction` at `2026-10-26T06:00` ≈ 0.5 (±0.001); `sessionStartFor(10:00, 16:30)` → `15:00`; `isNight(03:00)` true, `isNight(07:00)` false.
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** with local-time `Date` arithmetic (no libraries). **Step 4: Run → PASS.** **Step 5: Commit** `feat(budget): week/session window math`

---

### Task 5: Models and ledger

**Files:**
- Create: `supervisor/src/budget/models.ts`, `supervisor/src/budget/ledger.ts`
- Test: `supervisor/test/budget/models.test.ts`, `supervisor/test/budget/ledger.test.ts`

**Interfaces:**
- Produces: `familyOf(modelId: string): ModelFamily` (`/opus/`→opus, `/sonnet/`→sonnet, `/haiku/`→haiku, else other), `modelForTier(tier, cfg): { model: string; maxBudgetUsd: number; fallbackModel?: string }`,
  `interface LedgerEntry { ts: string; task: string; station: string; model: string; family: ModelFamily; tokens_in: number; tokens_out: number; cache_read: number; cache_write: number; cost_usd: number; duration_ms: number; result: string }`,
  `class Ledger { constructor(filePath: string); append(e: LedgerEntry): Promise<void>; load(): Promise<LedgerEntry[]>; sumCostSince(since: Date, family?: ModelFamily): Promise<number>; countSince(since: Date, pred?: (e)=>boolean): Promise<number> }`.

- [ ] **Step 1: Tests**: `familyOf('claude-opus-5-5')==='opus'`; `modelForTier('premium', cfg)` → `{model:'opus', maxBudgetUsd:6, fallbackModel:'sonnet'}`; ledger append twice → `load().length===2`; `sumCostSince` filters by ts and family; corrupt line is skipped (not thrown).
- [ ] **Step 2–5:** FAIL → implement (jsonl, `fs.appendFile`) → PASS → commit `feat(budget): model mapping and jsonl ledger`.

---

### Task 6: BudgetGuard

**Files:**
- Create: `supervisor/src/budget/guard.ts`
- Test: `supervisor/test/budget/guard.test.ts`

**Interfaces:**
- Consumes: `Ledger`, windows, `familyOf`.
- Produces:
  `interface RateLimitSignal { family: ModelFamily|'all'; window: 'five_hour'|'seven_day'|'unknown'; status: 'allowed'|'allowed_warning'|'rejected'; resetsAt: Date|null }`,
  `interface Decision { mode: 'normal'|'cheap-only'|'paused'; allowedTiers: Set<Tier>; reason: string /*German*/; until: Date|null; usage: { week: Record<ModelFamily, {used:number; target:number; capacity:number}>; session: {used:number; capacity:number} } }`,
  `interface GuardState { learned: Partial<Record<ModelFamily, { weeklyUsd: number; sessionUsd: number }>>; pausedUntil: string|null; sessionAnchor: string|null }`,
  `class BudgetGuard { constructor(ledger: Ledger, cfg: Config, stateFile: string, clock?: () => Date); load(): Promise<void>; observe(sig: RateLimitSignal): Promise<void>; noteRunStart(): void; decide(): Promise<Decision> }`.

Rules (spec 6.3): capacity per family = learned.weeklyUsd ?? `cfg.budget.initialWeeklyCapacityUsd[family]`; `target = capacity × (1 − reserve/100) × weekFraction`; ratio = used/target (target floor 1e-6): `>1.2` → paused until the ratio would fall to 1.0 (compute time t where target(t)=used), `>1.1` → cheap-only, `<0.8` → premium allowed even at night; session capacity = `capacity × sessionFraction`; session used ≥ 0.85 → paused until session window end, ≥ 0.70 → cheap-only; `isNight` removes premium unless ratio < 0.8; `observe(rejected)` → `pausedUntil = resetsAt ?? now+30min` and learn `weeklyUsd/sessionUsd = used-so-far` (EMA α=0.5 with previous); `observe(allowed_warning)` → cheap-only until window end; `reason` strings are German, e.g. `'Wochenbudget über Soll (112 %) – nur günstige Aufgaben'`.

- [ ] **Step 1: Tests** (inject clock and a temp ledger):
  - fresh guard at Fri 12:00, no usage → `mode:'normal'`, all tiers.
  - usage sonnet 200 USD at week fraction 0.25 with capacity 600, reserve 30 → target 105 → ratio 1.9 → `paused`, `until` > now.
  - usage 50 at same point → ratio 0.48 → premium allowed at 03:00 (night) too.
  - `observe({status:'rejected', window:'five_hour', resetsAt: now+1h})` → `paused`, `until` = resetsAt; `learned.session` set.
  - `observe({status:'allowed_warning'})` → `cheap-only`.
  - state persists across `new BudgetGuard(...).load()`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(budget): pacing guard with learned capacity`.

---

### Task 7: Stream parser and result summary

**Files:**
- Create: `supervisor/src/runner/stream.ts`, fixtures `supervisor/test/fixtures/stream/{success,max_turns,budget,rate_limited_no_result,permission_denied}.jsonl`
- Test: `supervisor/test/runner/stream.test.ts`

**Interfaces:**
- Produces: `type StreamEvent = { kind:'init'; mcpErrors: string[] } | { kind:'rate_limit'; signal: RateLimitSignal } | { kind:'api_retry'; error: string } | { kind:'permission_denied'; tool: string } | { kind:'result'; raw: Record<string,unknown> } | { kind:'other' }`, `parseStreamLine(line: string): StreamEvent|null` (invalid JSON → null),
  `interface RunSummary { ok: boolean; reason: 'success'|'max_turns'|'max_budget'|'error'|'rate_limited'|'timeout'|'no_result'|'auth'; subtype: string|null; isError: boolean; apiErrorStatus: number|null; costUsd: number; tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; modelUsed: string|null; resultText: string; permissionDenials: string[]; sessionId: string|null; durationMs: number }`,
  `summarizeResult(result: Record<string,unknown>|null, seen: { rateLimited: boolean; denials: string[] }): RunSummary`.

Fixture shapes (write them from the spec's verified fields): `{"type":"system","subtype":"init","mcp_servers":[...],"mcp_server_errors":[]}`; `{"type":"rate_limit_event","rate_limit_type":"five_hour","status":"rejected","resets_at":1761152400}`; `{"type":"system","subtype":"api_retry","error":"rate_limit"}`; `{"type":"system","subtype":"permission_denied","tool_name":"Bash"}`; result: `{"type":"result","subtype":"success","is_error":false,"session_id":"…","duration_ms":61000,"num_turns":9,"result":"…","total_cost_usd":0.0612,"modelUsage":{"claude-sonnet-5-5":{"inputTokens":12000,"outputTokens":2200,"cacheReadInputTokens":8000,"cacheCreationInputTokens":1000,"costUSD":0.0612}},"permission_denials":[]}`. Parser must accept `resets_at` as epoch seconds **or** ISO string, and treat unknown `rate_limit_type` as `'unknown'`.

- [ ] **Step 1: Tests**: parse each fixture file line by line; assertions: success → `ok, costUsd 0.0612, tokensIn 12000 (+cache counted separately), modelUsed 'claude-sonnet-5-5'`; `error_max_turns` → `reason 'max_turns'`; `error_max_budget_usd` → `'max_budget'`; rate-limited fixture (no result line) → `summarizeResult(null,{rateLimited:true,…})` → `reason 'rate_limited', ok false`; permission fixture → `permissionDenials ['Bash']`; `modelUsage` with two models → `modelUsed` = model with highest costUSD, cost summed.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(runner): stream-json parser and run summary`.

---

### Task 8: Stations loader, availability and generator

**Files:**
- Create: `supervisor/src/stations/loader.ts`, `supervisor/src/stations/generate.ts`, `scripts/build-stations.ts`
- Test: `supervisor/test/stations/loader.test.ts`, `supervisor/test/stations/generate.test.ts` (temp `stations/` dir)

**Interfaces:**
- Produces: `interface Station { name; display; description; tier: Tier; maxTurns: number /*default 40*/; timeoutMin: number /*25*/; tools: string[]; context: string[]; requires: { mcp: string[]; env: string[]; services: string[] }; autopilot: 0|1|2; cooldownHours: number; outputsDir: string|null; dir: string; skillPath: string }`, `loadStations(repoRoot): Promise<Station[]>` (validates required keys, throws German error naming the file and key),
  `interface Availability { available: boolean; reason: string|null }`, `checkAvailability(st: Station, env: Record<string,string|undefined>, probes: { http: (url: string) => Promise<boolean>; mcpConfigured: (name: string) => Promise<boolean> }): Promise<Availability>` (reason German: `'Umgebungsvariable SHOPIFY_CLIENT_ID fehlt'`, `'Dienst http://127.0.0.1:8188 nicht erreichbar'`, `'MCP-Server metricool nicht eingerichtet'`),
  `generateClaudeFiles(stations: Station[], repoRoot): Promise<string[]>` writing `.claude/skills/<name>/SKILL.md` (frontmatter `name`, `description`, `allowed-tools: <tools joined ', '>`, then SKILL.md body verbatim) and `.claude/agents/<name>.md` (frontmatter `name`, `description`, `model: <haiku|sonnet|opus by tier>`, `tools: <comma list>`, `maxTurns`; body = "Lies und befolge die Skill-Datei …"). Also `station: manual` is never loaded as a Station (no folder) – the scheduler treats the name specially.

- [ ] **Step 1: Tests**: loader reads a minimal yaml and applies defaults; missing `tier` throws `/station.yaml.*tier/`; availability false with each reason; generator produces both files with expected frontmatter and refuses to run if `.claude/skills/<name>/SKILL.md` lacks the marker line `<!-- generated from stations/<name> – nicht von Hand ändern -->` (i.e. it only overwrites files it generated).
- [ ] **Step 2–5:** FAIL → implement (yaml parse; `scripts/build-stations.ts` = CLI wrapper printing written paths) → PASS → commit `feat(stations): loader, availability probes and skill/agent generator`.

---

### Task 9: Runner (spawn `claude -p`)

**Files:**
- Create: `supervisor/src/runner/claude.ts`, `supervisor/test/fixtures/fake-claude.mjs`
- Test: `supervisor/test/runner/claude.test.ts`

**Interfaces:**
- Consumes: Task 7 parser, Task 8 `Station`, `modelForTier`.
- Produces: `resolveClaudeBin(env): string` (env `LIMITLESS_CLAUDE_BIN` → else `claude.exe`/`claude.cmd` on win32 → else `claude`), `buildPrompt(task: Task, opts: { publishAllowed: boolean; vaultRoot: string; statusPath: string }): string` (German: names the note path, tells the worker to write sections *Ergebnis*/*Offene Fragen an Julius* in that note, states `Veröffentlichen heute erlaubt: ja|nein` and `Freigabe nötig: ja|nein`), `buildArgs(task, station, cfg, opts): string[]` exactly: `['-p', prompt, '--output-format','stream-json','--verbose','--permission-mode','auto','--permission-prompts','none','--model',model,'--max-turns',String(st.maxTurns),'--max-budget-usd',String(budget),'--append-system-prompt-file',st.skillPath,'--add-dir',cfg.vaultRoot,'--no-session-persistence', ...(fallback? ['--fallback-model',fallback]:[]), ...(tools.length? ['--allowedTools', ...tools]:[])]`,
  `runWorker(task, station, cfg, hooks: { onEvent: (e: StreamEvent)=>void; onLine?: (l: string)=>void }, opts: { timeoutMs: number; cwd: string; env: NodeJS.ProcessEnv }): Promise<RunSummary>`; on timeout send `SIGINT`, after 30 s `SIGTERM`, `reason:'timeout'`; raw stream saved to `supervisor/data/runs/<task-id>-<ts>.jsonl`.
- `fake-claude.mjs`: reads env `FAKE_CLAUDE_FIXTURE` (path) and prints its lines with 10 ms delay; if `FAKE_CLAUDE_HANG=1` prints init then sleeps forever; exits 0 unless fixture name contains `error`.

- [ ] **Step 1: Tests** (set `LIMITLESS_CLAUDE_BIN` to `node` and prepend `fake-claude.mjs` via `LIMITLESS_CLAUDE_PREARGS`; add that env to `resolveClaudeBin`/spawn): success fixture → `ok true`, `onEvent` saw `init` and `result`; rate-limited fixture → `reason 'rate_limited'`; hang → `reason 'timeout'` within `timeoutMs 500` and process is dead; `buildArgs` snapshot equals the exact array above for a `standard` content task.
- [ ] **Step 2–5:** FAIL → implement (`child_process.spawn`, `readline` on stdout, `windowsHide: true`) → PASS → commit `feat(runner): spawn claude -p workers with timeout and stream capture`.

---

### Task 10: Queue selection, approvals, orphan recovery

**Files:**
- Create: `supervisor/src/queue/select.ts`
- Test: `supervisor/test/queue/select.test.ts`

**Interfaces:**
- Produces: `selectRunnable(tasks: Task[], ctx: { available: Set<string>; allowedTiers: Set<Tier>; running: Map<string, Task>; maxParallel: number }): Task[]` (filters `status==='todo'`, `station!=='manual'`, available, tier allowed, not running; sorts `priority ↑, due ↑ (null last), created ↑`; slots = `maxParallel − running.size`; at most one `premium` among running+selected), `normalizeApprovals(tasks): { id: string; patch: Partial<TaskFrontmatter>; log: string }[]` (review+`needs_approval:false` → `status:'todo'`, log `'Freigabe durch Julius'`; todo+`needs_approval:true` → `needs_approval:false`), `recoverOrphans(tasks, runningIds: Set<string>): {id; patch; log}[]` (`doing` not running → `status:'todo'`, `started:null`, log `'Lauf nicht mehr aktiv – zurück in Warteschlange'`).

- [ ] **Step 1: Tests** covering each rule incl. premium cap and null-due ordering. **Step 2–5:** FAIL → implement (pure functions) → PASS → commit `feat(queue): selection, approval normalization, orphan recovery`.

---

### Task 11: Status.md writer

**Files:**
- Create: `supervisor/src/status/writer.ts`
- Test: `supervisor/test/status/writer.test.ts`

**Interfaces:**
- Produces: `interface SupervisorState { now: string; health: { ok: boolean; problems: string[] }; paused: { active: boolean; reason: string|null; until: string|null }; decision: Decision|null; workers: { taskId: string; title: string; station: string; model: string; startedAt: string; tokens: number }[]; counts: Record<TaskStatus, number>; stations: { name: string; display: string; available: boolean; reason: string|null; autopilot: number }[]; today: { posts: number; postLimit: number; shopChanges: number; shopLimit: number }; nextWeekReset: string; waiting: { id: string; title: string; station: string }[]; ticker: string[] }`, `renderStatusMd(s: SupervisorState): string`, `writeStatus(vaultRoot, s): Promise<void>` (atomic to `Status.md`).

Status.md layout (German): frontmatter `type: status`, `updated`; sections `## Budget` (one line per family: `Sonnet: 38 % der Woche (Soll 41 %) · Session 12 %` and a 20-char bar `█████░░░░░░░░░░░░░░░`), `## Arbeiter`, `## Aufgaben` (counts), `## Stationen` (✅/⛔ + reason), `## Heute` (posts/shop changes), `## Nächster Wochen-Reset`, `## Wartet auf dich`, `## Ticker` (last 20).

- [ ] **Step 1: Tests**: snapshot-free assertions on key lines (bar length 20, ⛔ line contains reason, `Wartet auf dich` lists wikilinks `[[Aufgaben/<id>|<title>]]`). **Step 2–5:** FAIL → implement → PASS → commit `feat(status): render Status.md`.

---

### Task 12: Die Welt (HTTP + SSE + page)

**Files:**
- Create: `supervisor/src/world/server.ts`, `supervisor/src/world/public/index.html`
- Test: `supervisor/test/world/server.test.ts`

**Interfaces:**
- Produces: `startWorld(opts: { port: number; host?: '127.0.0.1'; getState: () => SupervisorState; actions: { approve: (id: string) => Promise<void>; pause: () => Promise<void>; resume: () => Promise<void> }; publicDir: string }): Promise<{ close(): Promise<void>; broadcast(ev: { type: string; data: unknown }): void }>`. Routes: `GET /` → index.html; `GET /api/state` → JSON; `GET /events` → SSE (`event: state` on connect and on every `broadcast`, heartbeat comment every 15 s); `POST /api/approve/:id`, `POST /api/pause`, `POST /api/resume` → `{ok:true}`; anything else 404. Binds 127.0.0.1 only.
- `index.html` (German, inline CSS/JS, no external assets): rooms grid from `state.stations` (grey when unavailable with reason tooltip), worker figures from `state.workers` (CSS keyframe "typing" animation, label `Station · Modell · Titel · min · Tokens`), wall board from `state.decision.usage` + `today` + `nextWeekReset` + pause reason, desk "Wartet auf dich" from `state.waiting` with buttons **Öffnen** (`obsidian://open?vault=<name>&file=LimitlessOS/Aufgaben/<id>` – vault name from `state.vaultName`, add that field) and **Freigeben** (POST approve), ticker list, **Pause/Weiter** button. Reconnects SSE on error.

- [ ] **Step 1: Tests**: start on port 0, `GET /api/state` returns state; `GET /events` receives `event: state` within 500 ms after `broadcast`; `POST /api/approve/abc` calls `actions.approve('abc')`; `GET /nope` → 404.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(world): localhost dashboard with SSE`.

---

### Task 13: Preflight

**Files:**
- Create: `supervisor/src/preflight.ts`
- Test: `supervisor/test/preflight.test.ts`

**Interfaces:**
- Produces: `interface PreflightResult { ok: boolean; problems: string[] /*German*/; warnings: string[]; claudeVersion: string|null; authMethod: string|null }`, `preflight(cfg: Config, deps: { exec: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string }>; env: NodeJS.ProcessEnv; fs: typeof import('node:fs/promises'); homeDir: string }): Promise<PreflightResult>`.
  Checks: `claude --version` parse `^(\d+)\.(\d+)\.(\d+)` ≥ 2.1.302 else problem `'Claude Code zu alt (…), bitte aktualisieren'`; `claude auth status` JSON `authMethod === 'claude.ai'` else problem `'Nicht mit dem Claude-Abo angemeldet – bitte `claude` starten und einloggen'`; `env.ANTHROPIC_API_KEY` set → problem `'ANTHROPIC_API_KEY ist gesetzt – würde API-Guthaben statt Abo verbrauchen'`; `<homeDir>/.claude.json` has `projects[<repoRoot>].hasTrustDialogAccepted === true` else problem `'Repo-Ordner ist für Claude nicht vertrauenswürdig – install.ps1 ausführen'`; `cfg.vaultRoot` exists and `Aufgaben/` creatable else problem; `.env` missing → warning `'Keine .env gefunden – nur Stationen ohne Schlüssel sind aktiv'`; `FAKE_CLAUDE` mode skips claude checks.

- [ ] **Step 1: Tests** with stubbed `exec`/`fs` for each problem and the all-green case. **Step 2–5:** FAIL → implement → PASS → commit `feat: preflight checks with German diagnostics`.

---

### Task 14: Scheduler (Supervisor loop) and entry point

**Files:**
- Create: `supervisor/src/scheduler.ts`, `supervisor/src/config.ts`, `supervisor/src/index.ts`
- Test: `supervisor/test/scheduler.test.ts` (temp vault, `FAKE_CLAUDE=1`, fake clock, fixtures)

**Interfaces:**
- Consumes: everything above.
- Produces: `loadConfig(repoRoot: string, env = process.env): Config` (`limitless.config.json` + `process.loadEnvFile('.env')` if present; `vaultRoot` must end with `LimitlessOS`; `fakeClaude = env.FAKE_CLAUDE === '1'`),
  `class Supervisor { constructor(cfg: Config, deps: { repo: TaskRepo; guard: BudgetGuard; ledger: Ledger; stations: Station[]; run: typeof runWorker; clock: () => Date; probes }); start(): Promise<void>; stop(): Promise<void>; tick(): Promise<void>; getState(): SupervisorState; approve(id): Promise<void>; pause(): Promise<void>; resume(): Promise<void> }`.
  `tick()` order (spec 5.1): health/availability (every 10 ticks) → inbox scan → `normalizeApprovals` → `recoverOrphans` → `guard.decide()` → `PAUSE` file check → trigger tasks (below) → `selectRunnable` → for each: `update(status:'doing', started, attempts+1)` then `run()` (not awaited; completion handler) → `writeStatus` + `broadcast` → `archiveOld(30)` once per day.
  Completion handler: `ok` → `status: station.autopilot===2 || !task.fm.needs_approval ? 'done' : 'review'` … precisely: if summary.ok and station.autopilot < 2 and task is outward-facing (station in `['content','shop-analyst']`) and `needs_approval` was true at start → `review`; else `done` with `completed`. Not ok: `rate_limited` → `todo`, `attempts−1` (undo), `guard.observe`; `timeout|max_turns|max_budget|error` → `attempts ≥ max_attempts ? 'blocked' : 'todo'`; blocked + reason needs human → create `manual` task `'Blockiert: <title>'` with the protocol excerpt. Always append ledger entry and protocol line `'<status> · <tokens> Tokens · <cost> $ · <reason>'`.
  Triggers (idempotent per day via `state.json` keys): planner when `open(non-manual) < 5` or no planner run in 2 h (title `'Planung: Warteschlange füllen'`, tier standard, priority 1); Wed 20:00 planner `'Wochenstrategie'` tier premium; daily 07:30 berichter `'Tagesbericht'` cheap; Thu 17:00 berichter `'Wochenbericht'` cheap. Daily counters: `today.posts` = tasks with `published_at` today; `today.shopChanges` read from `supervisor/data/counters.json` (written by the Shopify adapter); `publishAllowed = today.posts < dailyPostLimit`. Inbox: new files in `Inbox/` (not in `state.inboxSeen`) → planner task `'Inbox einordnen: <file>'` (standard, priority 2) with the file path in *Kontext*.
  `index.ts`: load config → preflight → if `!ok` write Status.md with problems, start world anyway (so Julius sees why), do not run workers → else `Supervisor.start()` + `startWorld` + chokidar on `Aufgaben/` and `Inbox/` (debounced 2 s → `tick()`), `SIGINT/SIGTERM` → graceful stop.

- [ ] **Step 1: Tests**: (a) full cycle: create a content task (needs_approval true) → `tick()` → status `doing` → wait → `review`, ledger has 1 entry, protocol has two lines; (b) approve via `approve(id)` → next tick `todo` → `done`; (c) `PAUSE` file present → nothing started; (d) rate-limited fixture → task back to `todo`, `attempts` 0, guard paused; (e) planner trigger created when queue empty and not twice within 2 h; (f) `maxParallel` respected; (g) inbox file → planner task once.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat: supervisor loop, triggers and entry point`.

---

### Task 15: Shopify adapter

**Files:**
- Create: `supervisor/src/adapters/shopify.ts`, `docs/anleitung/shopify-app.md`
- Test: `supervisor/test/adapters/shopify.test.ts` (mock `fetch`)

**Interfaces:**
- Produces: `getAccessToken(env, cache: { read(): Promise<{token;expiresAt}|null>; write(v): Promise<void> }, fetchImpl = fetch): Promise<string>` (POST `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token` form `grant_type=client_credentials&client_id&client_secret`; cache in `supervisor/data/shopify-token.json`; refresh when `expiresAt − now < 10 min`), `graphql<T>(query: string, variables: object, env, fetchImpl): Promise<T>` (POST `/admin/api/2026-10/graphql.json`, header `X-Shopify-Access-Token`; throws on `errors` or `throttleStatus.currentlyAvailable < 50` → waits `1000 ms` once then retries), CLI `node supervisor/dist/adapters/shopify.js <cmd>`:
  `products [--limit 50]` → JSON `[ {id, title, handle, status, descriptionHtml, totalInventory, priceRange, updatedAt} ]`;
  `orders --days 60` → `{ count, revenue, currency, byProduct: [{title, qty, revenue}], last: [...] }` (from `orders(query:"created_at:>=…")`, note Basic may limit to 60 days);
  `update-product <gid> --title "…" --description-html "…"` → requires `LIMITLESS_ALLOW_WRITES=1` else exits 2 with `'Schreiben nicht freigegeben (needs_approval)'`; on success increments `shopChanges` in `supervisor/data/counters.json` (`{date, shopChanges}`) and refuses when ≥ `dailyShopChangeLimit`.
- `docs/anleitung/shopify-app.md` (German): Dev Dashboard → App anlegen → Scopes `read_products, write_products, read_orders, read_customers, read_inventory, write_inventory, read_locations` → Version veröffentlichen → im Store installieren → Client-ID/-Secret in `.env`; store domain = `*.myshopify.com`.

- [ ] **Step 1: Tests**: token fetched once then cached; expired cache refreshes; `graphql` sets headers and throws German error on GraphQL `errors`; `update-product` without `LIMITLESS_ALLOW_WRITES` exits 2 (test the exported `main(argv, env)` function); counter increments and blocks at limit.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(adapters): Shopify client-credentials GraphQL CLI`.

---

### Task 16: Studio adapter (Playwright + ffmpeg)

**Files:**
- Create: `supervisor/src/adapters/studio.ts`, `stations/studio/templates/{mockup-room.html, carousel-slide.html, clip-zoom.html}`
- Test: `supervisor/test/adapters/studio.test.ts` (`describe.skipIf(!ffmpegAvailable || !chromiumAvailable)`)

**Interfaces:**
- Produces: `renderImage(opts: { template: string; data: Record<string,string>; width: number; height: number; out: string }): Promise<string>` (Playwright `chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined })`, `page.setContent(html, { waitUntil: 'load' })` with `{{key}}` substitution and `file://` base for `Assets/poster/*`), `renderClip(opts: { template; data; width; height; seconds: number; fps: number /*30*/; out: string }): Promise<string>` (per frame `page.evaluate(t => window.__setTime(t), t)` → PNG frames in temp dir → `ffmpeg -framerate <fps> -i frame-%04d.png -c:v libx264 -pix_fmt yuv420p -movflags +faststart <out>`), CLI `node …/studio.js render-image|render-clip --template <name> --data '<json>' --out <path> [--size 1080x1350] [--seconds 4]`.
- Templates: `mockup-room.html` (a room photo background div with CSS `--wall-color`, poster `<img src="{{poster}}">` positioned with perspective; all assets relative, placeholder gradient when no room photo), `carousel-slide.html` (1080×1350, `{{headline}}`, `{{sub}}`, `{{poster}}`, brand colors from CSS vars), `clip-zoom.html` (defines `window.__setTime(t)` that sets `transform: scale(1+0.08*t/seconds)` on the poster and fades in `{{headline}}`). No external fonts.

- [ ] **Step 1: Tests**: `renderImage` produces a PNG of exactly 1080×1350 (check IHDR bytes); `renderClip` with `seconds 1, fps 5` produces an MP4 > 1 KB; `{{poster}}` missing → still renders (placeholder) and returns path.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(adapters): studio renderer for mockups, slides and clips`.

---

### Task 17: Core stations (yaml + SKILL.md + examples) and worker rules

**Files:**
- Create: `stations/{planer,content,shop-analyst,studio,reviewer,berichter}/station.yaml`, `…/SKILL.md`, `…/examples/beispiel.md`; `.claude/CLAUDE.md`; `.claude/settings.json`
- Test: `supervisor/test/stations/real-stations.test.ts` (loads the real `stations/` dir)

**Interfaces:**
- Consumes: Task 8 loader/generator, adapters' CLIs (Task 15/16), `buildPrompt` contract (Task 9).
- Produces: six valid stations; `npm run build:stations` generates `.claude/skills/*` and `.claude/agents/*`.

Per-station decisions (all SKILL.md in German, ≤ 150 lines each, same outline: *Rolle · Eingaben (welche Notizen lesen) · Vorgehen · Ausgabeformat (welche Abschnitte der Aufgaben-Notiz füllen) · Qualitätsregeln · Verbote*):

| station | tier | autopilot | tools | context | requires |
|---|---|---|---|---|---|
| planer | standard | 2 | `Read, Write, Glob, Grep, mcp__metricool__getAnalyticsDataByMetrics, mcp__metricool__getAnalyticsAvailableMetrics, mcp__metricool__getScheduledPosts, Bash(node supervisor/dist/adapters/shopify.js orders*)` | `Strategie.md, Marke/Kern.md, Marke/Produkte.md, Pläne/Content-Kalender.md, Pläne/Wochenplan.md, Status.md` | – |
| content | standard | 1 | `Read, Write, mcp__metricool__*, Bash(node supervisor/dist/adapters/studio.js *)` | `Marke/Kern.md, Marke/Tonalität.md, Marke/Hashtags.md, Marke/Visuell.md, Pläne/Content-Kalender.md` | mcp: metricool |
| shop-analyst | standard | 1 | `Read, Write, Bash(node supervisor/dist/adapters/shopify.js *)` | `Marke/Produkte.md, Marke/Tonalität.md` | env: SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET |
| studio | cheap | 2 | `Read, Write, Glob, Bash(node supervisor/dist/adapters/studio.js *)` | `Marke/Visuell.md` | services: (none; checks `Assets/poster` non-empty in SKILL) |
| reviewer | cheap | 2 | `Read, Write` | `Marke/Kern.md, Marke/Tonalität.md, Strategie.md` | – |
| berichter | cheap | 2 | `Read, Write, Glob, mcp__metricool__getAnalyticsDataByMetrics, Bash(node supervisor/dist/adapters/shopify.js orders*)` | `Status.md, Strategie.md` | – |

Key rules to encode: **planer** creates tasks by writing new files `Aufgaben/<id>.md` using the exact frontmatter schema (give it the template) following the Wertleiter table in `Strategie.md`, never more than 15 open, never for unavailable stations (reads `Status.md` ⛔ list) → `manual` task instead, writes reasoning into `Pläne/Wochenplan.md`, keeps `Pläne/Content-Kalender.md` as a table `| Datum | Plattform | Format | Thema | Aufgabe |`. **content** writes per-platform texts under `## Ergebnis` with sub-headings `### Instagram`, `### TikTok`, `### LinkedIn`, `### Google Unternehmensprofil`; formats only Reel/Karussell; hashtag counts IG ≤ 8, TikTok ≤ 5; schedules via `createScheduledPost` **only if** the prompt says `Freigabe nötig: nein` and `Veröffentlichen heute erlaubt: ja`, then sets `published_at` in frontmatter; uses `getBestTimeToPostByNetwork`. **shop-analyst** runs `orders --days 60` and `products`, updates `Marke/Produkte.md` table, proposes titles/descriptions in *Ergebnis*; calls `update-product` only when `Freigabe nötig: nein` (runner sets `LIMITLESS_ALLOW_WRITES=1` in that case). **studio** lists `Assets/poster/*`, renders into `Assets/content/<task-id>/`, appends paths to `outputs`. **reviewer** checks against Tonalität/Verbote/platform limits, writes verdict `FREIGABE-REIF` or `ZURÜCK: <Grund>` into *Ergebnis* and, on return, sets the reviewed task's `status: todo` with a protocol line. **berichter** writes `Berichte/YYYY-MM-DD-Tag.md` / `Berichte/YYYY-Www-Woche.md` with sections *Erledigt · Wartet · Blockiert · Kosten · Kennzahlen · Empfehlung*.

`.claude/CLAUDE.md` (German, < 120 lines): you are a worker of Limitless OS; read the task note first; write only under `LimitlessOS/`; never touch frontmatter fields owned by the supervisor; finish by filling *Ergebnis* and *Offene Fragen an Julius*; never publish without permission; never write secrets. `.claude/settings.json`: `{"enableAllProjectMcpServers": true, "permissions": {"deny": ["Bash(git push*)", "Bash(rm -rf*)", "WebFetch(domain:*)"]}}`.

- [ ] **Step 1: Test**: `loadStations(repoRoot)` returns 6 stations with the table's tier/autopilot; every `context` file exists in `vault-template/LimitlessOS/` (Task 18 — write test now, it passes after Task 18; mark `it.todo` until then); `generateClaudeFiles` succeeds and each generated skill has `allowed-tools`.
- [ ] **Step 2: Write the six stations and the two `.claude` files.** **Step 3: `npm run build:stations`** → 12 files. **Step 4: Run tests → PASS.** **Step 5: Commit** `feat(stations): six core stations and worker rules`.

---

### Task 18: Vault template

**Files:**
- Create: `vault-template/LimitlessOS/{Home.md, Dashboard.base, Status.md, Strategie.md, Marke/Kern.md, Marke/Tonalität.md, Marke/Produkte.md, Marke/Visuell.md, Marke/Hashtags.md, Pläne/Content-Kalender.md, Pläne/Wochenplan.md, Ideen/README.md, Inbox/README.md, Assets/poster/README.md, Assets/content/.gitkeep, Aufgaben/.gitkeep, Berichte/.gitkeep, Archiv/.gitkeep}`
- Test: enable the `it.todo` from Task 17; add `supervisor/test/vault/template.test.ts`

**Interfaces:**
- Produces: `Strategie.md` frontmatter mirrors config (`reserve_for_julius: 30`, `week_reset: "Thu 18:00"`, `daily_post_limit: 3`, `daily_shop_change_limit: 5`, `autopilot: { content: 1, shop-analyst: 1 }`) and body: *Ziel (Reichweite → Verkäufe)*, *Wertleiter* (the 11-row table from spec §8 with Bedingung/Aktion/Abkühlzeit), *Grenzen*, *Was Julius entscheidet*. `Dashboard.base` with views `Heute` (table, filter `type == "task" && status != "done" && status != "cancelled"`, order `title, station, status, priority, due, tier`), `Kanban` (type kanban, groupBy `status`, groupOrder `[todo, doing, review, blocked, done, cancelled]`), `Wartet auf dich` (filter `status == "review"`), `Nach Station` (groupBy station), `Kosten` (table with summary Sum on `cost_usd`, groupBy `model_used`), base-wide filter `type == "task"`. `Home.md`: `![[Status.md]]`, then `![[Dashboard.base#Wartet auf dich]]`, `![[Dashboard.base#Kanban]]`, `![[Dashboard.base#Heute]]`, link to `http://localhost:4242`. Marke notes contain the questions Julius answers (each as `> [!question]` callout) plus sensible defaults for a German poster brand (Du-Ansprache, keine Einzelbild-Posts, Formate 30×40/50×70/61×91). `Produkte.md` table header `| Produkt | Handle | Preis | Lager | Titel optimiert? | Pins? |`. `Assets/poster/README.md`: "Lege hier deine Poster-Dateien (PNG/JPG, Dateiname = Produkt-Handle) ab".

- [ ] **Step 1: Test**: every file listed exists; `Dashboard.base` parses as YAML with 5 views; `Strategie.md` frontmatter has the 5 keys. **Step 2–5:** write → run → PASS → commit `feat(vault): Obsidian vault template with Bases dashboard`.

---

### Task 19: Windows installer, doctor and German docs

**Files:**
- Create: `scripts/install.ps1`, `scripts/doctor.ps1`, `docs/anleitung/erste-schritte.md`, `docs/anleitung/metricool-mcp.md`, `docs/anleitung/betrieb.md`
- Modify: `README.md`

**Interfaces:**
- `install.ps1` steps exactly as spec §10: winget installs (Node LTS, Git.Git, Gyan.FFmpeg), Claude Code native (`irm https://claude.ai/install.ps1 | iex`) if `claude` missing; `npm install` + `npm run build` + `npm run build:stations`; `npx playwright install chromium` (in `supervisor/`); folder picker (`System.Windows.Forms.FolderBrowserDialog`) → writes `vaultRoot = <pick>\LimitlessOS` into `limitless.config.json` and copies `vault-template\LimitlessOS` without overwriting; sets `hasTrustDialogAccepted` for the repo path in `%USERPROFILE%\.claude.json` (create minimal JSON if missing); `claude mcp add --transport http metricool https://ai.metricool.com/mcp` then opens an interactive `claude` once so Julius logs into Metricool (`/mcp`); copies `.env.example` → `.env` if missing and opens Notepad; registers Scheduled Task `LimitlessOS` (`schtasks` or `Register-ScheduledTask`: trigger AtLogOn for current user, action `node.exe <repo>\supervisor\dist\index.js`, working dir repo, `-RunOnlyIfLoggedOn`, restart 3× every 1 min, `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`); starts the task; opens `http://localhost:4242`.
- `doctor.ps1`: re-runs the preflight equivalents and prints ✅/⛔ per check in German; `-Smoke` runs one `cheap` worker with the prompt `Antworte nur mit OK` through the supervisor's runner (via `node supervisor/dist/index.js --smoke`, add that flag in `index.ts`: runs preflight + one fake task + exits); detects GPU via `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader` and appends a `## Grafikkarte` section with the VRAM class recommendation (spec §10) to `Status.md`.
- Docs (German, short): erste-schritte (install → Marke-Fragen beantworten → Poster ablegen → erste Freigaben), metricool-mcp (Login-Schritte), betrieb (Pause, Freigaben, Autopilot ändern, Logs, was tun bei rotem Status).

- [ ] **Step 1:** Write both scripts; validate syntax with `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/install.ps1)) | Out-Null"` if `pwsh` exists, otherwise note in commit that syntax check happens on the PC via `doctor.ps1`. **Step 2:** Add `--smoke` to `index.ts` with a test in `scheduler.test.ts` (`FAKE_CLAUDE=1` → exit code 0 and one ledger entry). **Step 3:** Write docs and README (what it is, 5-step install, links). **Step 4:** `npm test` all green, `npm run build` clean. **Step 5: Commit** `feat: Windows installer, doctor and German guides`.

---

### Task 20: End-to-end integration test and branch wrap-up

**Files:**
- Create: `supervisor/test/e2e/cycle.test.ts`
- Modify: `README.md` (status badge-free "Stand" section)

- [ ] **Step 1: Test**: in a temp vault copied from `vault-template`, with `FAKE_CLAUDE=1` and real `stations/`: start `Supervisor`, drive `tick()` with a fake clock through: empty queue → planner task auto-created → fixture result that *creates two task files* (fake-claude fixture `planer-creates-tasks.jsonl` whose `result` text is irrelevant; the test itself writes the two task notes to simulate the worker's file writes) → next ticks run `content` (→ `review`) and `studio` (→ `done`) → `approve(contentId)` → `done` with `published_at` unset (publishAllowed but needs_approval was true at start → no publish) → `Status.md` contains `Wartet auf dich` empty and `Erledigt`-counts; `Berichte` trigger at 07:30 creates berichter task once.
- [ ] **Step 2: Run full suite** `npm test` → all PASS; `npm run build` → no errors; `npm run build:stations` idempotent (second run writes 0 changed files).
- [ ] **Step 3: Commit** `test: end-to-end supervisor cycle` and push branch `claude/limitless-os`.

---

## Self-review notes (done while writing)

- Spec §4.1 adds no `published_at`; the plan adds it (Task 1 types, Task 14 counters, Task 17 content rules) because the daily post limit needs a machine-readable signal — recorded here as a deliberate spec extension.
- Spec §6.4 "premium daily 08:00" vs §7.2 "planer standard": resolved as daily planner run `standard`, Wednesday 20:00 `premium` (Task 14).
- Haiku family window: counted separately and against the weekly total (Task 6 uses per-family capacities from config).
- Studio tests skip when Chromium/ffmpeg are absent; the PC smoke (`doctor.ps1 -Smoke`) covers them.
