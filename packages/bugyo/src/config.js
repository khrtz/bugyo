import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { types } from './tasks.js';

export const configFile = '.bugyo/config.json';

/** runners に付けられない名前。playwright と command は決まった確かめ方、残りは artifacts/ の下の証拠の置き場所 */
const reservedRunnerNames = ['playwright', 'command', 'report', 'test-results', 'verify'];

const RunnerName = z.string().regex(/^[a-z][a-z0-9-]*$/, '小文字・数字・ハイフンの名前にしてください');

/** 名前を付けた確かめ方。feature map の frontmatter の runner で選ぶか、match の glob に当たる spec に使う */
const NamedRunner = z
  .object({
    runner: z.enum(['playwright', 'command']),
    command: z.string().optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '環境変数の名前にしてください'), z.string()).optional(),
    match: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  })
  .strict();

const Verify = z
  .object({
    runner: RunnerName.default('playwright'),
    command: z.string().optional(),
    runners: z
      .record(RunnerName, NamedRunner)
      .refine(
        (runners) => !Object.keys(runners).some((name) => reservedRunnerNames.includes(name)),
        `${reservedRunnerNames.join('・')} は決まった名前か証拠の置き場所なので、別の名前にしてください`,
      )
      .optional(),
  })
  .strict();

const FeatureMap = z
  .object({
    specDir: z.string().nullable().default('e2e'),
    specSuffix: z.string().min(1).default('.spec.ts'),
    featuresDir: z.string().nullable().optional(),
  })
  .strict();

const LayerDir = z
  .string()
  .min(1)
  .regex(/^(?!\.{1,2}(\/|$))(?!\/)[^\\]*[^/\\]$/,'プロジェクトのルートからの相対パス（先頭の ./ や末尾の / なし、区切りは /）にしてください');

/** shared の場所。1つなら文字列、いくつもあれば配列で書ける */
const SharedDirs = z.union([LayerDir.transform((dir) => [dir]), z.array(LayerDir).min(1)]);
const OptionalDirs = z.union([LayerDir.transform((dir) => [dir]), z.array(LayerDir)]);

const PartName = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/, 'feature の中のフォルダ名（/ を含まない）にしてください')
  .refine((name) => name !== '.' && name !== '..', 'feature の中のフォルダ名（/ を含まない）にしてください');
const PartNames = z.array(PartName).min(1);

/** 層の既定の場所。layers で書かなかったところはこれで埋める */
export const defaultLayers = Object.freeze({
  app: 'src/app',
  features: 'src/features',
  shared: Object.freeze({ ui: ['src/shared/ui'], api: ['src/shared/api'], lib: ['src/shared/lib'], model: [], other: [] }),
  featureParts: Object.freeze({ ui: ['ui'], api: ['api'], model: ['model'] }),
});

const Layers = z
  .object({
    app: LayerDir.optional(),
    features: LayerDir.optional(),
    shared: z
      .object({ ui: SharedDirs.optional(), api: SharedDirs.optional(), lib: SharedDirs.optional(), model: OptionalDirs.optional(), other: OptionalDirs.optional() })
      .strict()
      .optional(),
    featureParts: z
      .object({ ui: PartNames.optional(), api: PartNames.optional(), model: PartNames.optional() })
      .strict()
      .refine((parts) => {
        const all = [...(parts.ui ?? ['ui']), ...(parts.api ?? ['api']), ...(parts.model ?? ['model'])];
        return new Set(all).size === all.length;
      }, '1つのフォルダ名は1つの役割（ui・api・model）にしてください')
      .optional(),
  })
  .strict();

/**
 * layers で書かなかったところを、`<src>/app` などの既定で埋める。
 *
 * @param {z.infer<typeof Layers>} layers
 * @param {string} src
 */
function fillLayers(layers, src) {
  return {
    app: layers.app ?? `${src}/app`,
    features: layers.features ?? `${src}/features`,
    shared: {
      ui: layers.shared?.ui ?? [`${src}/shared/ui`],
      api: layers.shared?.api ?? [`${src}/shared/api`],
      lib: layers.shared?.lib ?? [`${src}/shared/lib`],
      model: layers.shared?.model ?? [],
      other: layers.shared?.other ?? [],
    },
    featureParts: {
      ui: layers.featureParts?.ui ?? [...defaultLayers.featureParts.ui],
      api: layers.featureParts?.api ?? [...defaultLayers.featureParts.api],
      model: layers.featureParts?.model ?? [...defaultLayers.featureParts.model],
    },
  };
}

