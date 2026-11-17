import { defineConfig, devices } from '@playwright/test';

/**
 * 証拠（動画・スクリーンショット・トレース・HTMLレポート）を artifacts/ に残す Playwright 設定を作る。
 * dev サーバーの起動と停止は Playwright の webServer に任せる。
 *
 * @param {import('./index.js').BugyoPlaywrightOptions} [options]
 */
export function defineBugyoConfig(options = {}) {
  const port = options.port ?? 5173;
  const command = options.command ?? `pnpm exec vite --port ${port} --strictPort`;
  return defineConfig({
    testDir: 'e2e',
    testMatch: '**/*.spec.ts',
    outputDir: 'artifacts/test-results',
    snapshotPathTemplate: 'e2e/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
    updateSnapshots: process.env['CI'] ? 'none' : 'missing',
    reporter: [['list'], ['html', { outputFolder: 'artifacts/report', open: 'never' }]],
    use: {
      baseURL: `http://localhost:${port}`,
      screenshot: 'on',
      video: 'on',
      trace: 'on',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
      command,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env['CI'],
      timeout: 60_000,
    },
    ...options.overrides,
  });
}
