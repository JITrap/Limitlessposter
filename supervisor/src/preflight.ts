import { access, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveClaudeBin } from './runner/claude.js'
import { stripBom } from './config.js'

export function normalizePathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export interface PreflightConfig {
  repoRoot: string
  vaultRoot: string
  /** FAKE_CLAUDE=1: tests and smoke runs without a real `claude` binary. */
  fakeClaude: boolean
}

export interface PreflightDeps {
  exec: (cmd: string, args: string[], opts?: { timeoutMs?: number }) => Promise<{ code: number; stdout: string }>
  env: NodeJS.ProcessEnv
  homeDir: string
}

/** `claude mcp list` prüft jeden Server live – bei vielen Servern dauert das deutlich länger als 20 s. */
export const MCP_LIST_TIMEOUT_MS = 90_000

export type McpState = 'connected' | 'auth' | 'approval' | 'failed' | 'unknown'

export interface Logins {
  /** mit dem claude.ai-Konto angemeldet */
  claude: boolean
  /** je MCP-Server aus `claude mcp list` */
  mcp: Record<string, McpState>
}

export interface PreflightResult {
  ok: boolean
  /** German; any entry stops workers from starting. */
  problems: string[]
  warnings: string[]
  claudeVersion: string | null
  authMethod: string | null
  logins: Logins
}

/**
 * `claude mcp list` → Zustand je Server. Zeilen wie
 * `metricool: https://… (HTTP) - ✓ Connected` · `shopify: … - ⚠ Needs authentication` · `x: … - ✗ Failed to connect`
 * · `metricool: … - ⏸ Pending approval (run \`claude\` to approve)`. Der Zustand steht hinter dem letzten „ - “;
 * unbekannte Formulierungen bleiben `unknown` – daraus folgt nie ein automatisches Abhaken.
 */
export function parseMcpListDetail(stdout: string): Record<string, { state: McpState; raw: string }> {
  const out: Record<string, { state: McpState; raw: string }> = {}
  for (const line0 of stdout.split(/\r?\n/)) {
    const line = line0.trim()
    const m = /^([A-Za-z0-9_.-]+):\s+(.*)$/.exec(line)
    if (!m || /^checking/i.test(line)) continue
    const parts = m[2].split(' - ')
    const status = (parts.length > 1 ? parts[parts.length - 1] : m[2]).trim()
    const rest = status.toLowerCase()
    let state: McpState = 'unknown'
    if (/pending approval|freigabe/.test(rest)) state = 'approval'
    else if (/needs auth|authenticat|anmeld/.test(rest)) state = 'auth'
    else if (/fail|error|fehl|not connected|disconnected|not configured/.test(rest)) state = 'failed'
    else if (/connected|verbunden|✓|✔/.test(rest)) state = 'connected'
    out[m[1].toLowerCase()] = { state, raw: status }
  }
  return out
}

export function parseMcpList(stdout: string): Record<string, McpState> {
  return Object.fromEntries(Object.entries(parseMcpListDetail(stdout)).map(([k, v]) => [k, v.state]))
}

/** Server aus dem Projekt (`.mcp.json`), die Arbeiter nutzen sollen. */
async function projectMcpServers(repoRoot: string): Promise<string[]> {
  try {
    const raw = JSON.parse(stripBom(await readFile(join(repoRoot, '.mcp.json'), 'utf8'))) as { mcpServers?: Record<string, unknown> }
    return Object.keys(raw.mcpServers ?? {}).map((n) => n.toLowerCase())
  } catch {
    return []
  }
}

export const MIN_CLAUDE_VERSION = [2, 1, 302] as const

function versionTooOld(v: string): boolean {
  const parts = v.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const a = parts[i] ?? 0
    const b = MIN_CLAUDE_VERSION[i]
    if (a !== b) return a < b
  }
  return false
}

