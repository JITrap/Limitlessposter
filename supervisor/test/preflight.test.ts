import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseMcpList, preflight, type PreflightDeps, type PreflightConfig } from '../src/preflight.js'

async function setup(opts: { trust?: boolean; vault?: boolean; dotenv?: boolean } = {}): Promise<{ cfg: PreflightConfig; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'los-pre-'))
  const home = join(root, 'home')
  const repoRoot = join(root, 'repo')
  const vaultRoot = join(root, 'vault', 'LimitlessOS')
  await mkdir(home, { recursive: true })
  await mkdir(repoRoot, { recursive: true })
  if (opts.vault !== false) await mkdir(vaultRoot, { recursive: true })
  if (opts.trust !== false) {
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { [repoRoot]: { hasTrustDialogAccepted: true } } }), 'utf8')
  }
  if (opts.dotenv !== false) await writeFile(join(repoRoot, '.env'), 'X=1\n', 'utf8')
  return { cfg: { repoRoot, vaultRoot, fakeClaude: false }, home }
}

const okExec: PreflightDeps['exec'] = async (_cmd, args) => {
  if (args[0] === '--version') return { code: 0, stdout: '2.1.308 (Claude Code)\n' }
  if (args[0] === 'auth') return { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) }
  if (args[0] === 'mcp' && args[1] === 'list') return { code: 0, stdout: 'Checking MCP server health...\n\n' }
  return { code: 1, stdout: '' }
}

const deps = (home: string, over: Partial<PreflightDeps> = {}): PreflightDeps => ({
  exec: okExec,
  env: {},
  homeDir: home,
  ...over,
})

