import js from '@eslint/js';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { joinList, messagesFor, resolveLocale, say } from './messages.js';
import { noCommentsFor } from './rules/no-comments.js';

/**
 * @typedef {import('./index.js').BugyoOptions} BugyoOptions
 * @typedef {import('./index.js').BanSpec} BanSpec
 * @typedef {{
 *   app: string,
 *   features: string,
 *   shared: { ui: string[], api: string[], lib: string[], model: string[], other: string[] },
 *   featureParts: { ui: string[], api: string[], model: string[] },
 * }} Layers
 * @typedef {{
 *   root: string,
 *   src: string,
 *   tsconfig: string,
 *   effectHooksDir: string,
 *   apiClientDir: string,
 *   ignores: string[],
 *   explicitExtensions: boolean,
 *   layers: Layers,
 *   customLayers: boolean,
 *   featuresLabel: string,
 *   locale: import('./messages.js').Locale,
 * }} Context
 * @typedef {'paths' | 'patterns' | 'globals' | 'syntax' | 'properties'} Kind
 * @typedef {{
 *   name: string,
 *   scope: string,
 *   allow: string[],
 *   imports: { paths: unknown[], patterns: unknown[] },
 *   globals: unknown[],
 *   syntax: unknown[],
 *   properties: unknown[],
 *   rules: Record<string, unknown>,
 *   plugins: Record<string, object>,
 * }} Ban 名前・何を止めるか・どこで止めるか（scope）・どこでは許すか（allow）をそろえた禁止1つ
 * @typedef {{ name: string, scope: string, allow: string[], kind: Kind, value: unknown }} Entry 合成するルールに入る、禁止の1項目
 * @typedef {{
 *   prelude?: import('eslint').Linter.Config[],
 *   trailing?: import('eslint').Linter.Config[],
 *   languageOptions?: object,
 *   plugins?: Record<string, object>,
 *   settings?: Record<string, unknown>,
 *   rules?: Record<string, unknown>,
 *   srcPlugins?: Record<string, object>,
 *   srcRules?: Record<string, unknown>,
 *   bans?: Ban[],
 * }} Contribution
 * @typedef {{ name: string, rank: number, build: (context: Context) => Contribution }} Part
 */

/** 禁止を合成する ESLint のルールと、それぞれに入る項目の種類。順番は書き出す順番 */
const combined = /** @type {const} */ ([
  { ruleId: 'no-restricted-imports', kinds: ['paths', 'patterns'] },
  { ruleId: 'no-restricted-syntax', kinds: ['syntax'] },
  { ruleId: 'no-restricted-properties', kinds: ['properties'] },
  { ruleId: 'no-restricted-globals', kinds: ['globals'] },
]);

/** 名前で指定できる場所。これ以外の文字列は root からの glob として扱う */
const namedScopes = ['src', 'ui', 'model'];
const namedPlaces = ['effects', 'api', 'tests'];

/** @param {unknown} value */
const hasMessage = (value) => typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string' && value.message.trim() !== '';

const banKeys = new Set(['name', 'scope', 'allow', 'imports', 'globals', 'syntax', 'properties', 'rules', 'plugins']);

/**
 * 禁止の書き方を確かめ、足りない項目を埋める。
 *
 * @param {BanSpec} spec
 * @returns {Ban}
 */