/** Start-up checks (spec §5.3). Workers only run when `ok`. */
export async function preflight(cfg: PreflightConfig, deps: PreflightDeps): Promise<PreflightResult> {
  const problems: string[] = []
  const warnings: string[] = []
  let claudeVersion: string | null = null
  let authMethod: string | null = null
  const logins: Logins = { claude: false, mcp: {} }

  if (deps.env.ANTHROPIC_API_KEY) {
    problems.push('ANTHROPIC_API_KEY ist gesetzt – würde API-Guthaben statt Abo verbrauchen. Bitte die Variable entfernen.')
  }

  if (!cfg.fakeClaude) {
    const bin = resolveClaudeBin(deps.env)
    try {
      const v = await deps.exec(bin, ['--version'])
      const m = /(\d+)\.(\d+)\.(\d+)/.exec(v.stdout)
      if (v.code !== 0 || !m) problems.push(`Claude Code (${bin}) antwortet nicht auf --version – Installation prüfen`)
      else {
        claudeVersion = `${m[1]}.${m[2]}.${m[3]}`
        if (versionTooOld(claudeVersion)) {
          problems.push(`Claude Code zu alt (${claudeVersion}), mindestens ${MIN_CLAUDE_VERSION.join('.')} nötig – bitte aktualisieren`)
        }
      }
    } catch {
      problems.push(`Claude Code (${bin}) nicht gefunden – install.ps1 ausführen oder LIMITLESS_CLAUDE_BIN setzen`)
    }

    if (claudeVersion) {
      try {
        const a = await deps.exec(bin, ['auth', 'status'])
        let method: string | null = null
        try {
          const parsed = JSON.parse(a.stdout) as { authMethod?: string; loggedIn?: boolean }
          method = parsed.authMethod ?? null
          if (parsed.loggedIn === false) method = null
        } catch {
          method = null
        }
        authMethod = method
        if (a.code !== 0 || method !== 'claude.ai') {
          problems.push('Nicht mit dem Claude-Abo angemeldet – bitte `claude` im Terminal starten und mit dem claude.ai-Konto einloggen')
        } else logins.claude = true
      } catch {
        problems.push('Nicht mit dem Claude-Abo angemeldet – `claude auth status` schlug fehl')
      }
    }

    // MCP-Logins (Metricool, Shopify): nur Hinweis, kein Stopp. Der Aufseher gibt den Zustand an die
    // Stations-Verfügbarkeit weiter (Anmeldung nötig → Station ⛔) und hakt Login-Karten damit selbst ab.
    if (claudeVersion) {
      const project = await projectMcpServers(cfg.repoRoot)
      try {
        const l = await deps.exec(bin, ['mcp', 'list'], { timeoutMs: MCP_LIST_TIMEOUT_MS })
        const detail = l.code === 0 ? parseMcpListDetail(l.stdout) : {}
        if (l.code !== 0) warnings.push(`\`claude mcp list\` hat nicht geantwortet (Code ${l.code}) – Login-Stand der MCP-Server unbekannt`)
        logins.mcp = Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.state]))
        for (const [name, { state, raw }] of Object.entries(detail)) {
          if (state === 'auth') warnings.push(`MCP-Server ${name}: Anmeldung nötig – \`claude mcp login ${name}\` (oder \`claude\` → /mcp)`)
          else if (state === 'approval') warnings.push(`MCP-Server ${name}: Projekt-Server noch nicht freigegeben – \`claude\` im Repo-Ordner starten und den Server freigeben (oder enableAllProjectMcpServers in den Einstellungen)`)
          else if (state === 'failed') warnings.push(`MCP-Server ${name}: nicht erreichbar laut \`claude mcp list\` (${raw})`)
          else if (state === 'unknown' && project.includes(name)) warnings.push(`MCP-Server ${name}: Zustand unklar laut \`claude mcp list\` (${raw})`)
        }
        if (l.code === 0) for (const name of project) if (!detail[name]) warnings.push(`MCP-Server ${name} steht in .mcp.json, fehlt aber in \`claude mcp list\` – Projekt-Server freigeben (\`claude\` im Repo-Ordner starten)`)
      } catch {
        warnings.push('`claude mcp list` schlug fehl – Login-Stand der MCP-Server unbekannt')
      }
    }
  }

  // Trust: project permissions only apply under -p when the folder was trusted once.
  // Claude Code on Windows keys projects in more than one spelling (slashes, drive
  // letter case), so the lookup is slash- and case-insensitive.
  try {
    const raw = JSON.parse(stripBom(await readFile(join(deps.homeDir, '.claude.json'), 'utf8'))) as {
      projects?: Record<string, { hasTrustDialogAccepted?: boolean }>
    }
    const wanted = normalizePathKey(cfg.repoRoot)
    const trusted = Object.entries(raw.projects ?? {}).some(([key, v]) => normalizePathKey(key) === wanted && v?.hasTrustDialogAccepted === true)
    if (!trusted) problems.push(`Repo-Ordner ${cfg.repoRoot} ist für Claude nicht vertrauenswürdig – install.ps1 ausführen`)
  } catch {
    problems.push(`Repo-Ordner ${cfg.repoRoot} ist für Claude nicht vertrauenswürdig (~/.claude.json fehlt) – install.ps1 ausführen`)
  }

  // Vault
  try {
    await access(cfg.vaultRoot)
    await mkdir(join(cfg.vaultRoot, 'Aufgaben'), { recursive: true })
  } catch {
    problems.push(`Vault-Ordner ${cfg.vaultRoot} nicht gefunden oder nicht beschreibbar – Pfad in limitless.config.json prüfen`)
  }

  try {
    await access(join(cfg.repoRoot, '.env'))
  } catch {
    warnings.push('Keine .env gefunden – nur Stationen ohne Schlüssel sind aktiv')
  }

  return { ok: problems.length === 0, problems, warnings, claudeVersion, authMethod, logins }
}
