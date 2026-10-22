import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parse } from 'yaml'
import type { Tier } from '../types.js'

/** Declarative description of a station folder `stations/<name>/` (spec §7.1). */
export interface Station {
  name: string
  display: string
  description: string
  tier: Tier
  maxTurns: number
  timeoutMin: number
  /** Claude Code permission-rule strings passed via `--allowedTools`. */
  tools: string[]
  /** Vault-relative notes injected as context. */
  context: string[]
  requires: { mcp: string[]; env: string[]; services: string[] }
  /** 0 drafts only · 1 publish after approval · 2 fully automatic */
  autopilot: 0 | 1 | 2
  cooldownHours: number
  outputsDir: string | null
  dir: string
  skillPath: string
}

export interface Availability {
  available: boolean
  /** German, shown in Status.md and the world view. */
  reason: string | null
}

const TIERS: Tier[] = ['cheap', 'standard', 'premium']

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

export async function loadStations(repoRoot: string): Promise<Station[]> {
  const root = join(repoRoot, 'stations')
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const stations: Station[] = []
  for (const folder of entries.sort()) {
    const dir = join(root, folder)
    if (!(await stat(dir)).isDirectory()) continue
    const yamlPath = join(dir, 'station.yaml')
    let text: string
    try {
      text = await readFile(yamlPath, 'utf8')
    } catch {
      continue
    }
    stations.push(parseStation(text, dir, yamlPath, folder, repoRoot))
    try {
      await stat(join(dir, 'SKILL.md'))
    } catch {
      throw new Error(`Station „${folder}“: ${relative(repoRoot, join(dir, 'SKILL.md'))} fehlt`)
    }
  }
  return stations
}

function parseStation(text: string, dir: string, yamlPath: string, folder: string, repoRoot: string): Station {
  const file = relative(repoRoot, yamlPath)
  const raw = parse(text) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') throw new Error(`${file}: kein gültiges YAML`)
  const need = (key: string): string => {
    const v = raw[key]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${file}: Pflichtfeld „${key}“ fehlt`)
    return v.trim()
  }
  const name = need('name')
  if (name !== folder) throw new Error(`${file}: Ordner „${folder}“ und name „${name}“ stimmen nicht überein`)
  const tier = need('tier') as Tier
  if (!TIERS.includes(tier)) throw new Error(`${file}: tier muss cheap, standard oder premium sein (ist „${tier}“)`)

  const req = (raw.requires && typeof raw.requires === 'object' ? raw.requires : {}) as Record<string, unknown>
  const autopilotRaw = raw.autopilot === undefined ? 1 : Number(raw.autopilot)
  if (![0, 1, 2].includes(autopilotRaw)) throw new Error(`${file}: autopilot muss 0, 1 oder 2 sein`)

  return {
    name,
    display: need('display'),
    description: need('description'),
    tier,
    maxTurns: raw.max_turns === undefined ? 40 : Number(raw.max_turns),
    timeoutMin: raw.timeout_min === undefined ? 25 : Number(raw.timeout_min),
    tools: strList(raw.tools),
    context: strList(raw.context),
    requires: { mcp: strList(req.mcp), env: strList(req.env), services: strList(req.services) },
    autopilot: autopilotRaw as 0 | 1 | 2,
    cooldownHours: raw.cooldown_hours === undefined ? 0 : Number(raw.cooldown_hours),
    outputsDir: typeof raw.outputs_dir === 'string' && raw.outputs_dir.trim() ? raw.outputs_dir.trim() : null,
    dir,
    skillPath: join(dir, 'SKILL.md'),
  }
}

export interface AvailabilityProbes {
  http: (url: string) => Promise<boolean>
  mcpConfigured: (name: string) => Promise<boolean>
}

/** Check `requires` in the order env → mcp → services; the first problem is the reason (spec §7.4). */
export async function checkAvailability(
  st: Station,
  env: Record<string, string | undefined>,
  probes: AvailabilityProbes,
): Promise<Availability> {
  for (const key of st.requires.env) {
    if (!env[key] || !String(env[key]).trim()) return { available: false, reason: `Umgebungsvariable ${key} fehlt` }
  }
  for (const name of st.requires.mcp) {
    if (!(await probes.mcpConfigured(name))) return { available: false, reason: `MCP-Server ${name} nicht eingerichtet` }
  }
  for (const url of st.requires.services) {
    if (!(await probes.http(url))) return { available: false, reason: `Dienst ${url} nicht erreichbar` }
  }
  return { available: true, reason: null }
}