export function normalizeBan(spec) {
  const name = spec.name;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(say({ en: `A ban name must use lowercase letters, digits, and hyphens (e.g. no-date-now): ${String(name)}`, ja: `禁止の name は小文字・数字・ハイフンにしてください（例: no-date-now）: ${String(name)}` }));
  }
  const unknown = Object.keys(spec).filter((key) => !banKeys.has(key));
  if (unknown.length > 0) throw new Error(
      say({
        en: `The ban ${name} has unknown keys: ${unknown.join(', ')} (allowed: ${[...banKeys].join(', ')})`,
        ja: `禁止 ${name} に知らない項目があります: ${unknown.join(', ')}（使えるのは ${[...banKeys].join(', ')}）`,
      }),
    );
  const scope = spec.scope ?? 'src';
  if (typeof scope !== 'string' || scope === '') throw new Error(say({ en: `The scope of the ban ${name} is ${namedScopes.join(' / ')} or a glob string`, ja: `禁止 ${name} の scope は ${namedScopes.join(' / ')} か glob の文字列です` }));
  const allow = spec.allow ?? [];
  if (!Array.isArray(allow) || allow.some((place) => typeof place !== 'string' || place === '')) {
    throw new Error(say({ en: `The allow of the ban ${name} is an array of ${namedPlaces.join(' / ')} or glob strings`, ja: `禁止 ${name} の allow は、${namedPlaces.join(' / ')} か glob の文字列の配列です` }));
  }
  const ban = {
    name,
    scope,
    allow: [...allow],
    imports: { paths: [...(spec.imports?.paths ?? [])], patterns: [...(spec.imports?.patterns ?? [])] },
    globals: [...(spec.globals ?? [])],
    syntax: [...(spec.syntax ?? [])],
    properties: [...(spec.properties ?? [])],
    rules: { ...(spec.rules ?? {}) },
    plugins: { ...(spec.plugins ?? {}) },
  };
  for (const [key, list] of /** @type {[string, unknown[]][]} */ ([
    ['imports.paths', ban.imports.paths],
    ['imports.patterns', ban.imports.patterns],
    ['globals', ban.globals],
    ['syntax', ban.syntax],
    ['properties', ban.properties],
  ])) {
    const index = list.findIndex((value) => !hasMessage(value));
    if (index !== -1) {
      throw new Error(
        say({
          en: `${key}[${String(index)}] of the ban ${name} has no message. Write in message what to do next: what to use instead and where it lives (e.g. { name: 'moment', message: 'Use formatDate from src/shared/lib/date.ts' })`,
          ja: `禁止 ${name} の ${key}[${String(index)}] に message がありません。止めた相手が次に何をすればよいか（代わりに使うものと置き場所）を message に書いてください（例: { name: 'moment', message: 'src/shared/lib/date.ts の formatDate を使ってください' }）`,
        }),
      );
    }
  }
  const combinedSize = ban.imports.paths.length + ban.imports.patterns.length + ban.globals.length + ban.syntax.length + ban.properties.length;
  if (combinedSize + Object.keys(ban.rules).length === 0) throw new Error(say({ en: `The ban ${name} stops nothing. Write one of imports, globals, syntax, properties, or rules`, ja: `禁止 ${name} は何も止めていません。imports・globals・syntax・properties・rules のどれかを書いてください` }));
  if (combinedSize > 0 && !namedScopes.includes(scope)) {
    throw new Error(
      say({
        en: `The ban ${name}: imports, globals, syntax, and properties need a scope of ${namedScopes.join(' / ')} (in a glob scope, the combined rule would override bugyo's bans). To narrow the range, keep scope src and exclude with allow, or write it in rules`,
        ja: `禁止 ${name}: imports・globals・syntax・properties は、scope を ${namedScopes.join(' / ')} のどれかにしてください（glob の範囲では、bugyo の禁止と合成したルールが上書きし合うため）。範囲を絞るなら、scope は src のまま allow で除くか、rules で書いてください`,
      }),
    );
  }
  return ban;
}

/**
 * 禁止を1つ、部品として作る。`bugyo({ parts })` に、bugyo の部品や禁止と並べて渡す。
 * メッセージなどに bugyo の設定（effectHooksDir など）を使うときは、`build(context)` で残りの項目を返す。
 *
 * @param {BanSpec & { build?: (context: Context) => Omit<BanSpec, 'name'> }} spec
 * @returns {Part}
 */
export function defineBan(spec) {
  const { build, ...rest } = spec;
  if (typeof rest.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(rest.name)) {
    throw new Error(say({ en: `A ban name must use lowercase letters, digits, and hyphens (e.g. no-date-now): ${String(rest.name)}`, ja: `禁止の name は小文字・数字・ハイフンにしてください（例: no-date-now）: ${String(rest.name)}` }));
  }
  if (build !== undefined && typeof build !== 'function') throw new Error(say({ en: `The build of the ban ${rest.name} must be a function`, ja: `禁止 ${rest.name} の build は関数です` }));
  return {
    name: rest.name,
    rank: 10,
    build: (context) => ({ bans: [normalizeBan({ ...rest, ...(build === undefined ? {} : build(context)), name: rest.name })] }),
  };
}

/**
 * コメントの禁止。公開 API の JSDoc（`/** *\/`）と、理由つきの `eslint-disable` だけを書ける。src の下の .ts / .tsx に当てる。
 */
