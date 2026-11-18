import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { types } from './tasks.js';

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

const Commands = z
  .object({
    check: z.string().optional(),
    test: z.string().optional(),
    verify: z.string().optional(),
  })
  .strict();

const Evidence = z
  .object({
    tree: z.array(z.string().min(1)).default(['src', 'e2e']),
  })
  .strict();

const Scope = z
  .object({
    types: z.array(z.enum(types)).min(1),
    window: z.int().positive().optional(),
    maxRework: z.int().nonnegative().optional(),
    minFirstPass: z.int().nonnegative().optional(),
    maxDropped: z.int().nonnegative().optional(),
  })
  .strict();

const Gate = z
  .object({
    window: z.int().positive().default(20),
    maxRework: z.int().nonnegative().default(2),
    minFirstPass: z.int().nonnegative().default(16),
    maxDropped: z.int().nonnegative().default(2),
    scopes: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, '小文字・数字・ハイフンの名前にしてください'), Scope).optional(),
  })
  .strict();

/** `.bugyo/config.json` に `commands` がないときだけ使う。あるときは書かれたものだけを使う */
export const defaultCommands = Object.freeze({
  check: 'pnpm check',
  test: 'pnpm test',
  verify: 'bugyo verify {feature}',
});

const Config = z
  .object({
    template: z.string().min(1).optional(),
    verify: Verify.prefault({}),
    featureMap: FeatureMap.prefault({}),
    commands: Commands.optional(),
    evidence: Evidence.prefault({}),
    gate: Gate.prefault({}),
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

/**
 * done が使うコマンド。`commands` がなければ既定値を返す。あれば書かれたものだけを返し、空のものは未設定として扱う。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {{ check?: string, test?: string, verify?: string }}
 */
export function taskCommands(config) {
  const source = config.commands ?? defaultCommands;
  return Object.fromEntries(
    Object.entries(source).filter(([, command]) => typeof command === 'string' && command.trim() !== ''),
  );
}
