import type { PlaywrightTestConfig } from '@playwright/test';

export interface Feature {
  id: string;
  route: string;
  spec: string;
  /** docs/features/<id>.md（cwd からの相対パス） */
  file: string;
  body: string;
}

export const featureDir: string;
export const requiredSections: readonly string[];
export function loadFeatures(cwd?: string): Feature[];
export function loadSweepOrder(cwd?: string): string[];

export interface BugyoPlaywrightOptions {
  port?: number;
  /** dev サーバーを起動するコマンド。既定は `pnpm exec vite --port <port> --strictPort` */
  command?: string;
  overrides?: PlaywrightTestConfig;
}
