import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStations } from '../../src/stations/loader.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const EXPECTED: Record<string, { tier: string; autopilot: number }> = {
  planer: { tier: 'standard', autopilot: 2 },
  content: { tier: 'standard', autopilot: 1 },
  'shop-analyst': { tier: 'standard', autopilot: 1 },
  studio: { tier: 'cheap', autopilot: 2 },
  reviewer: { tier: 'cheap', autopilot: 2 },
  berichter: { tier: 'cheap', autopilot: 2 },
}

describe('real stations/ folder', () => {
  it('loads the six core stations with the planned tiers and autopilot levels', async () => {
    const stations = await loadStations(repoRoot)
    const byName = Object.fromEntries(stations.map((s) => [s.name, s]))
    for (const [name, exp] of Object.entries(EXPECTED)) {
      expect(byName[name], `Station ${name} fehlt`).toBeDefined()
      expect(byName[name].tier).toBe(exp.tier)
      expect(byName[name].autopilot).toBe(exp.autopilot)
      expect(byName[name].tools.length).toBeGreaterThan(0)
    }
  })

  it('keeps every SKILL.md German, short and with the shared outline', async () => {
    const stations = await loadStations(repoRoot)
    for (const st of stations) {
      const text = await readFile(st.skillPath, 'utf8')
      const lines = text.split('\n').length
      expect(lines, `${st.name}/SKILL.md hat ${lines} Zeilen`).toBeLessThanOrEqual(160)
      for (const h of ['## Rolle', '## Eingaben', '## Vorgehen', '## Ausgabeformat', '## Qualitätsregeln', '## Verbote']) {
        expect(text, `${st.name}/SKILL.md fehlt ${h}`).toContain(h)
      }
    }
  })

  it('ships an example task per station', async () => {
    for (const name of Object.keys(EXPECTED)) {
      await access(join(repoRoot, 'stations', name, 'examples', 'beispiel.md'))
    }
  })

  // Activates once the vault template (Task 18) exists.
  it.skipIf(!existsSync(join(repoRoot, 'vault-template', 'LimitlessOS', 'Home.md')))('every context note exists in the vault template', async () => {
    const stations = await loadStations(repoRoot)
    for (const st of stations) {
      for (const rel of st.context) {
        await access(join(repoRoot, 'vault-template', 'LimitlessOS', rel))
      }
    }
  })

  it('worker rules and settings exist', async () => {
    const claudeMd = await readFile(join(repoRoot, '.claude', 'CLAUDE.md'), 'utf8')
    expect(claudeMd.split('\n').length).toBeLessThanOrEqual(120)
    expect(claudeMd).toContain('LimitlessOS')
    const settings = JSON.parse(await readFile(join(repoRoot, '.claude', 'settings.json'), 'utf8')) as { enableAllProjectMcpServers?: boolean; permissions?: { deny?: string[] } }
    expect(settings.enableAllProjectMcpServers).toBe(true)
    expect(settings.permissions?.deny).toContain('Bash(git push*)')
  })
})
