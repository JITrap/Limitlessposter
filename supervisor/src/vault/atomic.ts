import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Write a file atomically: the content goes to a temp file in the same
 * directory and is then renamed over the target, so Obsidian never sees a
 * half-written note (spec §4.3).
 */
export async function writeFileAtomic(filePath: string, text: string): Promise<void> {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${basename(filePath)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, filePath)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
