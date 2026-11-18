import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { noComments } from './rules/no-comments.js';

/**
 * @typedef {import('./index.js').BugyoOptions} BugyoOptions
 * @typedef {{ app: string, features: string, shared: { ui: string, api: string, lib: string } }} Layers
 * @typedef {Required<Omit<BugyoOptions, 'parts' | 'extra' | 'layers'>> & {
 *   extra: NonNullable<BugyoOptions['extra']>,
 *   layers: Layers,
 *   customLayers: boolean,
 *   featuresLabel: string,
 * }} Context
 * @typedef {'effects' | 'api' | 'tests'} Exception
 * @typedef {{ value: object, exempt?: Exception[] }} Entry
 * @typedef {{ paths?: Entry[], patterns?: Entry[], globals?: Entry[], syntax?: Entry[], properties?: Entry[] }} Bans
 * @typedef {{
 *   prelude?: import('eslint').Linter.Config[],
 *   trailing?: import('eslint').Linter.Config[],
 *   languageOptions?: object,
 *   plugins?: Record<string, object>,
 *   settings?: Record<string, unknown>,
 *   rules?: Record<string, unknown>,
 *   srcPlugins?: Record<string, object>,
 *   srcRules?: Record<string, unknown>,
 *   src?: Bans,
 *   ui?: Bans,
 *   model?: Bans,
 *   exceptions?: Exception[],
 * }} Contribution
 * @typedef {{ name: string, rank: number, build: (context: Context) => Contribution }} Part
 */

/** @type {Record<Exception, readonly (keyof Bans | 'imports')[]>} */
const exceptionRules = {
  effects: ['imports', 'syntax', 'properties'],
  api: ['globals'],
  tests: ['globals', 'properties', 'syntax'],
};

/** @param {Context} context */
const exceptionFiles = (context) => ({
  effects: [`${context.effectHooksDir}/**/*.{ts,tsx}`],
  api: [`${context.apiClientDir}/**/*.ts`],
  tests: [`${context.src}/**/*.test.{ts,tsx}`],
});

/**
 * 共通: TypeScript の厳しい検査、`any`・型アサーション・非 null アサーション・待っていない Promise・`switch` の漏れ、
 * 理由のない `eslint-disable`、コメント、`extra` の合成。どの構成のプロジェクトにも当てる。
 *
 * @type {Part}
 */
