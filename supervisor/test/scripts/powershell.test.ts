import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPTS = ['scripts/install.ps1', 'scripts/doctor.ps1', 'scripts/bootstrap.ps1', 'scripts/update.ps1']

describe('PowerShell scripts (Windows PowerShell 5.1 compatibility)', () => {
  it('start with a UTF-8 BOM so PS 5.1 does not read them as Windows-1252', async () => {
    for (const s of SCRIPTS) {
      const buf = await readFile(join(repoRoot, s))
      expect(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `${s} hat keine BOM`).toBe(true)
    }
  })

  it('never write JSON or notes with Set-Content -Encoding UTF8 (that adds a BOM Node cannot parse)', async () => {
    for (const s of SCRIPTS) {
      const text = await readFile(join(repoRoot, s), 'utf8')
      expect(text, `${s} nutzt Set-Content -Encoding UTF8`).not.toMatch(/Set-Content[^\n]*-Encoding UTF8/)
    }
  })

  it('install.ps1 trusts the repo under both slash spellings and runs claude auth status safely', async () => {
    const text = await readFile(join(repoRoot, 'scripts/install.ps1'), 'utf8')
    expect(text).toContain("Replace('\\', '/')")
    expect(text).toMatch(/try\s*\{[^}]*claude auth status/s)
    expect(text).toContain('-CommandType Application')
  })

  it('install.ps1 signs in to Claude and both MCP servers from the shell and finds the vault via obsidian.json', async () => {
    const text = await readFile(join(repoRoot, 'scripts/install.ps1'), 'utf8')
    expect(text).toContain('claude auth login')
    expect(text).toMatch(/claude mcp login \$srv\.Name/)
    expect(text).toContain('"metricool"')
    expect(text).toContain('"shopify"')
    expect(text).toContain('obsidian\\obsidian.json')
    expect(text).not.toContain('Start-Process notepad')
  })

  it('bootstrap.ps1 keeps .env and data when re-running and never needs git', async () => {
    const text = await readFile(join(repoRoot, 'scripts/bootstrap.ps1'), 'utf8')
    expect(text).toContain('robocopy')
    expect(text).toContain('/XF ".env" "limitless.config.json"')
    expect(text).toContain('"node_modules" "data"')
    expect(text).toContain('Unblock-File')
    expect(text).toContain('archive/refs/heads/')
    expect(text).not.toMatch(/\bgit clone\b/)
  })

  it('update.ps1 keeps local config and live vault data, replaces only system notes with a backup', async () => {
    const text = await readFile(join(repoRoot, 'scripts/update.ps1'), 'utf8')
    expect(text).toContain('/XD "node_modules" "data" ".git" /XF ".env" "limitless.config.json"')
    expect(text).toContain('git -C $Source pull --ff-only')
    expect(text).toContain('npm run build:stations')
    // replaced (with backup): brand notes, Home, Strategie, Content-Bank – never the live lists
    expect(text).toMatch(/\$overwrite = @\([^)]*"Strategie\.md"[^)]*"Pläne\\Content-Bank\.md"/s)
    expect(text).not.toMatch(/\$overwrite = @\([^)]*Veröffentlicht/s)
    expect(text).not.toMatch(/\$overwrite = @\([^)]*Produkte\.md/s)
    expect(text).not.toMatch(/\$overwrite = @\([^)]*Status\.md/s)
    expect(text).toContain('Copy-Item $dest $bak -Force')
    expect(text).not.toMatch(/Remove-Item|rm -r/)
  })
})
