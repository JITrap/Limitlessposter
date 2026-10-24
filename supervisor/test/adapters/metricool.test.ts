import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authFrom, gateReason, listScheduled, postType, schedule, type FetchLike, type ScheduledPost } from '../../src/adapters/metricool.js'
import { loadPublog, savePublog, toEntry } from '../../src/publog.js'
import { DEFAULT_LIMITS } from '../../src/limits.js'

const now = new Date('2026-10-24T18:00:00')
const auth = { apiKey: 'k', userId: '5759175', blogId: '7412016', timezone: 'Europe/Berlin' }
const openEnv = { LIMITLESS_PUBLISH_ALLOWED: '1', LIMITLESS_ALLOW_WRITES: '1', LIMITLESS_GATED: '0' }

function fakeFetch(reply: unknown, calls: Array<{ url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }>): FetchLike {
  return async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) }
  }
}

const post: ScheduledPost = {
  text: 'Drei Regeln für die Bilderwand im Flur: Kante, Abstand, Licht. Welche fehlt bei dir? #bilderwand',
  media: ['https://cdn.shopify.com/s/files/1/x/files/limitlessos-cb-neu.mp4'],
  providers: [{ network: 'instagram' }],
  publicationDate: { dateTime: '2026-10-25T18:30:00', timezone: 'Europe/Berlin' },
  autoPublish: true,
  instagramData: { type: 'REEL', isAiGenerated: true },
}

async function vault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-'))
  await mkdir(join(dir, 'Pläne'), { recursive: true })
  await savePublog(dir, {
    synced: '2026-10-24T17:00:00',
    entries: [
      toEntry({ network: 'instagram', date: '2026-10-12T15:12', text: 'Willkommen bei LimitlessPoster 🖤 Gerahmte Poster mit Haltung. #poster', url: 'https://www.instagram.com/p/DeZhypQCnu1/' }),
      toEntry({ network: 'instagram', date: '2026-10-25T12:00', text: 'eins', status: 'geplant' }),
      toEntry({ network: 'instagram', date: '2026-10-25T13:00', text: 'zwei', status: 'geplant' }),
    ],
  })
  return dir
}

describe('metricool adapter – the hard guard', () => {
  it('refuses while the supervisor gated the run', async () => {
    const calls: never[] = []
    const r = await schedule(post, { vaultRoot: await vault(), limits: DEFAULT_LIMITS, env: { ...openEnv, LIMITLESS_GATED: '1' }, auth, fetchFn: fakeFetch({}, calls), now, quelle: 't', dryRun: false })
    expect(r.code).toBe(4)
    expect(calls).toHaveLength(0)
    expect(gateReason({ LIMITLESS_PUBLISH_ALLOWED: '0' })).toMatch(/Tageslimit/)
    expect(gateReason(openEnv)).toBeNull()
  })
  it('refuses a duplicate without calling Metricool', async () => {
    const calls: never[] = []
    const dup = { ...post, text: 'Willkommen bei LimitlessPoster. 🖤 Gerahmte Poster mit Haltung – Motivation, Sport. #neu' }
    const r = await schedule(dup, { vaultRoot: await vault(), limits: DEFAULT_LIMITS, env: openEnv, auth, fetchFn: fakeFetch({}, calls), now, quelle: 't', dryRun: false })
    expect(r.code).toBe(2)
    expect(r.result.dublette).toBe(true)
    expect(calls).toHaveLength(0)
  })
  it('refuses when the network quota for that day is full', async () => {
    const calls: never[] = []
    const r = await schedule(post, { vaultRoot: await vault(), limits: { ...DEFAULT_LIMITS, instagram: 2 }, env: openEnv, auth, fetchFn: fakeFetch({}, calls), now, quelle: 't', dryRun: false })
    expect(r.code).toBe(3)
    expect(r.result.genutzt).toBe(2)
    expect(calls).toHaveLength(0)
  })
  it('dry-run checks only', async () => {
    const calls: never[] = []
    const r = await schedule(post, { vaultRoot: await vault(), limits: DEFAULT_LIMITS, env: openEnv, auth, fetchFn: fakeFetch({}, calls), now, quelle: 't', dryRun: true })
    expect(r.code).toBe(0)
    expect(r.result.dryRun).toBe(true)
    expect(calls).toHaveLength(0)
  })
  it('needs the API key to actually post', async () => {
    const r = await schedule(post, { vaultRoot: await vault(), limits: DEFAULT_LIMITS, env: openEnv, auth: null, fetchFn: fakeFetch({}, []), now, quelle: 't', dryRun: false })
    expect(r.code).toBe(1)
    expect(String(r.result.fehler)).toMatch(/METRICOOL_API_KEY/)
  })
  it('posts with the key header and records the post in the list', async () => {
    const calls: Array<{ url: string; init?: { method?: string; body?: string; headers?: Record<string, string> } }> = []
    const dir = await vault()
    const r = await schedule(post, { vaultRoot: dir, limits: DEFAULT_LIMITS, env: openEnv, auth, fetchFn: fakeFetch({ data: { id: 1, uuid: 'u-1', plannerUrl: 'https://app.metricool.com/planner/calendar?blogId=7412016&openWithPostUuid=u-1' } }, calls), now, quelle: 'content:task-1', dryRun: false })
    expect(r.code).toBe(0)
    expect(r.result.plannerUrl).toContain('u-1')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/v2/scheduler/posts?')
    expect(calls[0].url).toContain('blogId=7412016')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers?.['X-Mc-Auth']).toBe('k')
    const body = JSON.parse(calls[0].init!.body!) as ScheduledPost
    expect(body.draft).toBe(false)
    expect(body.providers).toEqual([{ network: 'instagram' }])
    const log = await loadPublog(dir)
    const row = log.entries.find((e) => e.quelle === 'content:task-1')
    expect(row).toMatchObject({ network: 'instagram', type: 'reel', status: 'geplant', date: '2026-10-25T18:30' })
    expect(row?.media).toEqual(['limitlessos-cb-neu.mp4'])
    // the second attempt with the same text is now a duplicate
    const again = await schedule(post, { vaultRoot: dir, limits: DEFAULT_LIMITS, env: openEnv, auth, fetchFn: fakeFetch({}, calls), now, quelle: 'content:task-2', dryRun: false })
    expect(again.code).toBe(2)
  })
  it('helpers: auth from env, type detection, scheduled list unwrap', async () => {
    expect(authFrom({ METRICOOL_API_KEY: 'k', METRICOOL_USER_ID: '1' }, { blogId: '7412016' })?.blogId).toBe('7412016')
    expect(authFrom({ METRICOOL_USER_ID: '1' })).toBeNull()
    expect(postType({ ...post, instagramData: { type: 'POST' } }, 'instagram')).toBe('post')
    expect(postType({ media: ['a.jpg'] }, 'tiktok')).toBe('photos')
    expect(postType({ media: ['a.mp4'] }, 'tiktok')).toBe('video')
    const calls: Array<{ url: string }> = []
    const list = await listScheduled(auth, '2026-10-24', '2026-10-30', fakeFetch({ data: [{ id: 5, uuid: 'x' }] }, calls))
    expect(list).toHaveLength(1)
    expect(calls[0].url).toContain('start=2026-10-24T00%3A00%3A00')
  })
})
