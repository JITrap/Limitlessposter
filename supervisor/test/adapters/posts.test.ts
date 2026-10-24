import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/adapters/posts.js'

const now = new Date('2026-10-24T18:00:00')

async function run(argv: string[], vaultRoot: string): Promise<{ code: number; out: Record<string, unknown> }> {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((l: string) => { lines.push(String(l)) })
  try {
    const code = await main(argv, { LIMITLESS_VAULT_ROOT: vaultRoot }, now, join(vaultRoot, 'no-repo'))
    return { code, out: JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown> }
  } finally {
    spy.mockRestore()
  }
}

describe('posts.js CLI', () => {
  it('sync → check → add → today round trip', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'posts-'))
    const file = join(vault, 'sync.json')
    await writeFile(file, JSON.stringify([
      { network: 'instagram', date: '20261012151251', type: 'post', status: 'veröffentlicht', text: 'Willkommen bei LimitlessPoster 🖤 Gerahmte Poster mit Haltung. #poster', url: 'https://www.instagram.com/p/a/' },
      { network: 'instagram', date: '2026-10-24T12:00', type: 'post', status: 'geplant', text: 'Heute schon eingeplant', url: 'https://app.metricool.com/x?openWithPostUuid=1' },
    ]))
    const s = await run(['sync', '--file', file], vault)
    expect(s.code).toBe(0)
    expect(s.out.eintraege).toBe(2)
    expect(s.out.synced).toBe('2026-10-24T18:00:00')

    const dup = await run(['check', '--network', 'instagram', '--text', 'Willkommen bei LimitlessPoster. 🖤 Gerahmte Poster mit Haltung – neu'], vault)
    expect(dup.code).toBe(2)
    expect((dup.out.treffer as { link: string }).link).toBe('https://www.instagram.com/p/a/')

    const ok = await run(['check', '--network', 'instagram', '--text', 'Bilderwand im Flur: drei Regeln, die jeder vergisst', '--day', '2026-10-24'], vault)
    expect(ok.code).toBe(0)

    const added = await run(['add', '--network', 'tiktok', '--date', '2026-10-24T19:00', '--type', 'video', '--status', 'geplant', '--text', 'Lies es nochmal. 👀', '--url', 'https://app.metricool.com/x?openWithPostUuid=2', '--quelle', 'content:t1'], vault)
    expect(added.code).toBe(0)
    expect(added.out.hinzugefuegt).toBe(1)

    const today = await run(['today', '--day', '2026-10-24'], vault)
    expect(today.code).toBe(0)
    const n = today.out.netzwerke as Record<string, { genutzt: number; limit: number }>
    expect(n.instagram.genutzt).toBe(1)
    expect(n.tiktok.genutzt).toBe(1)
    expect(n.instagram.limit).toBe(4)

    const full = await run(['check', '--network', 'linkedin', '--text', 'LinkedIn Text völlig neu', '--day', '2026-10-24'], vault)
    expect(full.code).toBe(0)
    await run(['add', '--network', 'linkedin', '--date', '2026-10-24T09:00', '--text', 'LinkedIn Beitrag eins heute', '--status', 'geplant'], vault)
    const blocked = await run(['check', '--network', 'linkedin', '--text', 'LinkedIn Text völlig neu zwei', '--day', '2026-10-24'], vault)
    expect(blocked.code).toBe(3)
  })
  it('fails loudly without arguments', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'posts-'))
    expect((await run(['check'], vault)).code).toBe(1)
    expect((await run(['status'], vault)).out.eintraege).toBe(0)
  })
})
