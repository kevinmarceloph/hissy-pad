import { defineConfig, devices } from '@playwright/test'

// Runs the dev server on its own port so it never collides with a running `pnpm dev`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:5181', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
})
