import type { PlaywrightTestConfig } from '@playwright/test';
import type { BugyoPlaywrightOptions } from './index.js';

export function defineBugyoConfig(options?: BugyoPlaywrightOptions): PlaywrightTestConfig;
