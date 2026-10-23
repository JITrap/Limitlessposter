import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadStations, checkAvailability, type Station } from '../../src/stations/loader.js'

const MINIMAL = `name: content
display: Content-Studio
description: Schreibt Posts.
tier: standard
`

const FULL = `name: shop-analyst
display: Shop-Büro
description: Analysiert den Shop.
tier: standard
max_turns: 30
timeout_min: 15
tools:
  - Read
  - Bash(node supervisor/dist/adapters/shopify.js *)
context:
  - Marke/Produkte.md
requires:
  mcp: [metricool]
  env: [SHOPIFY_CLIENT_ID]
  services: [http://127.0.0.1:8188/system_stats]
autopilot: 2
cooldown_hours: 6
outputs_dir: Assets/shop
`

describe('loadStations', () => {
  let repo: string

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'los-stations-'))
    await mkdir(join(repo, 'stations'))
  })

  async function station(name: string, yaml: string, skill = '# Skill\n'): Promise<void> {
    await mkdir(join(repo, 'stations', name), { recursive: true })
    await writeFile(join(repo, 'stations', name, 'station.yaml'), yaml, 'utf8')
    await writeFile(join(repo, 'stations', name, 'SKILL.md'), skill, 'utf8')
  }

  it('applies defaults to a minimal station', async () => {
    await station('content', MINIMAL)
    const [st] = await loadStations(repo)
    expect(st).toMatchObject({
      name: 'content',
      display: 'Content-Studio',
      tier: 'standard',
      maxTurns: 40,
      timeoutMin: 25,
      tools: [],
      context: [],
      requires: { mcp: [], env: [], services: [], any: [] },
      autopilot: 1,
      cooldownHours: 0,
      outputsDir: null,
      dir: join(repo, 'stations', 'content'),
      skillPath: join(repo, 'stations', 'content', 'SKILL.md'),
    })
  })

  it('reads every field of a full station', async () => {
    await station('shop-analyst', FULL)
    const [st] = await loadStations(repo)
    expect(st).toMatchObject({
      maxTurns: 30,
      timeoutMin: 15,
      tools: ['Read', 'Bash(node supervisor/dist/adapters/shopify.js *)'],
      context: ['Marke/Produkte.md'],
      requires: { mcp: ['metricool'], env: ['SHOPIFY_CLIENT_ID'], services: ['http://127.0.0.1:8188/system_stats'], any: [] },
      autopilot: 2,
      cooldownHours: 6,
      outputsDir: 'Assets/shop',
    })
  })

  it('parses requires.any as alternative requirement sets and drops empty ones', async () => {
    await station(
      'shop-analyst',
      FULL.replace('  services: [http://127.0.0.1:8188/system_stats]\n', '  services: [http://127.0.0.1:8188/system_stats]\n  any:\n    - mcp: [shopify]\n    - env: [SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET]\n    - {}\n'),
    )
    const [st] = await loadStations(repo)
    expect(st.requires.any).toEqual([
      { mcp: ['shopify'], env: [], services: [] },
      { mcp: [], env: ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'], services: [] },
    ])
  })

  it('sorts stations by name and skips folders without station.yaml', async () => {
    await station('zeta', MINIMAL.replace('content', 'zeta'))
    await station('alpha', MINIMAL.replace('content', 'alpha'))
    await mkdir(join(repo, 'stations', 'leer'))
    const names = (await loadStations(repo)).map((s) => s.name)
    expect(names).toEqual(['alpha', 'zeta'])
  })

  it('throws a German error naming file and key when tier is missing', async () => {
    await station('kaputt', 'name: kaputt\ndisplay: X\ndescription: Y\n')
    await expect(loadStations(repo)).rejects.toThrow(/stations[\\/]kaputt[\\/]station\.yaml.*tier/)
  })

  it('throws when the folder name and the name field differ', async () => {
    await station('ordner', MINIMAL)
    await expect(loadStations(repo)).rejects.toThrow(/ordner.*content/)
  })

  it('throws when SKILL.md is missing', async () => {
    await mkdir(join(repo, 'stations', 'ohne'), { recursive: true })
    await writeFile(join(repo, 'stations', 'ohne', 'station.yaml'), MINIMAL.replace('content', 'ohne'), 'utf8')
    await expect(loadStations(repo)).rejects.toThrow(/SKILL\.md/)
  })

  it('returns an empty list when stations/ does not exist', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'los-nostations-'))
    expect(await loadStations(empty)).toEqual([])
  })
})