/** 層の決まりを当てるソース1つ。名前は台帳や doctor の表示に使う */
const Source = z
  .object({
    src: LayerDir,
    layers: Layers.optional(),
    tsconfig: LayerDir.optional(),
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
    locale: z.enum(['ja', 'en']).optional(),
    layers: Layers.optional(),
    sources: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, '小文字・数字・ハイフンの名前にしてください'), Source).optional(),
    verify: Verify.prefault({}),
    featureMap: FeatureMap.prefault({}),
    commands: Commands.optional(),
    evidence: Evidence.prefault({}),
    gate: Gate.prefault({}),
    claims: z
      .object({ remote: z.string().min(1).optional() })
      .strict()
      .prefault({}),
    notify: z
      .object({ verified: z.string().trim().min(1).optional() })
      .strict()
      .prefault({}),
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
  const { verify } = parsed.data;
  if (verify.runner === 'command' && !verify.command?.trim()) {
    throw new Error(`${configFile}: verify.runner が "command" のときは verify.command にコマンドを書いてください（{id} と {spec} が置き換わります）`);
  }
  const names = ['playwright', 'command', ...Object.keys(verify.runners ?? {})];
  if (!names.includes(verify.runner)) throw new Error(`${configFile}: verify.runner の ${verify.runner} がありません（使えるのは ${names.join(', ')}）`);
  for (const [name, runner] of Object.entries(verify.runners ?? {})) {
    if (runner.runner === 'command' && !runner.command?.trim()) {
      throw new Error(`${configFile}: verify.runners.${name} は command なので、command にコマンドを書いてください（{id} と {spec} が置き換わります）`);
    }
  }
  const { featureMap } = parsed.data;
  if (parsed.data.sources !== undefined && parsed.data.layers !== undefined) {
    throw new Error(`${configFile}: sources と layers は一緒に書けません。layers は sources のそれぞれに書いてください`);
  }
  const layers = parsed.data.layers === undefined ? undefined : fillLayers(parsed.data.layers, 'src');
  const sources =
    parsed.data.sources === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(parsed.data.sources).map(([name, source]) => [
            name,
            { src: source.src, layers: fillLayers(source.layers ?? {}, source.src), ...(source.tsconfig === undefined ? {} : { tsconfig: source.tsconfig }) },
          ]),
        );
  if (sources !== undefined) {
    const srcs = Object.values(sources).map((source) => source.src);
    if (srcs.length === 0) throw new Error(`${configFile}: sources には1つ以上のソースを書いてください`);
    const nested = srcs.filter((src, index) => srcs.some((other, at) => at !== index && (other === src || src.startsWith(`${other}/`))));
    if (nested.length > 0) throw new Error(`${configFile}: sources の src が重なっています: ${nested.join(', ')}`);
  }
  const firstFeatures = sources === undefined ? undefined : Object.values(sources)[0]?.layers.features;
  return {
    ...parsed.data,
    ...(layers === undefined ? {} : { layers }),
    ...(sources === undefined ? {} : { sources }),
    featureMap: { ...featureMap, featuresDir: featureMap.featuresDir === undefined ? (firstFeatures ?? layers?.features ?? 'src/features') : featureMap.featuresDir },
    packageManager: parsed.data.packageManager ?? detectPackageManager(cwd),
  };
}

/**
 * @typedef {{ app: string, features: string, shared: { ui: string[], api: string[], lib: string[], model: string[], other: string[] }, featureParts: { ui: string[], api: string[], model: string[] } }} ResolvedLayers
 * @typedef {{ name: string, src: string, layers: ResolvedLayers, custom: boolean, tsconfig?: string }} ResolvedSource
 */

/**
 * 層の決まりを当てるソースの一覧。`sources` がなければ、`layers`（なければ src の下の既定の場所）の1つ。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {ResolvedSource[]}
 */
export function sourcesOf(config) {
  if (config.sources !== undefined) {
    return Object.entries(config.sources).map(([name, source]) => ({
      name,
      src: source.src,
      layers: source.layers,
      custom: true,
      ...(source.tsconfig === undefined ? {} : { tsconfig: source.tsconfig }),
    }));
  }
  return [{ name: 'src', src: 'src', layers: config.layers ?? defaultLayers, custom: config.layers !== undefined }];
}

/**
 * 1つのソースの層のフォルダの一覧（app・features・shared の ui / api / lib / model / other）。
 *
 * @param {ResolvedLayers} layers
 * @returns {string[]}
 */
export function dirsOfLayers(layers) {
  const { shared } = layers;
  return [layers.app, layers.features, ...shared.ui, ...shared.api, ...shared.lib, ...shared.model, ...shared.other];
}

/**
 * 層のフォルダの一覧。`sources` があれば、すべてのソースのもの。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {string[]}
 */
export function layerDirs(config) {
  return sourcesOf(config).flatMap((source) => dirsOfLayers(source.layers));
}

/**
 * 機能のフォルダと、その中の役割ごとのフォルダ名。`sources` があればソースごと。`featureMap.featuresDir` が null なら空。
 * 同じ id のフォルダは、どのソースにあっても同じ機能として扱う。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {{ featuresDir: string, parts: { ui: string[], api: string[], model: string[] } }[]}
 */
export function featureRoots(config) {
  if (config.featureMap.featuresDir === null) return [];
  if (config.sources !== undefined) return sourcesOf(config).map((source) => ({ featuresDir: source.layers.features, parts: source.layers.featureParts }));
  return [{ featuresDir: config.featureMap.featuresDir, parts: featureParts(config) }];
}

/**
 * feature の中の役割ごとのフォルダ名（ui・api・model）。`layers.featureParts` がなければ ui・api・model。
 *
 * @param {import('./index.js').BugyoConfig} config
 * @returns {{ ui: string[], api: string[], model: string[] }}
 */
export function featureParts(config) {
  const parts = config.layers?.featureParts ?? defaultLayers.featureParts;
  return { ui: [...parts.ui], api: [...parts.api], model: [...parts.model] };
}

/**
 * 層のフォルダをすべて含む、いちばん深いフォルダ（`web/pages` と `web/app/ui` なら `web`）。
 *
 * @param {string[]} dirs
 */
export function commonDir(dirs) {
  const split = dirs.map((dir) => dir.split('/'));
  const first = split[0] ?? [];
  let length = 0;
  while (length < first.length && split.every((parts) => parts[length] === first[length])) length += 1;
  return first.slice(0, Math.min(length, ...split.map((parts) => parts.length - 1))).join('/') || '.';
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
