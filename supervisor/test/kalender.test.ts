// Soll-Mengen (Strategie.md daily_targets) gegen die Veröffentlichungs-Liste und die Aufgaben in Arbeit.
import { describe, it, expect } from 'vitest'
import { parseTarget, parseTargets, targetFor, loadTargets, DEFAULT_TARGETS } from '../src/limits.js'
import { contentTaskTarget, inArbeitProTag, sollFuerTag, lueckenText, fehlenGesamt } from '../src/kalender.js'
import { toEntry } from '../src/publog.js'
import type { Task } from '../src/types.js'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const task = (title: string, over: Partial<Task['fm']> = {}): Task =>
  ({ fm: { id: 'x', title, station: 'content', status: 'todo', due: null, ...over } as Task['fm'], body: '', path: '' }) as Task

describe('daily_targets', () => {
  it('reads counts, weekdays and the autolist flag from the readable note values', () => {
    expect(parseTarget('3 Reels + 1 Karussell + 4 Stories')).toEqual({ count: 8, stories: 4, days: null, autolist: false, verbunden: true, text: '3 Reels + 1 Karussell + 4 Stories' })
    expect(parseTarget('1 Post Mo/Mi/Fr (Autolist)')).toMatchObject({ count: 1, days: [1, 3, 5], autolist: true })
    expect(parseTarget('1 Beitrag Di/Do/Sa')).toMatchObject({ count: 1, days: [2, 4, 6], autolist: false })
    expect(parseTarget(4)).toMatchObject({ count: 4, stories: 0, days: null })
    expect(parseTarget('3 Reels + 1 Post + 4 Stories (Zweitverwertung von Instagram; nur wenn in Metricool verbunden)')).toMatchObject({ count: 8, days: null })
    expect(parseTarget('')).toMatchObject({ count: 0, days: null })
  })

  it('applies the weekday rule per date', () => {
    const t = parseTargets({ instagram: '3 Reels + 1 Karussell', LinkedIn: '1 Post Mo/Mi/Fr (Autolist)' })
    expect(targetFor(t, 'instagram', new Date('2026-10-26T12:00:00'))).toBe(4)
    expect(targetFor(t, 'linkedin', new Date('2026-10-26T12:00:00'))).toBe(1) // Monday
    expect(targetFor(t, 'linkedin', new Date('2026-10-27T12:00:00'))).toBe(0) // Tuesday
    expect(targetFor(t, 'tiktok', new Date('2026-10-27T12:00:00'))).toBe(0)
  })

  it('loads the targets from Strategie.md and falls back to the defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-targets-'))
    expect(await loadTargets(root)).toEqual(DEFAULT_TARGETS)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'Strategie.md'), '---\ntype: strategie\ndaily_targets:\n  instagram: "3 Reels + 1 Karussell + 4 Stories"\n  gmb: "1 Beitrag Di/Do/Sa (Autolist)"\n---\n# S\n', 'utf8')
    const t = await loadTargets(root)
    expect(Object.keys(t)).toEqual(['instagram', 'gmb'])
    expect(t.instagram.count).toBe(8)
    expect(t.gmb).toMatchObject({ count: 1, days: [2, 4, 6], autolist: true })
  })

  it('gives no Soll to networks that Marke/Kanäle.md does not list as connected (Facebook before the link)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'los-targets-'))
    await mkdir(join(root, 'Marke'), { recursive: true })
    await writeFile(join(root, 'Strategie.md'), '---\ntype: strategie\ndaily_targets:\n  instagram: "3 Reels + 1 Karussell"\n  facebook: "3 Reels + 1 Post (nur wenn verbunden)"\n---\n# S\n', 'utf8')
    await writeFile(join(root, 'Marke', 'Kanäle.md'), '---\ntype: marke\nmetricool_netzwerke: [instagram, tiktok, linkedin, gmb]\n---\n# K\n', 'utf8')
    const t = await loadTargets(root)
    expect(t.facebook.verbunden).toBe(false)
    expect(t.instagram.verbunden).toBe(true)
    expect(targetFor(t, 'facebook', new Date('2026-10-26T12:00:00'))).toBe(0)
    expect(targetFor(t, 'instagram', new Date('2026-10-26T12:00:00'))).toBe(4)
  })
})

