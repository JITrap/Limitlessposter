// CLI around the Veröffentlichungs-Liste (publog.ts) for workers and the supervisor:
//   node supervisor/dist/adapters/posts.js check --network instagram --text "<Caption>" [--text-file <pfad>] [--media url1,url2] [--day YYYY-MM-DD]
//       → exit 0 frei · exit 2 Dublette (JSON mit Treffer) · exit 3 Tageslimit des Netzwerks erreicht
//   node supervisor/dist/adapters/posts.js add   --network instagram --date 2026-10-24T12:00 --type reel --status geplant --text "…" [--media …] [--url <plannerUrl>] [--quelle <task-id>]
//   node supervisor/dist/adapters/posts.js sync  --file <json>   (Liste von {network,date,type,status,text,url,media}) → mischt, setzt `synced`
//   node supervisor/dist/adapters/posts.js today [--day YYYY-MM-DD]   → Zähler je Netzwerk gegen die Tageslimits
//   node supervisor/dist/adapters/posts.js status  → Stand der Synchronisation, Zahl der Einträge
// Vault root: LIMITLESS_VAULT_ROOT, else limitless.config.json → vaultRoot. Never prints secrets.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from '../config.js'
import { countForDay, findDuplicate, loadPublog, mergeEntries, savePublog, type PubInput, type PubStatus } from '../publog.js'
import { DEFAULT_LIMITS, limitFor, loadLimits } from '../limits.js'

export { DEFAULT_LIMITS, limitFor }

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function localDay(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function localStamp(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${localDay(now)}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
}

export interface PostsContext {
  vaultRoot: string
  limits: Record<string, number>
  now: Date
}

export async function resolveContext(env: NodeJS.ProcessEnv, repoRoot: string, now: Date): Promise<PostsContext> {
  let vaultRoot = env.LIMITLESS_VAULT_ROOT?.trim() ?? ''
  let configLimits: Record<string, number> | undefined
  try {
    const cfg = await loadConfig(repoRoot, env)
    vaultRoot ||= cfg.vaultRoot
    configLimits = cfg.dailyPostLimits
  } catch {
    // outside the repo (tests) the env must carry the vault root
  }
  if (!vaultRoot) throw new Error('Vault-Ordner unbekannt: LIMITLESS_VAULT_ROOT setzen oder limitless.config.json → vaultRoot')
  return { vaultRoot, limits: await loadLimits(configLimits, vaultRoot), now }
}

async function textFrom(argv: string[]): Promise<string> {
  const file = arg(argv, '--text-file')
  if (file) return readFile(file, 'utf8')
  return arg(argv, '--text') ?? ''
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, now = new Date(), repoRoot = process.cwd()): Promise<number> {
  const cmd = argv[0]
  const out = (o: unknown): void => console.log(JSON.stringify(o, null, 0))
  if (!cmd || cmd === '--help') {
    console.log('Verwendung: posts.js check|add|sync|today|status … (siehe Kopf der Datei)')
    return 1
  }
  const ctx = await resolveContext(env, repoRoot, now)
  const log = await loadPublog(ctx.vaultRoot)

  if (cmd === 'status') {
    out({ ok: true, synced: log.synced, eintraege: log.entries.length, datei: join(ctx.vaultRoot, 'Pläne', 'Veröffentlicht.md') })
    return 0
  }

  if (cmd === 'today') {
    const day = arg(argv, '--day') ?? localDay(now)
    const networks = new Set([...Object.keys(ctx.limits).filter((k) => k !== 'default'), ...log.entries.filter((e) => e.date.startsWith(day)).map((e) => e.network)])
    const rows: Record<string, { genutzt: number; limit: number; frei: number }> = {}
    for (const n of networks) {
      const used = countForDay(log.entries, n, day)
      const limit = limitFor(ctx.limits, n)
      rows[n] = { genutzt: used, limit, frei: Math.max(0, limit - used) }
    }
    out({ ok: true, tag: day, netzwerke: rows })
    return 0
  }

  if (cmd === 'check') {
    const network = (arg(argv, '--network') ?? '').toLowerCase()
    const text = await textFrom(argv)
    if (!network || !text.trim()) {
      out({ ok: false, fehler: 'check braucht --network und --text/--text-file' })
      return 1
    }
    const media = (arg(argv, '--media') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const hit = findDuplicate({ network, text, media }, log.entries, now)
    if (hit) {
      out({ ok: false, dublette: true, grund: hit.reason, aehnlichkeit: Number(hit.similarity.toFixed(2)), treffer: { datum: hit.entry.date, netzwerk: hit.entry.network, status: hit.entry.status, text: hit.entry.text, link: hit.entry.url, quelle: hit.entry.quelle } })
      return 2
    }
    const day = arg(argv, '--day')
    if (day) {
      const used = countForDay(log.entries, network, day)
      const limit = limitFor(ctx.limits, network)
      if (used >= limit) {
        out({ ok: false, dublette: false, tageslimit: true, netzwerk: network, tag: day, genutzt: used, limit })
        return 3
      }
    }
    out({ ok: true, dublette: false, synced: log.synced })
    return 0
  }

  if (cmd === 'add') {
    const text = await textFrom(argv)
    const input: PubInput = {
      network: arg(argv, '--network') ?? '',
      date: arg(argv, '--date') ?? localStamp(now),
      type: arg(argv, '--type') ?? 'post',
      status: (arg(argv, '--status') as PubStatus | undefined) ?? 'geplant',
      text,
      media: (arg(argv, '--media') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      url: arg(argv, '--url') ?? '',
      quelle: arg(argv, '--quelle') ?? (env.LIMITLESS_TASK_ID ? `content:${env.LIMITLESS_TASK_ID}` : 'manuell'),
    }
    if (!input.network || !text.trim()) {
      out({ ok: false, fehler: 'add braucht --network und --text/--text-file' })
      return 1
    }
    const hit = findDuplicate({ network: input.network, text, media: input.media }, log.entries, now)
    const merged = mergeEntries(log, [input])
    await savePublog(ctx.vaultRoot, merged.log)
    out({ ok: true, hinzugefuegt: merged.added, aktualisiert: merged.updated, warnung: hit && merged.added ? `Dublette von ${hit.entry.date} (${hit.reason}) – bitte in Metricool auf Entwurf setzen` : null })
    return 0
  }

  if (cmd === 'sync') {
    const file = arg(argv, '--file')
    if (!file) {
      out({ ok: false, fehler: 'sync braucht --file <json>' })
      return 1
    }
    let inputs: PubInput[]
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
      inputs = Array.isArray(raw) ? (raw as PubInput[]) : Array.isArray((raw as { eintraege?: unknown }).eintraege) ? ((raw as { eintraege: PubInput[] }).eintraege) : []
    } catch (err) {
      out({ ok: false, fehler: `JSON nicht lesbar: ${err instanceof Error ? err.message : String(err)}` })
      return 1
    }
    const merged = mergeEntries(log, inputs)
    merged.log.synced = localStamp(now)
    await savePublog(ctx.vaultRoot, merged.log)
    out({ ok: true, hinzugefuegt: merged.added, aktualisiert: merged.updated, eintraege: merged.log.entries.length, synced: merged.log.synced })
    return 0
  }

  out({ ok: false, fehler: `Unbekannter Befehl: ${cmd}` })
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    console.log(JSON.stringify({ ok: false, fehler: err instanceof Error ? err.message : String(err) }))
    process.exit(1)
  })
}
