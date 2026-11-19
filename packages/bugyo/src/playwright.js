import { defineConfig, devices } from '@playwright/test';

/**
 * 証拠（動画・スクリーンショット・トレース・HTMLレポート）を artifacts/ に残す Playwright 設定を作る。
 * dev サーバーの起動と停止は Playwright の webServer に任せる。
 * 既定では、同じポートで動いているサーバーを使い回さない。別のプロジェクトのサーバーを撮って証拠にしないため。
 *
 * @param {import('./index.js').BugyoPlaywrightOptions} [options]
 */
export function defineBugyoConfig(options = {}) {
  const port = options.port ?? 5173;
  const command = options.command ?? `vite --port ${port} --strictPort`;
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
      reuseExistingServer: options.reuseExistingServer ?? false,
      timeout: 60_000,
    },
    ...options.overrides,
  });
}