describe('preflight', () => {
  it('is green when everything is in place', async () => {
    const { cfg, home } = await setup()
    const r = await preflight(cfg, deps(home))
    expect(r).toEqual({ ok: true, problems: [], warnings: [], claudeVersion: '2.1.308', authMethod: 'claude.ai', logins: { claude: true, mcp: {} } })
  })

  it('reads the MCP logins from `claude mcp list` and only warns about servers that need a login', async () => {
    const { cfg, home } = await setup()
    const exec: PreflightDeps['exec'] = async (c, a) =>
      a[0] === 'mcp' && a[1] === 'list'
        ? { code: 0, stdout: 'Checking MCP server health...\n\nmetricool: https://mcp.metricool.com/mcp (HTTP) - ✓ Connected\nshopify: https://shopify.dev/mcp (HTTP) - ⚠ Needs authentication\nprintify: npx x (stdio) - ✗ Failed to connect\n' }
        : okExec(c, a)
    const r = await preflight(cfg, deps(home, { exec }))
    expect(r.ok).toBe(true)
    expect(r.logins).toEqual({ claude: true, mcp: { metricool: 'connected', shopify: 'auth', printify: 'failed' } })
    expect(r.warnings).toContainEqual(expect.stringMatching(/shopify: Anmeldung nötig/))
    expect(r.warnings).toContainEqual(expect.stringMatching(/printify: nicht erreichbar/))
  })

  it('parses `claude mcp list` tolerantly and never guesses a login it cannot read', () => {
    expect(parseMcpList('metricool: url (HTTP) - ✓ Connected\nshopify: url - Needs authentication\nodd: something else\n')).toEqual({ metricool: 'connected', shopify: 'auth', odd: 'unknown' })
    expect(parseMcpList('')).toEqual({})
    // the state is read behind the last " - ": a URL containing "connected" or a "Not connected" status cannot pass as connected
    expect(parseMcpList('x: https://connected.example/mcp (HTTP) - ✗ Failed to connect\ny: https://a.b/mcp (HTTP) - Not connected\n')).toEqual({ x: 'failed', y: 'failed' })
    expect(parseMcpList('metricool: https://ai.metricool.com/mcp (HTTP) - ⏸ Pending approval (run `claude` to approve)\n')).toEqual({ metricool: 'approval' })
  })

  it('warns about project servers that wait for approval, are missing, or when `mcp list` times out', async () => {
    const { cfg, home } = await setup()
    await writeFile(join(cfg.repoRoot, '.mcp.json'), JSON.stringify({ mcpServers: { metricool: {}, shopify: {} } }), 'utf8')
    const seen: Array<{ args: string[]; opts?: { timeoutMs?: number } }> = []
    const exec: PreflightDeps['exec'] = async (c, a, o) => {
      seen.push({ args: a, opts: o })
      return a[0] === 'mcp' ? { code: 0, stdout: 'metricool: https://ai.metricool.com/mcp (HTTP) - ⏸ Pending approval (run `claude` to approve)\n' } : okExec(c, a)
    }
    const r = await preflight(cfg, deps(home, { exec }))
    expect(r.ok).toBe(true)
    expect(r.logins.mcp).toEqual({ metricool: 'approval' })
    expect(r.warnings).toContainEqual(expect.stringMatching(/metricool: Projekt-Server noch nicht freigegeben/))
    expect(r.warnings).toContainEqual(expect.stringMatching(/shopify steht in .mcp.json, fehlt aber/))
    expect(seen.find((s) => s.args[0] === 'mcp')?.opts?.timeoutMs).toBe(90_000)

    const slow: PreflightDeps['exec'] = async (c, a) => (a[0] === 'mcp' ? { code: 1, stdout: 'metricool: … - ✓ Connected' } : okExec(c, a))
    const t = await preflight(cfg, deps(home, { exec: slow }))
    expect(t.logins.mcp).toEqual({})
    expect(t.warnings).toContainEqual(expect.stringMatching(/claude mcp list.*hat nicht geantwortet/))
  })

  it('rejects an outdated Claude Code', async () => {
    const { cfg, home } = await setup()
    const exec: PreflightDeps['exec'] = async (c, a) => (a[0] === '--version' ? { code: 0, stdout: '2.0.99\n' } : okExec(c, a))
    const r = await preflight(cfg, deps(home, { exec }))
    expect(r.ok).toBe(false)
    expect(r.problems).toContainEqual(expect.stringMatching(/Claude Code zu alt \(2\.0\.99\)/))
  })

  it('reports a missing claude binary', async () => {
    const { cfg, home } = await setup()
    const exec: PreflightDeps['exec'] = async () => { throw new Error('ENOENT') }
    const r = await preflight(cfg, deps(home, { exec }))
    expect(r.problems).toContainEqual(expect.stringMatching(/claude.*nicht gefunden/i))
  })

  it('requires the claude.ai subscription login', async () => {
    const { cfg, home } = await setup()
    const exec: PreflightDeps['exec'] = async (c, a) =>
      a[0] === 'auth' ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) } : okExec(c, a)
    const r = await preflight(cfg, deps(home, { exec }))
    expect(r.problems).toContainEqual(expect.stringMatching(/Nicht mit dem Claude-Abo angemeldet/))
    const exec2: PreflightDeps['exec'] = async (c, a) => (a[0] === 'auth' ? { code: 1, stdout: '' } : okExec(c, a))
    const r2 = await preflight(cfg, deps(home, { exec: exec2 }))
    expect(r2.problems).toContainEqual(expect.stringMatching(/Nicht mit dem Claude-Abo angemeldet/))
  })

  it('refuses to run with ANTHROPIC_API_KEY set', async () => {
    const { cfg, home } = await setup()
    const r = await preflight(cfg, deps(home, { env: { ANTHROPIC_API_KEY: 'sk-ant' } }))
    expect(r.problems).toContainEqual(expect.stringMatching(/ANTHROPIC_API_KEY ist gesetzt/))
  })

  it('requires the repo folder to be trusted', async () => {
    const { cfg, home } = await setup({ trust: false })
    const r = await preflight(cfg, deps(home))
    expect(r.problems).toContainEqual(expect.stringMatching(/nicht vertrauenswürdig/))
  })

  it('accepts a trusted project key in another slash/case spelling and a BOM in .claude.json (Windows)', async () => {
    const { cfg, home } = await setup({ trust: false })
    const { writeFile: wf } = await import('node:fs/promises')
    const altKey = cfg.repoRoot.replace(/\//g, '\\').toUpperCase()
    await wf(join(home, '.claude.json'), '﻿' + JSON.stringify({ projects: { [altKey]: { hasTrustDialogAccepted: true } } }), 'utf8')
    const r = await preflight(cfg, deps(home))
    expect(r.problems).toEqual([])
  })

  it('requires an existing vault folder', async () => {
    const { cfg, home } = await setup({ vault: false })
    const r = await preflight(cfg, deps(home))
    expect(r.problems).toContainEqual(expect.stringMatching(/Vault-Ordner .* nicht gefunden/))
  })

  it('warns (not fails) when .env is missing', async () => {
    const { cfg, home } = await setup({ dotenv: false })
    const r = await preflight(cfg, deps(home))
    expect(r.ok).toBe(true)
    expect(r.warnings).toContainEqual(expect.stringMatching(/Keine \.env gefunden/))
  })

  it('skips the claude checks in fake mode', async () => {
    const { cfg, home } = await setup()
    const exec: PreflightDeps['exec'] = async () => { throw new Error('ENOENT') }
    const r = await preflight({ ...cfg, fakeClaude: true }, deps(home, { exec }))
    expect(r.ok).toBe(true)
    expect(r.claudeVersion).toBeNull()
  })
})
