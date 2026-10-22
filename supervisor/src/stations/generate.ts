import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Station } from './loader.js'

/** Marker line; the generator only overwrites files that carry it. */
export const GENERATED_MARKER = '<!-- generated from stations/<name> – nicht von Hand ändern -->'

const MODEL_BY_TIER = { cheap: 'haiku', standard: 'sonnet', premium: 'opus' } as const

function skillFile(st: Station, body: string): string {
  const fm = [`name: ${st.name}`, `description: ${st.description}`]
  if (st.tools.length) fm.push(`allowed-tools: ${st.tools.join(', ')}`)
  return `---\n${fm.join('\n')}\n---\n${GENERATED_MARKER.replace('<name>', st.name)}\n\n${body.replace(/\s+$/, '')}\n`
}

function agentFile(st: Station): string {
  const fm = [`name: ${st.name}`, `description: ${st.description}`, `model: ${MODEL_BY_TIER[st.tier]}`]
  if (st.tools.length) fm.push(`tools: ${st.tools.join(', ')}`)
  fm.push(`maxTurns: ${st.maxTurns}`)
  return (
    `---\n${fm.join('\n')}\n---\n${GENERATED_MARKER.replace('<name>', st.name)}\n\n` +
    `Du bist der Arbeiter der Station **${st.display}** von Limitless OS.\n` +
    `Lies zuerst die Skill-Datei \`stations/${st.name}/SKILL.md\` und befolge sie wörtlich.\n`
  )
}

async function writeIfChanged(path: string, content: string, marker: string): Promise<boolean> {
  let existing: string | null = null
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    existing = null
  }
  if (existing !== null && !existing.includes(marker)) {
    throw new Error(`${path} wurde nicht generiert (von Hand geschrieben) – bitte verschieben, dann erneut ausführen`)
  }
  if (existing === content) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return true
}

/**
 * Generate `.claude/skills/<name>/SKILL.md` and `.claude/agents/<name>.md` from the
 * station folders. Returns the paths actually written (empty when nothing changed).
 */
export async function generateClaudeFiles(stations: Station[], repoRoot: string): Promise<string[]> {
  const written: string[] = []
  for (const st of stations) {
    const body = await readFile(st.skillPath, 'utf8')
    const marker = GENERATED_MARKER.replace('<name>', st.name)
    const skillPath = join(repoRoot, '.claude', 'skills', st.name, 'SKILL.md')
    const agentPath = join(repoRoot, '.claude', 'agents', `${st.name}.md`)
    if (await writeIfChanged(skillPath, skillFile(st, body), marker)) written.push(skillPath)
    if (await writeIfChanged(agentPath, agentFile(st), marker)) written.push(agentPath)
  }
  return written
}