export const noComments = defineBan({ name: 'comments', rules: { 'bugyo/no-comments': 'error' } });

/**
 * `fetch` の禁止。apiClientDir（既定は `shared/api`）のクライアントとテストでだけ呼べる。
 */
export const fetchOnlyInApi = defineBan({
  name: 'fetch',
  allow: ['api', 'tests'],
  build: (context) => ({
    globals: [
      {
        name: 'fetch',
        message: messagesFor(context.locale).fetch({ apiClientDir: context.apiClientDir }),
      },
    ],
  }),
});

/**
 * 共通: TypeScript の厳しい検査、`any`・型アサーション・非 null アサーション・待っていない Promise・`switch` の漏れ、
 * 理由のない `eslint-disable`。どの構成のプロジェクトにも当てる。
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
      bugyo: { rules: { 'no-comments': noCommentsFor(context.locale) } },
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
    trailing: [
      { files: ['**/*.{js,cjs,mjs}'], ...tseslint.configs.disableTypeChecked },
      { files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
    ],
  }),
};

/**
 * 構成: `app` / `features/<id>` / `shared` の境界、feature の外からは `index.ts` だけを通す決まり、
 * `model` から `ui` / `api` / `shared/ui` / `shared/api` への依存の禁止。React に依存しない。
 *
 * @type {Part}
 */
