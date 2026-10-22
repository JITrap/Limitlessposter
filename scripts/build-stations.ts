// Generates .claude/skills/* and .claude/agents/* from stations/*.
// Run from the repo root: npm run build:stations
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadStations } from '../supervisor/src/stations/loader.js'
import { generateClaudeFiles } from '../supervisor/src/stations/generate.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const stations = await loadStations(repoRoot)
const written = await generateClaudeFiles(stations, repoRoot)
console.log(`${stations.length} Stationen geladen: ${stations.map((s) => s.name).join(', ')}`)
if (written.length === 0) console.log('Keine Änderungen.')
for (const p of written) console.log(`geschrieben: ${relative(repoRoot, p)}`)