describe('Kalender-Soll', () => {
  const targets = parseTargets({ instagram: '3 Reels + 1 Karussell', tiktok: '3 Videos + 1 Fotobeitrag', linkedin: '1 Post Mo/Mi/Fr (Autolist)' })
  const entries = [
    toEntry({ network: 'instagram', date: '2026-10-26T12:30', type: 'reel', status: 'geplant', text: 'Reel eins' }),
    toEntry({ network: 'instagram', date: '2026-10-26T16:30', type: 'reel', status: 'entwurf', text: 'Entwurf zählt nicht' }),
    toEntry({ network: 'tiktok', date: '2026-10-26T12:30', type: 'video', status: 'veröffentlicht', text: 'Video eins' }),
    toEntry({ network: 'linkedin', date: '2026-10-26T11:05', type: 'post', status: 'geplant', text: 'Autolist' }),
  ]

  it('reads day and networks from content task titles (fallback: due date)', () => {
    expect(contentTaskTarget(task('Content 2026-10-26 Instagram+TikTok 12:30: T01 – Tiger'))).toEqual({ day: '2026-10-26', networks: ['instagram', 'tiktok'] })
    expect(contentTaskTarget(task('Content 2026-10-26 Instagram 07:30: Karussell – Fokus'))).toEqual({ day: '2026-10-26', networks: ['instagram'] })
    expect(contentTaskTarget(task('Karussell „Ein Poster, 5 Räume“ für Instagram', { due: '2026-10-27' }))).toEqual({ day: '2026-10-27', networks: ['instagram'] })
    // Content-Bank cards name no network – they cover the two main networks
    expect(contentTaskTarget(task('Content-Bank r02: Ab morgen steh ich um 5:30 auf', { due: '2026-10-28' }))).toEqual({ day: '2026-10-28', networks: ['instagram', 'tiktok'] })
    expect(contentTaskTarget(task('Irgendwas', { station: 'studio' }))).toBeNull()
    expect(contentTaskTarget(task('Irgendwas ohne Datum'))).toBeNull()
  })

  it('counts open content tasks per day and network as "in Arbeit"', () => {
    const m = inArbeitProTag([
      task('Content 2026-10-26 Instagram+TikTok 12:30: T01'),
      task('Content 2026-10-26 Instagram 07:30: Karussell', { status: 'review' }),
      task('Content 2026-10-26 Instagram+TikTok 16:30: T02', { status: 'done' }),
    ])
    expect(m.get('2026-10-26')).toEqual({ instagram: 2, tiktok: 1 })
  })

  it('computes Soll/Ist/fehlen per network, ignoring drafts and autolist networks', () => {
    const soll = sollFuerTag(entries, targets, { instagram: 1 }, '2026-10-26', true)
    expect(soll.instagram).toEqual({ soll: 4, ist: 1, inArbeit: 1, autolist: false, fehlen: 2 })
    expect(soll.tiktok).toEqual({ soll: 4, ist: 1, inArbeit: 0, autolist: false, fehlen: 3 })
    expect(soll.linkedin).toEqual({ soll: 1, ist: 1, inArbeit: 0, autolist: true, fehlen: 0 })
    // past days never count as missing
    expect(sollFuerTag(entries, targets, {}, '2026-10-26', false).instagram.fehlen).toBe(0)
    // networks without target and without posts are left out
    expect(sollFuerTag(entries, targets, {}, '2026-10-27', true)).not.toHaveProperty('linkedin')
  })

  it('counts stories against the story share only – one content task in Arbeit covers a post and its story', () => {
    const t = parseTargets({ instagram: '3 Reels + 1 Karussell + 4 Stories' })
    const e = [
      toEntry({ network: 'instagram', date: '2026-10-26T12:30', type: 'reel', status: 'geplant', text: 'Reel eins' }),
      toEntry({ network: 'instagram', date: '2026-10-26T13:00', type: 'story', status: 'geplant', text: '', media: ['https://cdn/x/cover-1.jpg'] }),
    ]
    // 1 reel + 1 story planned, 2 content tasks in Arbeit → posts 4 − 1 − 2 = 1 missing, stories 4 − 1 − 2 = 1 missing
    expect(sollFuerTag(e, t, { instagram: 2 }, '2026-10-26', true).instagram).toEqual({ soll: 8, ist: 2, inArbeit: 2, autolist: false, fehlen: 2 })
    // 4 content tasks in Arbeit cover everything – no gap even though ist is 0
    expect(sollFuerTag([], t, { instagram: 4 }, '2026-10-26', true).instagram.fehlen).toBe(0)
    // 4 posts planned without stories → the 4 stories are still missing
    const posts = ['12:30', '16:30', '20:00', '07:30'].map((z) => toEntry({ network: 'instagram', date: `2026-10-26T${z}`, type: 'reel', status: 'geplant', text: `Reel ${z}` }))
    expect(sollFuerTag(posts, t, {}, '2026-10-26', true).instagram.fehlen).toBe(4)
  })

  it('renders the gap sentence for the planner and sums the total', () => {
    const tage = [
      { datum: '2026-10-26', soll: sollFuerTag(entries, targets, { instagram: 1 }, '2026-10-26', true) },
      { datum: '2026-10-27', soll: sollFuerTag(entries, targets, {}, '2026-10-27', true) },
    ]
    expect(lueckenText(tage)).toBe('Mo 26.10.: instagram 1/4 (+1 in Arbeit), tiktok 1/4 · Di 27.10.: instagram 0/4, tiktok 0/4')
    expect(fehlenGesamt(tage)).toBe(13)
    expect(lueckenText([{ datum: '2026-10-26', soll: { instagram: { soll: 4, ist: 4, inArbeit: 0, autolist: false, fehlen: 0 } } }])).toBe('')
  })
})