export const structure = {
  name: 'structure',
  rank: 2,
  build: (context) => {
    const { root, src, layers, customLayers, locale } = context;
    const m = messagesFor(locale);
    const list = (/** @type {string[]} */ items) => joinList(locale, items);
    const { app, features, shared, featureParts } = layers;
    const featuresName = features.split('/').at(-1) ?? features;
    const outerParts = [...featureParts.ui, ...featureParts.api];
    const roleLabel = (/** @type {string[]} */ names) => list(names.map((name) => `${name}/`));
    const internals = customLayers ? [`**/${featuresName}/*/*`] : ['@/features/*/*', '**/features/*/*'];
    const indexes = customLayers ? [`!**/${featuresName}/*/index.ts`] : ['!@/features/*/index.ts', '!**/features/*/index.ts'];
    const sharedDirs = [...shared.ui, ...shared.api, ...shared.lib, ...shared.model, ...shared.other];
    const pureDirs = list([...shared.lib, ...shared.model]);
    const zones = customLayers
      ? [
          {
            target: sharedDirs.map((dir) => `./${dir}`),
            from: [`./${features}`, `./${app}`],
            message: tagged('shared-is-leaf', m.sharedIsLeaf({ shared: list(sharedDirs), features, app })),
          },
          { target: `./${features}`, from: `./${app}`, message: tagged('features-not-to-app', m.featuresNotToApp({ features, app })) },
          {
            target: featureParts.model.map((name) => `./${features}/*/${name}/**/*`),
            from: [...shared.ui, ...shared.api, ...shared.other].map((dir) => `./${dir}`),
            message: tagged('model-is-pure', m.modelIsPure({ model: roleLabel(featureParts.model), pure: pureDirs })),
          },
          ...(shared.model.length === 0
            ? []
            : [
                {
                  target: shared.model.map((dir) => `./${dir}`),
                  from: [...shared.ui, ...shared.api, ...shared.other].map((dir) => `./${dir}`),
                  message: tagged('shared-model-is-pure', m.sharedModelIsPure({ sharedModel: list(shared.model), pure: pureDirs })),
                },
              ]),
        ]
      : [
          {
            target: `./${src}/shared`,
            from: [`./${src}/features`, `./${src}/app`],
            message: tagged('shared-is-leaf', m.sharedIsLeaf({ shared: 'shared', features: 'features', app: 'app' })),
          },
          { target: `./${src}/features`, from: `./${src}/app`, message: tagged('features-not-to-app', m.featuresNotToApp({ features: 'features', app: 'app' })) },
        ];
    return {
      plugins: { 'import-x': importX },
      settings: { 'import-x/resolver-next': [createTypeScriptImportResolver({ project: `${root}/${context.tsconfig}` })] },
      srcRules: {
        'import-x/no-restricted-paths': ['error', { basePath: root, zones: zones.filter((zone) => [zone.target, zone.from].every((list) => list.length > 0)) }],
      },
      bans: [
        normalizeBan({
          name: 'feature-internals',
          imports: {
            patterns: [
              {
                group: context.explicitExtensions ? [...internals, ...indexes] : internals,
                message: m.featureInternals({ features: customLayers ? features : 'features' }),
              },
            ],
          },
        }),
        normalizeBan({
          name: 'model-layers',
          scope: 'model',
          imports: {
            patterns: [
              customLayers
                ? {
                    group: outerParts.flatMap((name) => [`../${name}`, `../${name}/*`]),
                    message: m.modelLayers({ model: roleLabel(featureParts.model), outer: roleLabel(outerParts), ui: roleLabel(featureParts.ui), api: roleLabel(featureParts.api) }),
                  }
                : {
                    group: ['../ui', '../ui/*', '../api', '../api/*'],
                    message: m.modelLayersDefault(),
                  },
              ...(customLayers
                ? []
                : [
                    {
                      group: ['@/shared/ui', '@/shared/ui/*', '@/shared/api', '@/shared/api/*'],
                      message: m.modelSharedLayers(),
                    },
                  ]),
            ],
          },
        }),
      ],
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
  const parts = layers?.featureParts;
  const names = (/** @type {string} */ role, /** @type {string[] | undefined} */ value) => {
    const list = value ?? [role];
    if (!Array.isArray(list) || list.length === 0 || list.some((name) => typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name) || /^\.{1,2}$/.test(name))) {
      throw new Error(say({ en: `featureParts.${role} of bugyo({ layers }) must be an array of folder names inside a feature (no /)`, ja: `bugyo({ layers }) の featureParts.${role} は、feature の中のフォルダ名（/ を含まない）の配列にしてください` }));
    }
    return [...list];
  };
  /**
   * @param {string} role
   * @param {string | string[] | undefined} value
   * @param {string[]} fallback
   */
  const dirs = (role, value, fallback) => {
    if (value === undefined) return fallback;
    const list = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(list) || (fallback.length > 0 && list.length === 0) || list.some((dir) => typeof dir !== 'string' || dir === '')) {
      throw new Error(say({ en: `shared.${role} of bugyo({ layers }) must be one folder or a non-empty array of folders`, ja: `bugyo({ layers }) の shared.${role} は、フォルダ1つか、フォルダの空でない配列にしてください` }));
    }
    return list.map(trimSlash);
  };
  const featureParts = { ui: names('ui', parts?.ui), api: names('api', parts?.api), model: names('model', parts?.model) };
  const all = [...featureParts.ui, ...featureParts.api, ...featureParts.model];
  const twice = all.filter((name, index) => all.indexOf(name) !== index);
  if (twice.length > 0) throw new Error(
      say({
        en: `In featureParts of bugyo({ layers }), ${[...new Set(twice)].join(', ')} has two roles. Give each folder one role`,
        ja: `bugyo({ layers }) の featureParts で ${[...new Set(twice)].join(', ')} が2つの役割に入っています。1つのフォルダは1つの役割にしてください`,
      }),
    );
  const resolved = {
    app: trimSlash(layers?.app ?? `${src}/app`),
    features: trimSlash(layers?.features ?? `${src}/features`),
    shared: {
      ui: dirs('ui', layers?.shared?.ui, [`${src}/shared/ui`]),
      api: dirs('api', layers?.shared?.api, [`${src}/shared/api`]),
      lib: dirs('lib', layers?.shared?.lib, [`${src}/shared/lib`]),
      model: dirs('model', layers?.shared?.model, []),
      other: dirs('other', layers?.shared?.other, []),
    },
    featureParts,
  };
  const outside = [resolved.app, resolved.features, ...Object.values(resolved.shared).flat()].filter((dir) => !dir.startsWith(`${src}/`));
  if (outside.length > 0) throw new Error(
      say({
        en: `${outside.join(', ')} of bugyo({ layers }) is not inside src (${src}). Pass as src the folder that holds all the layers`,
        ja: `bugyo({ layers }) の ${outside.join(', ')} が src（${src}）の中にありません。src に層をまとめて入れるフォルダを渡してください`,
      }),
    );
  return resolved;
}

/** @param {string} path */
const trimSlash = (path) => path.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * 禁止の scope と allow に書いた場所の glob。glob の記号（`*?[]{}!`）のないものは、そのファイルか、そのフォルダの下のすべてにする。
 *
 * @param {string} path
 */
const pathGlobs = (path) => (/[*?[\]{}!]/.test(path) ? [path] : [trimSlash(path), `${trimSlash(path)}/**`]);

