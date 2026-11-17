import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const configFile = '.bugyo/config.json';

const Verify = z
  .object({
    runner: z.enum(['playwright', 'command']).default('playwright'),
    command: z.string().optional(),
  })
  .strict();

const FeatureMap = z
  .object({
    specDir: z.string().nullable().default('e2e'),
    specSuffix: z.string().min(1).default('.spec.ts'),
    featuresDir: z.string().nullable().default('src/features'),
  })
  .strict();

const Config = z
  .object({
    verify: Verify.prefault({}),
    featureMap: FeatureMap.prefault({}),
  })
  .strict();

/**
 * `.bugyo/config.json` を読み、既定値で埋めて返す。ファイルがなければ既定値だけを返す。
 *
 * @param {string} [cwd]
 * @returns {import('./index.js').BugyoConfig}
 */
export function loadConfig(cwd = process.cwd()) {
  const path = join(cwd, configFile);
  let raw = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`${configFile} を JSON として読めません: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const parsed = Config.safeParse(raw);
  if (!parsed.success) throw new Error(`${configFile} が不正です: ${parsed.error.message}`);
  if (parsed.data.verify.runner === 'command' && !parsed.data.verify.command?.trim()) {
    throw new Error(`${configFile}: verify.runner が "command" のときは verify.command にコマンドを書いてください（{id} と {spec} が置き換わります）`);
  }
  return parsed.data;
}
