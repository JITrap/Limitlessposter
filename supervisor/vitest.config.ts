// The timezone must be fixed before any Date is constructed: the supervisor
// does all window math in local time (Thursday 18:00 reset), so tests pin
// the machine to Europe/Berlin regardless of where they run.
process.env.TZ = 'Europe/Berlin'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/setup/global.ts'],
    setupFiles: ['./test/setup/tz.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
