#!/usr/bin/env node
// Stand-in for `claude -p` in tests and FAKE_CLAUDE mode.
// Replays the stream-json fixture named by FAKE_CLAUDE_FIXTURE line by line.
// FAKE_CLAUDE_HANG=1 prints the first line and then never exits (timeout tests).
// FAKE_CLAUDE_ARGS_FILE=<path> records the received argv as JSON.
import { readFileSync, writeFileSync } from 'node:fs'

const fixture = process.env.FAKE_CLAUDE_FIXTURE
if (process.env.FAKE_CLAUDE_ARGS_FILE) {
  writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)), 'utf8')
}
if (!fixture) {
  process.stderr.write('FAKE_CLAUDE_FIXTURE fehlt\n')
  process.exit(2)
}

const lines = readFileSync(fixture, 'utf8').split('\n').filter(Boolean)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let exitCode = fixture.includes('error') ? 1 : 0
for (let i = 0; i < lines.length; i++) {
  process.stdout.write(lines[i] + '\n')
  if (process.env.FAKE_CLAUDE_HANG === '1' && i === 0) {
    // Keep the process alive forever; the runner must kill us.
    setInterval(() => {}, 1 << 30)
    await new Promise(() => {})
  }
  await sleep(10)
}
process.exit(exitCode)
