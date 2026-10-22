import { describe, it, expect } from 'vitest'
import {
  parseNote,
  stringifyNote,
  readSection,
  upsertSection,
  appendLine,
  SECTIONS,
} from '../../src/vault/frontmatter.js'

describe('frontmatter', () => {
  it('round-trips umlauts, colons and quotes', () => {
    const data = {
      type: 'task',
      title: 'Karussell: „Ein Poster, 5 Räume“ für Instagram',
      due: '2026-10-25',
      completed: null,
      outputs: [],
      priority: 2,
    }
    const out = stringifyNote(data, '## Auftrag\nText\n')
    expect(out.startsWith('---\n')).toBe(true)
    expect(out).toContain('completed:\n') // empty, not "null"
    expect(out).toContain('due: 2026-10-25') // unquoted date string
    expect(out).toContain('priority: 2')
    expect(out.endsWith('## Auftrag\nText\n')).toBe(true)
    const parsed = parseNote(out)
    expect(parsed.data).toEqual(data)
    expect(parsed.body).toBe('## Auftrag\nText\n')
  })

  it('parseNote without frontmatter returns empty data and full body', () => {
    const parsed = parseNote('# Nur Text\n\nHallo\n')
    expect(parsed.data).toEqual({})
    expect(parsed.body).toBe('# Nur Text\n\nHallo\n')
  })

  it('parseNote keeps a later --- line in the body', () => {
    const text = '---\ntype: task\n---\nA\n\n---\n\nB\n'
    const parsed = parseNote(text)
    expect(parsed.data).toEqual({ type: 'task' })
    expect(parsed.body).toBe('A\n\n---\n\nB\n')
  })

  it('keeps nested list values and booleans', () => {
    const data = { tags: ['task', 'automation'], needs_approval: true, model_used: null }
    const out = stringifyNote(data, '')
    expect(parseNote(out).data).toEqual(data)
  })

  it('exports the five fixed section headings in order', () => {
    expect(SECTIONS).toEqual(['Auftrag', 'Kontext', 'Ergebnis', 'Protokoll', 'Offene Fragen an Julius'])
  })
})

describe('sections', () => {
  const body = '## Auftrag\nA\n\n## Protokoll\n- x\n'

  it('readSection returns the trimmed content of a section', () => {
    expect(readSection(body, 'Auftrag')).toBe('A')
    expect(readSection(body, 'Protokoll')).toBe('- x')
  })

  it('readSection returns null for a missing section', () => {
    expect(readSection(body, 'Ergebnis')).toBeNull()
  })

  it('readSection does not match ### sub-headings as section boundaries', () => {
    const b = '## Ergebnis\n### Instagram\nText\n\n## Protokoll\n- x\n'
    expect(readSection(b, 'Ergebnis')).toBe('### Instagram\nText')
  })

  it('upsertSection appends a missing section at the end', () => {
    const out = upsertSection(body, 'Ergebnis', 'E')
    expect(out).toMatch(/## Ergebnis\nE\n$/)
    expect(readSection(out, 'Auftrag')).toBe('A')
  })

  it('upsertSection replaces an existing section in place', () => {
    const out = upsertSection(body, 'Auftrag', 'Neu')
    expect(readSection(out, 'Auftrag')).toBe('Neu')
    expect(readSection(out, 'Protokoll')).toBe('- x')
    expect(out.indexOf('## Auftrag')).toBeLessThan(out.indexOf('## Protokoll'))
  })

  it('appendLine adds a line to the end of a section', () => {
    const out = appendLine(body, 'Protokoll', '- y')
    expect(out).toContain('- x\n- y\n')
  })

  it('appendLine creates the section when missing', () => {
    const out = appendLine(body, 'Ergebnis', 'Zeile')
    expect(readSection(out, 'Ergebnis')).toBe('Zeile')
  })
})