/**
 * メッセージの頭に、言語や言い回しによらない名前（`[bugyo:<名前>]`）を付ける。
 * bugyo doctor と baseline は、メッセージの文ではなくこの名前で禁止を数える。
 *
 * @param {string} id
 * @param {string} text
 */
const tagged = (id, text) => `[bugyo:${id}] ${text}`;

/**
 * 項目のメッセージに、禁止の名前を付ける（項目にメッセージがあることは normalizeBan が確かめている）。
 *
 * @param {string} name
 * @param {unknown} value
 */
const withName = (name, value) =>
  typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string' ? { ...value, message: tagged(name, value.message) } : value;

/**
 * 禁止を、合成するルールに入る項目に分ける。
 *
 * @param {Ban[]} bans
 * @returns {Entry[]}
 */
const entriesOf = (bans) =>
  bans.flatMap((ban) =>
    /** @type {[Kind, unknown[]][]} */ ([
      ['paths', ban.imports.paths],
      ['patterns', ban.imports.patterns],
      ['globals', ban.globals],
      ['syntax', ban.syntax],
      ['properties', ban.properties],
    ]).flatMap(([kind, list]) => list.map((value) => ({ name: ban.name, scope: ban.scope, allow: ban.allow, kind, value: withName(ban.name, value) }))),
  );

/** @param {Contribution[]} list @param {'plugins' | 'settings' | 'rules' | 'srcPlugins' | 'srcRules'} key */
const merged = (list, key) => Object.assign({}, ...list.map((contribution) => contribution[key] ?? {}));

/** @param {unknown} value */
const lower = (value) => {
  if (value === 'error' || value === 2) return 'warn';
  if (Array.isArray(value) && (value[0] === 'error' || value[0] === 2)) return ['warn', ...value.slice(1)];
  return value;
};

/** ソースごとに書く項目。sources を使うときは sources のそれぞれに書く */
const sourceKeys = ['src', 'layers', 'parts', 'tsconfig', 'explicitExtensions', 'effectHooksDir', 'apiClientDir'];

/**
 * @typedef {{ context: Context, parts: Part[], built: Contribution[], bans: Ban[], effectsDirs: string[], apiDirs: string[] }} PreparedSource
 */

/**
 * ソース1つの部品を組み立て、禁止を集める。同じソースの中に同じ名前の禁止があれば断る。
 *
 * @param {string} root
 * @param {string[]} ignores
 * @param {import('./messages.js').Locale} locale
 * @param {import('./index.js').BugyoSource} source
 * @returns {PreparedSource}
 */
function prepareSource(root, ignores, locale, source) {
  const { src = 'src', parts = [common, structure], explicitExtensions = false, tsconfig = 'tsconfig.json' } = source;
  if (!parts.includes(common)) throw new Error(say({ en: 'bugyo({ parts }) must include common', ja: 'bugyo({ parts }) には common を必ず入れてください' }));
  const layers = resolveLayers(src, source.layers);
  const effectsDirs = source.effectHooksDir === undefined ? layers.shared.lib : [trimSlash(source.effectHooksDir)];
  const apiDirs = source.apiClientDir === undefined ? layers.shared.api : [trimSlash(source.apiClientDir)];
  const customLayers = source.layers !== undefined;
  /** @type {Context} */
  const context = {
    root,
    src,
    tsconfig: trimSlash(tsconfig),
    effectHooksDir: joinList(locale, effectsDirs),
    apiClientDir: joinList(locale, apiDirs),
    ignores,
    explicitExtensions,
    layers,
    customLayers,
    featuresLabel: customLayers ? layers.features : 'features',
    locale,
  };
  const sorted = [...new Set(parts)].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const built = sorted.map((part) => part.build(context));
  const bans = built.flatMap((contribution) => contribution.bans ?? []);
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const ban of bans) seen.set(ban.name, (seen.get(ban.name) ?? 0) + 1);
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicated.length > 0) throw new Error(say({ en: `More than one ban has the same name: ${duplicated.join(', ')}. Rename them`, ja: `同じ名前の禁止が2つ以上あります: ${duplicated.join(', ')}。名前を変えてください` }));
  return { context, parts: sorted, built, bans, effectsDirs, apiDirs };
}

