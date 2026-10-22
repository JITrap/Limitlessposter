import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const supervisorDir = join(here, '..')
const repoRoot = join(supervisorDir, '..')

function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(supervisorDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(supervisorDir, 'src', 'index.ts'), ...args], {
      cwd: repoRoot,
      env,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (c: Buffer) => (out += c.toString()))
    child.stderr.on('data', (c: Buffer) => (err += c.toString()))
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

describe('entry point --smoke (FAKE_CLAUDE)', () => {
  it('runs one fake worker end to end, writes a ledger entry and exits 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-smoke-'))
    const home = join(root, 'home')
    const vault = join(root, 'MeinVault', 'LimitlessOS')
    const dataDir = join(root, 'data')
    await mkdir(home, { recursive: true })
    await cp(join(repoRoot, 'vault-template', 'LimitlessOS'), vault, { recursive: true })
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { [repoRoot]: { hasTrustDialogAccepted: true } } }), 'utf8')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      FAKE_CLAUDE: '1',
      FAKE_CLAUDE_FIXTURE: join(supervisorDir, 'test', 'fixtures', 'stream', 'success.jsonl'),
      LIMITLESS_VAULT_ROOT: vault,
      LIMITLESS_DATA_DIR: dataDir,
    }
    delete env.ANTHROPIC_API_KEY
    const res = await run(['--smoke'], env)
    expect(res.err).toBe('')
    expect(res.code).toBe(0)
    expect(res.out).toMatch(/Rauch-Test: (done|review)/)
    // A smoke run keeps its own data dir so it never touches the live supervisor's state/ledger.
    const ledger = (await readFile(join(dataDir, 'smoke', 'ledger.jsonl'), 'utf8')).trim().split('\n')
    expect(ledger).toHaveLength(1)
    expect(JSON.parse(ledger[0])).toMatchObject({ station: 'reviewer', result: 'success' })
    const status = await readFile(join(vault, 'Status.md'), 'utf8')
    expect(status).toContain('## Budget')
  }, 60_000)

  it('exits 1 with the German problems when the preflight fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-smoke-'))
    const home = join(root, 'home')
    await mkdir(home, { recursive: true }) // no .claude.json → repo not trusted
    const vault = join(root, 'V', 'LimitlessOS')
    await mkdir(vault, { recursive: true })
    const res = await run(['--smoke'], { ...process.env, HOME: home, USERPROFILE: home, FAKE_CLAUDE: '1', LIMITLESS_VAULT_ROOT: vault, LIMITLESS_DATA_DIR: join(root, 'data') })
    expect(res.code).toBe(1)
    expect(res.err).toMatch(/nicht vertrauenswürdig/)
  }, 60_000)
})