describe('checkAvailability', () => {
  const base: Station = {
    name: 'x',
    display: 'X',
    description: '',
    tier: 'cheap',
    maxTurns: 40,
    timeoutMin: 25,
    tools: [],
    context: [],
    requires: { mcp: [], env: [], services: [], any: [] },
    autopilot: 2,
    cooldownHours: 0,
    outputsDir: null,
    dir: '/r/stations/x',
    skillPath: '/r/stations/x/SKILL.md',
  }
  const probes = { http: async (url: string) => url.includes('8188'), mcpConfigured: async (name: string) => name === 'metricool' }

  it('is available when nothing is required', async () => {
    expect(await checkAvailability(base, {}, probes)).toEqual({ available: true, reason: null })
  })

  it('names the missing environment variable', async () => {
    const st = { ...base, requires: { mcp: [], env: ['SHOPIFY_CLIENT_ID'], services: [], any: [] } }
    expect(await checkAvailability(st, { SHOPIFY_CLIENT_ID: '' }, probes)).toEqual({
      available: false,
      reason: 'Umgebungsvariable SHOPIFY_CLIENT_ID fehlt',
    })
    expect(await checkAvailability(st, { SHOPIFY_CLIENT_ID: 'abc' }, probes)).toEqual({ available: true, reason: null })
  })

  it('names the unreachable service', async () => {
    const st = { ...base, requires: { mcp: [], env: [], services: ['http://127.0.0.1:3900/health'], any: [] } }
    expect(await checkAvailability(st, {}, probes)).toEqual({
      available: false,
      reason: 'Dienst http://127.0.0.1:3900/health nicht erreichbar',
    })
  })

  it('names the missing MCP server', async () => {
    const st = { ...base, requires: { mcp: ['voicestudio'], env: [], services: [], any: [] } }
    expect(await checkAvailability(st, {}, probes)).toEqual({
      available: false,
      reason: 'MCP-Server voicestudio nicht eingerichtet',
    })
  })

  it('accepts alternatives in requires.any: one satisfied set is enough', async () => {
    const st = {
      ...base,
      requires: { mcp: [], env: [], services: [], any: [{ mcp: ['shopify'], env: [], services: [] }, { mcp: [], env: ['SHOPIFY_CLIENT_ID'], services: [] }] },
    }
    // neither: both problems named, so Julius sees every option
    expect(await checkAvailability(st, {}, probes)).toEqual({
      available: false,
      reason: 'MCP-Server shopify nicht eingerichtet oder Umgebungsvariable SHOPIFY_CLIENT_ID fehlt (eine Anbindung reicht)',
    })
    // second alternative holds
    expect(await checkAvailability(st, { SHOPIFY_CLIENT_ID: 'abc' }, probes)).toEqual({ available: true, reason: null })
    // first alternative holds
    const withShopify = { ...probes, mcpConfigured: async (name: string) => name === 'shopify' }
    expect(await checkAvailability(st, {}, withShopify)).toEqual({ available: true, reason: null })
  })

  it('checks hard requirements before the alternatives', async () => {
    const st = { ...base, requires: { mcp: ['metricool'], env: ['A'], services: [], any: [{ mcp: ['shopify'], env: [], services: [] }] } }
    expect((await checkAvailability(st, {}, probes)).reason).toBe('Umgebungsvariable A fehlt')
  })

  it('reports the first problem only, in the order env → mcp → services', async () => {
    const st = { ...base, requires: { mcp: ['nope'], env: ['A'], services: ['http://x'], any: [] } }
    const r = await checkAvailability(st, {}, probes)
    expect(r.reason).toBe('Umgebungsvariable A fehlt')
  })
})