export const common = {
  name: 'common',
  rank: 0,
  build: (context) => ({
    prelude: [
      { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
      { ignores: ['dist', 'artifacts', 'playwright-report', 'test-results', 'node_modules', ...context.ignores] },
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: context.root },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@eslint-community/eslint-comments': comments,
      bugyo: { rules: { 'no-comments': noComments } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
    },
    srcRules: { 'bugyo/no-comments': 'error' },
    exceptions: ['effects', 'tests'],
    trailing: [
      { files: ['**/*.{js,cjs,mjs}'], ...tseslint.configs.disableTypeChecked },
      { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
    ],
  }),
};

/**
 * 構成: `app` / `features/<id>` / `shared` の境界、feature の外からは `index.ts` だけを通す決まり、
 * `model` から `ui` / `api` / `shared/ui` / `shared/api` への依存の禁止、`fetch` は apiClientDir だけ。React に依存しない。
 *
 * @type {Part}
 */
export const structure = {
  name: 'structure',
  rank: 2,
  build: (context) => {
    const { root, src, layers, customLayers } = context;
    const { app, features, shared } = layers;
    const featuresName = features.split('/').at(-1) ?? features;
    const internals = customLayers ? [`**/${featuresName}/*/*`] : ['@/features/*/*', '**/features/*/*'];
    const indexes = customLayers ? [`!**/${featuresName}/*/index.ts`] : ['!@/features/*/index.ts', '!**/features/*/index.ts'];
    const sharedDirs = [shared.ui, shared.api, shared.lib];
    const zones = customLayers
      ? [
          {
            target: sharedDirs.map((dir) => `./${dir}`),
            from: [`./${features}`, `./${app}`],
            message: `${sharedDirs.join('・')} は ${features} や ${app} に依存できません。`,
          },
          { target: `./${features}`, from: `./${app}`, message: `${features} は ${app} に依存できません。` },
          {
            target: `./${features}/*/model/**/*`,
            from: [`./${shared.ui}`, `./${shared.api}`],
            message: `model/ が使えるのは自分のmodelと ${shared.lib} だけです。`,
          },
        ]
      : [
          {
            target: `./${src}/shared`,
            from: [`./${src}/features`, `./${src}/app`],
            message: 'shared は features や app に依存できません。',
          },
          { target: `./${src}/features`, from: `./${src}/app`, message: 'features は app に依存できません。' },
        ];
    return {
      plugins: { 'import-x': importX },
      settings: { 'import-x/resolver-next': [createTypeScriptImportResolver({ project: `${root}/tsconfig.json` })] },
      srcRules: { 'import-x/no-restricted-paths': ['error', { basePath: root, zones }] },
      src: {
        patterns: [
          {
            value: {
              group: context.explicitExtensions ? [...internals, ...indexes] : internals,
              message: `featureの内部ファイルは直接importできません。${customLayers ? features : 'features'}/<名前>/index.ts から公開されたものを使ってください。`,
            },
          },
        ],
        globals: [
          {
            value: {
              name: 'fetch',
              message: `fetchを直接呼ばないでください。${context.apiClientDir} のクライアントを使い、スキーマで応答を検証してください。`,
            },
            exempt: ['api', 'tests'],
          },
        ],
      },
      model: {
        patterns: [
          {
            value: {
              group: ['../ui', '../ui/*', '../api', '../api/*'],
              message: 'model/ から ui/ や api/ はimportできません。依存の向きは ui → api → model です。',
            },
          },
          ...(customLayers
            ? []
            : [
                {
                  value: {
                    group: ['@/shared/ui', '@/shared/ui/*', '@/shared/api', '@/shared/api/*'],
                    message: 'model/ が使えるのは自分のmodelと shared/lib だけです。',
                  },
                },
              ]),
        ],
      },
      exceptions: ['api'],
    };
  },
};

/**
 * 層のフォルダを、指定のないところは `<src>/app`・`<src>/features`・`<src>/shared/{ui,api,lib}` で埋める。
 * どの層も src の中になければ断る（src の外のファイルには bugyo のルールが当たらないため）。
 *
 * @param {string} src
 * @param {BugyoOptions['layers']} layers
 * @returns {Layers}
 */
export function resolveLayers(src, layers) {
  const resolved = {
    app: trimSlash(layers?.app ?? `${src}/app`),
    features: trimSlash(layers?.features ?? `${src}/features`),
    shared: {
      ui: trimSlash(layers?.shared?.ui ?? `${src}/shared/ui`),
      api: trimSlash(layers?.shared?.api ?? `${src}/shared/api`),
      lib: trimSlash(layers?.shared?.lib ?? `${src}/shared/lib`),
    },
  };
  const outside = [resolved.app, resolved.features, ...Object.values(resolved.shared)].filter((dir) => !dir.startsWith(`${src}/`));
  if (outside.length > 0) throw new Error(`bugyo({ layers }) の ${outside.join(', ')} が src（${src}）の中にありません。src に層をまとめて入れるフォルダを渡してください`);
  return resolved;
}

/** @param {string} path */
const trimSlash = (path) => path.replace(/^\.\//, '').replace(/\/+$/, '');

/** @param {Context} context @returns {Contribution} */
const extraContribution = (context) => {
  const { extra } = context;
  const plain = (/** @type {object[]} */ values) => values.map((value) => ({ value }));
  const exempt = (/** @type {object[]} */ values) => values.map((value) => ({ value, exempt: /** @type {Exception[]} */ (['effects', 'tests']) }));
  return {
    src: {
      paths: plain(extra.restrictedImports?.paths ?? []),
      patterns: plain(extra.restrictedImports?.patterns ?? []),
      globals: plain(extra.restrictedGlobals ?? []),
      properties: exempt(extra.restrictedProperties ?? []),
      syntax: exempt(extra.restrictedSyntax ?? []),
    },
  };
};

/**
 * @param {Contribution[]} contributions
 * @param {'src' | 'ui' | 'model'} scope
 * @param {keyof Bans} kind
 * @returns {Entry[]}
 */
const collect = (contributions, scope, kind) => contributions.flatMap((contribution) => contribution[scope]?.[kind] ?? []);

/** @param {Entry[]} entries @param {Exception | undefined} exception */
const values = (entries, exception) =>
  entries.filter((entry) => exception === undefined || !(entry.exempt ?? []).includes(exception)).map((entry) => entry.value);

/** @param {Contribution[]} list @param {'plugins' | 'settings' | 'rules' | 'srcPlugins' | 'srcRules'} key */
const merged = (list, key) => Object.assign({}, ...list.map((contribution) => contribution[key] ?? {}));

/**
 * bugyo の ESLint flat config を作る。
 * no-restricted-imports / no-restricted-globals などはスコープごとに1つの設定へ合成して返すので、
 * 利用側で同じルールを上書きせず、追加の禁止は `extra` で渡すこと。
 * `parts` で部品を選べる（既定は common と structure。common は必須）。React を使うなら @bugyo/lint-react の react を足す。
 *
 * @param {BugyoOptions} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function bugyo(options) {
  const { root, src = 'src', ignores = [], extra = {}, parts = [common, structure], explicitExtensions = false } = options;
  if (typeof root !== 'string') throw new Error('bugyo({ root }) に import.meta.dirname を渡してください');
  if (!parts.includes(common)) throw new Error('bugyo({ parts }) には common を必ず入れてください');
  const layers = resolveLayers(src, options.layers);
  const { effectHooksDir = layers.shared.lib, apiClientDir = layers.shared.api } = options;
  const customLayers = options.layers !== undefined;

  /** @type {Context} */
  const context = {
    root,
    src,
    effectHooksDir,
    apiClientDir,
    ignores,
    extra,
    explicitExtensions,
    layers,
    customLayers,
    featuresLabel: customLayers ? layers.features : 'features',
  };
  const built = [...new Set(parts)].sort((a, b) => a.rank - b.rank).map((part) => part.build(context));
  const extras = extraContribution(context);

  const importsRule = (/** @type {Entry[]} */ paths, /** @type {Entry[]} */ patterns, /** @type {Exception | undefined} */ exception) => [
    'error',
    { paths: values(paths, exception), patterns: values(patterns, exception) },
  ];
  const listRule = (/** @type {Entry[]} */ entries, /** @type {Exception | undefined} */ exception, offWhenEmpty = false) => {
    const list = values(entries, exception);
    return offWhenEmpty && list.length === 0 ? 'off' : ['error', ...list];
  };

  /** @param {keyof Bans} kind @param {'ui' | 'model'} [scope] */
  const entries = (kind, scope) => {
    const base = collect(built, 'src', kind);
    const scoped = scope === undefined ? [] : collect(built, scope, kind);
    return [...base, ...scoped, ...collect([extras], 'src', kind)];
  };

  const srcPlugins = merged(built, 'srcPlugins');
  /** @type {import('eslint').Linter.Config[]} */
  const scopeBlocks = [];
  /** @type {Record<'ui' | 'model', string>} */
  const scopeFiles = { ui: `${layers.features}/*/ui/**/*.{ts,tsx}`, model: `${layers.features}/*/model/**/*.ts` };
  for (const scope of /** @type {const} */ (['ui', 'model'])) {
    /** @type {Record<string, unknown>} */
    const rules = {};
    if (collect(built, scope, 'paths').length + collect(built, scope, 'patterns').length > 0) {
      rules['no-restricted-imports'] = importsRule(entries('paths', scope), entries('patterns', scope), undefined);
    }
    if (collect(built, scope, 'globals').length > 0) rules['no-restricted-globals'] = listRule(entries('globals', scope), undefined);
    if (collect(built, scope, 'syntax').length > 0) rules['no-restricted-syntax'] = listRule(entries('syntax', scope), undefined);
    if (Object.keys(rules).length > 0) scopeBlocks.push({ files: [scopeFiles[scope]], rules });
  }

  const owned = new Set(built.flatMap((contribution) => contribution.exceptions ?? []));
  const files = exceptionFiles(context);
  /** @type {import('eslint').Linter.Config[]} */
  const exceptionBlocks = /** @type {Exception[]} */ (['effects', 'api', 'tests'])
    .filter((exception) => owned.has(exception))
    .map((exception) => ({
      files: files[exception],
      rules: Object.fromEntries(
        exceptionRules[exception].map((kind) => {
          switch (kind) {
            case 'imports':
              return ['no-restricted-imports', importsRule(entries('paths'), entries('patterns'), exception)];
            case 'globals':
              return ['no-restricted-globals', listRule(entries('globals'), exception, true)];
            case 'syntax':
              return ['no-restricted-syntax', listRule(entries('syntax'), exception, true)];
            case 'properties':
              return ['no-restricted-properties', listRule(entries('properties'), exception, true)];
            default:
              throw new Error(`知らない種類です: ${kind}`);
          }
        }),
      ),
    }));

  const settings = merged(built, 'settings');
  return tseslint.config(
    ...built.flatMap((contribution) => contribution.prelude ?? []),
    {
      languageOptions: Object.assign({}, ...built.map((contribution) => contribution.languageOptions ?? {})),
      plugins: merged(built, 'plugins'),
      ...(Object.keys(settings).length === 0 ? {} : { settings }),
      rules: merged(built, 'rules'),
    },
    {
      files: [`${src}/**/*.{ts,tsx}`],
      ...(Object.keys(srcPlugins).length === 0 ? {} : { plugins: srcPlugins }),
      rules: {
        ...merged(built, 'srcRules'),
        'no-restricted-imports': importsRule(entries('paths'), entries('patterns'), undefined),
        'no-restricted-syntax': listRule(entries('syntax'), undefined),
        'no-restricted-properties': listRule(entries('properties'), undefined, true),
        'no-restricted-globals': listRule(entries('globals'), undefined),
      },
    },
    ...scopeBlocks,
    ...exceptionBlocks,
    ...built.flatMap((contribution) => contribution.trailing ?? []),
  );
}
