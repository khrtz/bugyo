import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

export const packageManagers = /** @type {const} */ (['pnpm', 'npm', 'yarn', 'bun']);

/** パッケージマネージャーごとの、`commands` がないときの既定。あるときは書かれたものだけを使う */
const defaultCommandsBy = Object.freeze({
  pnpm: { check: 'pnpm check', test: 'pnpm test', verify: 'bugyo verify {feature}' },
  npm: { check: 'npm run check', test: 'npm test', verify: 'bugyo verify {feature}' },
  yarn: { check: 'yarn run check', test: 'yarn test', verify: 'bugyo verify {feature}' },
  bun: { check: 'bun run check', test: 'bun run test', verify: 'bugyo verify {feature}' },
});

/** pnpm のときの既定 */
export const defaultCommands = defaultCommandsBy.pnpm;

/** @type {readonly (readonly [string, typeof packageManagers[number]])[]} */
const lockfiles = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** @param {string} pkgPath */
function packageManagerField(pkgPath) {
  try {
    const field = JSON.parse(readFileSync(pkgPath, 'utf8')).packageManager;
    const name = typeof field === 'string' ? field.split('@')[0] : undefined;
    return packageManagers.find((candidate) => candidate === name);
  } catch {
    return undefined;
  }
}

/**
 * プロジェクトのパッケージマネージャーを決める。cwd から上へ、package.json の packageManager と lockfile を探す。
 * .git のあるフォルダより上は見ない。見つからなければ pnpm。
 *
 * @param {string} cwd
 * @returns {typeof packageManagers[number]}
 */
export function detectPackageManager(cwd) {
  let dir = cwd;
  for (;;) {
    const fromField = existsSync(join(dir, 'package.json')) ? packageManagerField(join(dir, 'package.json')) : undefined;
    if (fromField !== undefined) return fromField;
    const lock = lockfiles.find(([file]) => existsSync(join(dir, file)));
    if (lock !== undefined) return lock[1];
    const parent = dirname(dir);
    if (existsSync(join(dir, '.git')) || parent === dir) return 'pnpm';
    dir = parent;
  }
}

const Config = z
  .object({
    template: z.string().min(1).optional(),
    packageManager: z.enum(packageManagers).optional(),
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
  return { ...parsed.data, packageManager: parsed.data.packageManager ?? detectPackageManager(cwd) };
}

/**
 * done が使うコマンド。`commands` がなければ既定値を返す。あれば書かれたものだけを返し、空のものは未設定として扱う。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {{ check?: string, test?: string, verify?: string }}
 */
export function taskCommands(config) {
  const source = config.commands ?? defaultCommandsBy[config.packageManager ?? 'pnpm'];
  return Object.fromEntries(
    Object.entries(source).filter(([, command]) => typeof command === 'string' && command.trim() !== ''),
  );
}
