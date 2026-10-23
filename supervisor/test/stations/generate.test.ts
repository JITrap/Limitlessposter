import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateClaudeFiles, GENERATED_MARKER } from '../../src/stations/generate.js'
import type { Station } from '../../src/stations/loader.js'

describe('generateClaudeFiles', () => {
  let repo: string
  let st: Station

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'los-gen-'))
    await mkdir(join(repo, 'stations', 'content'), { recursive: true })
    await writeFile(join(repo, 'stations', 'content', 'SKILL.md'), '# Rolle\nDu schreibst Posts.\n', 'utf8')
    st = {
      name: 'content',
      display: 'Content-Studio',
      description: 'Plant und schreibt Posts.',
      tier: 'standard',
      maxTurns: 40,
      timeoutMin: 25,
      tools: ['Read', 'Write', 'mcp__metricool__*'],
      context: [],
      requires: { mcp: ['metricool'], env: [], services: [], any: [] },
      autopilot: 1,
      cooldownHours: 0,
      outputsDir: null,
      dir: join(repo, 'stations', 'content'),
      skillPath: join(repo, 'stations', 'content', 'SKILL.md'),
    }
  })

  it('writes a skill and an agent file with the expected frontmatter', async () => {
    const written = await generateClaudeFiles([st], repo)
    expect(written.sort()).toEqual(
      [join(repo, '.claude', 'skills', 'content', 'SKILL.md'), join(repo, '.claude', 'agents', 'content.md')].sort(),
    )
    const skill = await readFile(join(repo, '.claude', 'skills', 'content', 'SKILL.md'), 'utf8')
    expect(skill).toContain(GENERATED_MARKER.replace('<name>', 'content'))
    expect(skill).toMatch(/^---\nname: content\ndescription: Plant und schreibt Posts\.\nallowed-tools: Read, Write, mcp__metricool__\*\n---\n/)
    expect(skill).toContain('Du schreibst Posts.')

    const agent = await readFile(join(repo, '.claude', 'agents', 'content.md'), 'utf8')
    expect(agent).toMatch(/^---\nname: content\ndescription: Plant und schreibt Posts\.\nmodel: sonnet\ntools: Read, Write, mcp__metricool__\*\nmaxTurns: 40\n---\n/)
    expect(agent).toContain('stations/content/SKILL.md')
  })

  it('maps tiers to models for the agent file', async () => {
    const cheap = { ...st, name: 'reviewer', tier: 'cheap' as const }
    const premium = { ...st, name: 'planer', tier: 'premium' as const }
    await generateClaudeFiles([cheap, premium], repo)
    expect(await readFile(join(repo, '.claude', 'agents', 'reviewer.md'), 'utf8')).toContain('model: haiku')
    expect(await readFile(join(repo, '.claude', 'agents', 'planer.md'), 'utf8')).toContain('model: opus')
  })

  it('refuses to overwrite a skill file it did not generate', async () => {
    await mkdir(join(repo, '.claude', 'skills', 'content'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'content', 'SKILL.md'), '# Von Hand geschrieben\n', 'utf8')
    await expect(generateClaudeFiles([st], repo)).rejects.toThrow(/nicht generiert|von Hand/)
  })

  it('is idempotent: a second run reports no written files', async () => {
    await generateClaudeFiles([st], repo)
    expect(await generateClaudeFiles([st], repo)).toEqual([])
  })
})