/**
 * bugyo の ESLint flat config を作る。
 * no-restricted-imports / no-restricted-globals などはスコープごとに1つの設定へ合成して返すので、
 * 利用側で同じルールを上書きせず、追加の禁止は defineBan で作って `parts` に足すこと。
 * `parts` で部品と禁止を選べる（既定は common と structure。common は必須）。React を使うなら @bugyo/lint-react の react を足す。
 *
 * @param {BugyoOptions} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function bugyo(options) {
  const { root, ignores = [] } = options;
  if (typeof root !== 'string') throw new Error(say({ en: 'Pass import.meta.dirname to bugyo({ root })', ja: 'bugyo({ root }) に import.meta.dirname を渡してください' }));
  if ('extra' in options) {
    throw new Error(say({ en: 'There is no bugyo({ extra }). Write your own bans with defineBan({ name, ... }) and add them to parts', ja: 'bugyo({ extra }) はありません。独自の禁止は defineBan({ name, ... }) で作り、parts に足してください' }));
  }
  const multi = options.sources !== undefined;
  if (multi) {
    const mixed = sourceKeys.filter((key) => key in options);
    if (mixed.length > 0) throw new Error(say({ en: `With bugyo({ sources }), write ${mixed.join(', ')} inside each source`, ja: `bugyo({ sources }) を使うときは、${mixed.join(', ')} を sources のそれぞれに書いてください` }));
    if (!Array.isArray(options.sources) || options.sources.length === 0) throw new Error(say({ en: 'Pass bugyo({ sources }) an array of one or more sources', ja: 'bugyo({ sources }) には、ソースを1つ以上の配列で渡してください' }));
  }
  const locale = resolveLocale(root, options.locale);
  const prepared = (options.sources ?? [options]).map((source) => prepareSource(root, ignores, locale, source));
  const srcs = prepared.map(({ context }) => context.src);
  const nested = srcs.filter((src, index) => srcs.some((other, at) => at !== index && (other === src || src.startsWith(`${other}/`))));
  if (nested.length > 0) throw new Error(say({ en: `The src of bugyo({ sources }) overlap: ${nested.join(', ')}. Use a separate folder for each source`, ja: `bugyo({ sources }) の src が重なっています: ${nested.join(', ')}。ソースごとに別のフォルダにしてください` }));

  const banNames = new Set(prepared.flatMap(({ bans }) => bans.map((ban) => ban.name)));
  const severity = options.severity ?? {};
  for (const [name, level] of Object.entries(severity)) {
    if (level !== 'warn') throw new Error(say({ en: `bugyo({ severity }) can only lower to 'warn' (${name}: ${String(level)})`, ja: `bugyo({ severity }) で下げられるのは 'warn' だけです（${name}: ${String(level)}）` }));
  }
  const warned = new Set(Object.keys(severity).filter((name) => banNames.has(name)));
  const alias = prepared.some(({ bans }) => entriesOf(bans).some((entry) => warned.has(entry.name)));

  /** @typedef {'error' | 'warn'} Level */
  /** @param {Entry[]} list @param {Level} level */
  const atLevel = (list, level) => list.filter((entry) => warned.has(entry.name) === (level === 'warn'));

  /**
   * 合成するルールの設定を作る。
   *
   * @param {(typeof combined)[number]} group
   * @param {Entry[]} list
   * @param {Level} level
   * @param {boolean} offWhenEmpty
   */
  const make = (group, list, level, offWhenEmpty) => {
    const chosen = atLevel(list, level);
    const empty = chosen.length === 0;
    if (empty && (offWhenEmpty || level === 'warn')) return 'off';
    if (group.ruleId === 'no-restricted-imports') {
      const of = (/** @type {Kind} */ kind) => chosen.filter((entry) => entry.kind === kind).map((entry) => entry.value);
      return [level, { paths: of('paths'), patterns: of('patterns') }];
    }
    return [level, ...chosen.map((entry) => entry.value)];
  };

  /**
   * 合成した禁止のルールを、error のものと warn に下げたもの（`bugyo-warn/<ルール>`）の2つにする。warn に下げた禁止がなければ1つだけ。
   *
   * @param {(typeof combined)[number]} group
   * @param {Entry[]} list
   * @param {boolean} offWhenEmpty
   */
  const pair = (group, list, offWhenEmpty) => ({
    [group.ruleId]: make(group, list, 'error', offWhenEmpty),
    ...(alias ? { [`${warnPlugin}/${group.ruleId}`]: make(group, list, 'warn', offWhenEmpty) } : {}),
  });

  /** @param {(typeof combined)[number]} group @param {Entry[]} list */
  const inGroup = (group, list) => list.filter((entry) => /** @type {readonly Kind[]} */ (group.kinds).includes(entry.kind));

  /** @param {Ban} ban */
  const banRules = (ban) => Object.fromEntries(Object.entries(ban.rules).map(([id, value]) => [id, warned.has(ban.name) ? lower(value) : value]));

  /**
   * ソース1つ分のブロック（src の下に当てるもの、範囲ごと、許す場所ごと）。
   *
   * @param {PreparedSource} source
   * @returns {import('eslint').Linter.Config[]}
   */
  const blocksOf = ({ context, built, bans, effectsDirs, apiDirs }) => {
  const { src, layers } = context;
  const entries = entriesOf(bans);

  /** @param {string} scope */
  const scopeGlobs = (scope) => {
    switch (scope) {
      case 'src':
        return [`${src}/**/*.{ts,tsx}`];
      case 'ui':
        return layers.featureParts.ui.map((name) => `${layers.features}/*/${name}/**/*.{ts,tsx}`);
      case 'model':
        return [
          ...layers.featureParts.model.map((name) => `${layers.features}/*/${name}/**/*.ts`),
          ...layers.shared.model.map((dir) => `${dir}/**/*.ts`),
        ];
      default:
        return pathGlobs(scope);
    }
  };
  /** @param {string} place */
  const placeGlobs = (place) => {
    switch (place) {
      case 'effects':
        return effectsDirs.map((dir) => `${dir}/**/*.{ts,tsx}`);
      case 'api':
        return apiDirs.map((dir) => `${dir}/**/*.ts`);
      case 'tests':
        return [`${src}/**/*.test.{ts,tsx}`];
      default:
        return pathGlobs(place);
    }
  };

  const srcEntries = entries.filter((entry) => entry.scope === 'src');
  const scopes = [...new Set(['ui', 'model', ...bans.map((ban) => ban.scope)])].filter((scope) => scope !== 'src');
  /** @param {string} scope */
  const scopeEntries = (scope) => entries.filter((entry) => entry.scope === scope);

  /** @type {Record<string, unknown>} */
  const srcRules = { ...merged(built, 'srcRules') };
  for (const ban of bans) if (ban.scope === 'src') Object.assign(srcRules, banRules(ban));
  for (const group of combined) Object.assign(srcRules, pair(group, inGroup(group, srcEntries), group.ruleId === 'no-restricted-properties'));

  /** @type {import('eslint').Linter.Config[]} */
  const scopeBlocks = [];
  for (const scope of scopes) {
    /** @type {Record<string, unknown>} */
    const rules = {};
    for (const ban of bans) if (ban.scope === scope) Object.assign(rules, banRules(ban));
    for (const group of combined) {
      if (inGroup(group, scopeEntries(scope)).length > 0) Object.assign(rules, pair(group, inGroup(group, [...srcEntries, ...scopeEntries(scope)]), false));
    }
    if (Object.keys(rules).length > 0) scopeBlocks.push({ files: scopeGlobs(scope), rules });
  }

  /**
   * 許す場所ごとのブロック。そこで許す禁止を除いて、合成したルールを作り直す。
   * 範囲（ui・model など）の禁止は、範囲と場所の両方に当たるファイルのブロックで作り直す（範囲の禁止が消えないように）。
   */
  const places = [...new Set([...namedPlaces, ...bans.flatMap((ban) => ban.allow)])].filter((place) => bans.some((ban) => ban.allow.includes(place)));
  /** @type {import('eslint').Linter.Config[]} */
  const placeBlocks = [];
  for (const place of places) {
    /** @param {Entry[]} list */
    const without = (list) => list.filter((entry) => !entry.allow.includes(place));
    /** @param {Entry[]} list */
    const touches = (list) => list.some((entry) => entry.allow.includes(place));
    /** @param {string} scope */
    const both = (scope) => scopeGlobs(scope).flatMap((scopeGlob) => placeGlobs(place).map((placeGlob) => [scopeGlob, placeGlob]));
    /** @type {Record<string, unknown>} */
    const off = {};
    for (const ban of bans) if (ban.allow.includes(place)) for (const id of Object.keys(ban.rules)) off[id] = 'off';
    if (Object.keys(off).length > 0) placeBlocks.push({ files: placeGlobs(place), rules: off });
    /** @type {Record<string, unknown>} */
    const rules = {};
    for (const group of combined) {
      const list = inGroup(group, srcEntries);
      if (touches(list)) Object.assign(rules, pair(group, without(list), true));
    }
    if (Object.keys(rules).length > 0) placeBlocks.push({ files: both('src'), rules });
    for (const scope of scopes) {
      /** @type {Record<string, unknown>} */
      const scoped = {};
      for (const group of combined) {
        const own = inGroup(group, scopeEntries(scope));
        const list = inGroup(group, [...srcEntries, ...scopeEntries(scope)]);
        if (own.length > 0 && touches(list)) Object.assign(scoped, pair(group, without(list), true));
      }
      if (Object.keys(scoped).length > 0) {
        placeBlocks.push({ files: both(scope), rules: scoped });
      }
    }
  }

  const srcPlugins = merged(built, 'srcPlugins');
  const sourceSettings = multi ? merged(built, 'settings') : {};
  return [
    {
      files: scopeGlobs('src'),
      ...(Object.keys(srcPlugins).length === 0 ? {} : { plugins: srcPlugins }),
      ...(Object.keys(sourceSettings).length === 0 ? {} : { settings: sourceSettings }),
      rules: srcRules,
    },
    ...scopeBlocks,
    ...placeBlocks,
  ];
  };

  /** 全体に1回だけ当てるもの（prelude・言語の設定・プラグイン・src の外にも当てるルール・trailing）。どれかのソースに入っている部品から1回ずつ */
  /** @type {Map<Part, Contribution>} */
  const byPart = new Map();
  for (const { parts, built } of prepared) parts.forEach((part, index) => byPart.has(part) || byPart.set(part, /** @type {Contribution} */ (built[index])));
  const globalBuilt = [...byPart].sort(([a], [b]) => a.rank - b.rank || a.name.localeCompare(b.name)).map(([, contribution]) => contribution);
  const settings = multi ? {} : merged(globalBuilt, 'settings');
  const plugins = Object.assign({}, merged(globalBuilt, 'plugins'), ...prepared.flatMap(({ bans }) => bans.map((ban) => ban.plugins)));
  const configs = tseslint.config(
    ...globalBuilt.flatMap((contribution) => contribution.prelude ?? []),
    {
      languageOptions: Object.assign({}, ...globalBuilt.map((contribution) => contribution.languageOptions ?? {})),
      plugins: alias ? { ...plugins, [warnPlugin]: { rules: Object.fromEntries(combined.map(({ ruleId }) => [ruleId, builtinRules.get(ruleId)])) } } : plugins,
      ...(Object.keys(settings).length === 0 ? {} : { settings }),
      rules: merged(globalBuilt, 'rules'),
    },
    ...prepared.flatMap(blocksOf),
    ...globalBuilt.flatMap((contribution) => contribution.trailing ?? []),
  );
  return lowerRules(configs, Object.keys(severity).filter((name) => !banNames.has(name)), banNames);
}

