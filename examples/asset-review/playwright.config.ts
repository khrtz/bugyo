import { defineBugyoConfig } from 'bugyo/playwright';
import { devices } from '@playwright/test';

const executablePath = process.env['BUGYO_CHROMIUM_PATH'];
export default defineBugyoConfig({
  port: 5174,
  overrides: executablePath === undefined ? {} : { projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }] },
});
