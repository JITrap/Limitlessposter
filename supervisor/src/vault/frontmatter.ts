import { parse, stringify } from 'yaml'

/** Fixed body sections of a task note, in order (spec §4.1). */
export const SECTIONS = ['Auftrag', 'Kontext', 'Ergebnis', 'Protokoll', 'Offene Fragen an Julius'] as const

export type SectionName = (typeof SECTIONS)[number] | string

export interface ParsedNote {
  data: Record<string, unknown>
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Split a note into YAML frontmatter and Markdown body. No frontmatter → `data: {}`. */
export function parseNote(text: string): ParsedNote {
  const m = FRONTMATTER_RE.exec(text)
  if (!m) return { data: {}, body: text }
  const raw = parse(m[1]) as unknown
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { data, body: text.slice(m[0].length) }
}

/**
 * Serialize frontmatter + body. Dates stay plain strings, empty values are
 * written as `key:` (Obsidian style), long strings are never folded.
 */
export function stringifyNote(data: Record<string, unknown>, body: string): string {
  const yamlText = stringify(data, {
    nullStr: '',
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  })
  // `yaml` renders `key: ` with a trailing space for null; Obsidian writes `key:`.
  const cleaned = yamlText.replace(/^([^\s:][^:]*):[ \t]+$/gm, '$1:')
  return `---\n${cleaned}---\n${body}`
}

interface SectionSpan {
  start: number
  contentStart: number
  end: number
}

function findSection(body: string, heading: string): SectionSpan | null {
  const lines = body.split('\n')
  const headingLine = `## ${heading}`
  let offset = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimEnd() === headingLine) {
      const start = offset
      const contentStart = offset + line.length + 1
      let end = body.length
      let cursor = contentStart
      for (let j = i + 1; j < lines.length; j++) {
        if (/^## /.test(lines[j])) {
          end = cursor
          break
        }
        cursor += lines[j].length + 1
      }
      return { start, contentStart, end: Math.min(end, body.length) }
    }
    offset += line.length + 1
  }
  return null
}

/** Content between `## <heading>` and the next `## ` heading, trimmed; null when missing. */
export function readSection(body: string, heading: string): string | null {
  const span = findSection(body, heading)
  if (!span) return null
  return body.slice(span.contentStart, span.end).trim()
}

/** Replace a section's content, or append the section at the end when missing. */
export function upsertSection(body: string, heading: string, content: string): string {
  const block = `## ${heading}\n${content.replace(/\s+$/, '')}\n`
  const span = findSection(body, heading)
  if (!span) {
    const base = body.length === 0 ? '' : body.replace(/\s+$/, '') + '\n\n'
    return base + block
  }
  const before = body.slice(0, span.start)
  const after = body.slice(span.end)
  const separator = after.length > 0 && !after.startsWith('\n') ? '\n' : ''
  return before + block + separator + after
}

/** Append one line to the end of a section, creating the section when missing. */
export function appendLine(body: string, heading: string, line: string): string {
  const current = readSection(body, heading)
  if (current === null) return upsertSection(body, heading, line)
  const next = current.length === 0 ? line : `${current}\n${line}`
  return upsertSection(body, heading, next)
}