/** 禁止を warn に下げたときの、合成した禁止のルールの置き場所（プラグインの名前） */
export const warnPlugin = 'bugyo-warn';

/**
 * ルール ID で指定したものを、どのブロックでも warn に下げる。知らない名前があれば断る。
 *
 * @param {import('eslint').Linter.Config[]} configs
 * @param {string[]} ruleIds
 * @param {Set<string>} banNames
 */
function lowerRules(configs, ruleIds, banNames) {
  if (ruleIds.length === 0) return configs;
  const known = new Set(configs.flatMap((block) => Object.keys(block.rules ?? {})));
  const unknown = ruleIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(
      say({
        en: `${unknown.join(', ')} in bugyo({ severity }) is neither a ban name (${[...banNames].sort().join(', ')}) nor a rule ID in the config`,
        ja: `bugyo({ severity }) の ${unknown.join(', ')} は、禁止の名前（${[...banNames].sort().join(', ')}）でも、設定にあるルール ID でもありません`,
      }),
    );
  }
  const lowered = new Set(ruleIds);
  return configs.map((block) =>
    block.rules === undefined
      ? block
      : { ...block, rules: Object.fromEntries(Object.entries(block.rules).map(([id, value]) => [id, lowered.has(id) ? lower(value) : value])) },
  );
}
