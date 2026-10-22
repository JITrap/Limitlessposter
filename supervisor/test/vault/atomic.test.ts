import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from '../../src/vault/atomic.js'

describe('writeFileAtomic', () => {
  it('replaces content and leaves no temp file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-atomic-'))
    const file = join(dir, 'note.md')
    await writeFile(file, 'alt', 'utf8')
    await writeFileAtomic(file, 'neu äöü')
    expect(await readFile(file, 'utf8')).toBe('neu äöü')
    expect(await readdir(dir)).toEqual(['note.md'])
  })

  it('creates the file when it does not exist yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'los-atomic-'))
    const file = join(dir, 'fresh.md')
    await writeFileAtomic(file, 'x')
    expect(await readFile(file, 'utf8')).toBe('x')
  })
})
