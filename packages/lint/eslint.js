import js from '@eslint/js';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { noComments as noCommentsRule } from './rules/no-comments.js';

/**
 * @typedef {import('./index.js').BugyoOptions} BugyoOptions
 * @typedef {import('./index.js').BanSpec} BanSpec
 * @typedef {{
 *   app: string,
 *   features: string,
 *   shared: { ui: string[], api: string[], lib: string[], model: string[], other: string[] },
 *   featureParts: { ui: string[], api: string[], model: string[] },
 * }} Layers
 * @typedef {Required<Omit<BugyoOptions, 'parts' | 'layers' | 'severity'>> & {
 *   layers: Layers,
 *   customLayers: boolean,
 *   featuresLabel: string,
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
    throw new Error(`禁止の name は小文字・数字・ハイフンにしてください（例: no-date-now）: ${String(name)}`);
  }
  const unknown = Object.keys(spec).filter((key) => !banKeys.has(key));
  if (unknown.length > 0) throw new Error(`禁止 ${name} に知らない項目があります: ${unknown.join(', ')}（使えるのは ${[...banKeys].join(', ')}）`);
  const scope = spec.scope ?? 'src';
  if (typeof scope !== 'string' || scope === '') throw new Error(`禁止 ${name} の scope は ${namedScopes.join(' / ')} か glob の文字列です`);
  const allow = spec.allow ?? [];
  if (!Array.isArray(allow) || allow.some((place) => typeof place !== 'string' || place === '')) {
    throw new Error(`禁止 ${name} の allow は、${namedPlaces.join(' / ')} か glob の文字列の配列です`);
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
  const combinedSize = ban.imports.paths.length + ban.imports.patterns.length + ban.globals.length + ban.syntax.length + ban.properties.length;
  if (combinedSize + Object.keys(ban.rules).length === 0) throw new Error(`禁止 ${name} は何も止めていません。imports・globals・syntax・properties・rules のどれかを書いてください`);
  if (combinedSize > 0 && !namedScopes.includes(scope)) {
    throw new Error(
      `禁止 ${name}: imports・globals・syntax・properties は、scope を ${namedScopes.join(' / ')} のどれかにしてください（glob の範囲では、bugyo の禁止と合成したルールが上書きし合うため）。範囲を絞るなら、scope は src のまま allow で除くか、rules で書いてください`,
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
    throw new Error(`禁止の name は小文字・数字・ハイフンにしてください（例: no-date-now）: ${String(rest.name)}`);
  }
  if (build !== undefined && typeof build !== 'function') throw new Error(`禁止 ${rest.name} の build は関数です`);
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
        message: `fetchを直接呼ばないでください。${context.apiClientDir} のクライアントを使い、スキーマで応答を検証してください。`,
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
      bugyo: { rules: { 'no-comments': noCommentsRule } },
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
    const { root, src, layers, customLayers } = context;
    const { app, features, shared, featureParts } = layers;
    const featuresName = features.split('/').at(-1) ?? features;
    const outerParts = [...featureParts.ui, ...featureParts.api];
    const roleLabel = (/** @type {string[]} */ list) => list.map((name) => `${name}/`).join('・');
    const internals = customLayers ? [`**/${featuresName}/*/*`] : ['@/features/*/*', '**/features/*/*'];
    const indexes = customLayers ? [`!**/${featuresName}/*/index.ts`] : ['!@/features/*/index.ts', '!**/features/*/index.ts'];
    const sharedDirs = [...shared.ui, ...shared.api, ...shared.lib, ...shared.model, ...shared.other];
    const pureDirs = [...shared.lib, ...shared.model].join('・');
    const zones = customLayers
      ? [
          {
            target: sharedDirs.map((dir) => `./${dir}`),
            from: [`./${features}`, `./${app}`],
            message: `${sharedDirs.join('・')} は ${features} や ${app} に依存できません。`,
          },
          { target: `./${features}`, from: `./${app}`, message: `${features} は ${app} に依存できません。` },
          {
            target: featureParts.model.map((name) => `./${features}/*/${name}/**/*`),
            from: [...shared.ui, ...shared.api, ...shared.other].map((dir) => `./${dir}`),
            message: `${roleLabel(featureParts.model)} が使えるのは自分の${roleLabel(featureParts.model)}と ${pureDirs} だけです。`,
          },
          ...(shared.model.length === 0
            ? []
            : [
                {
                  target: shared.model.map((dir) => `./${dir}`),
                  from: [...shared.ui, ...shared.api, ...shared.other].map((dir) => `./${dir}`),
                  message: `${shared.model.join('・')} が使えるのは ${pureDirs} だけです。`,
                },
              ]),
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
                message: `featureの内部ファイルは直接importできません。${customLayers ? features : 'features'}/<名前>/index.ts から公開されたものを使ってください。`,
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
                    message: `${roleLabel(featureParts.model)} から ${roleLabel(outerParts)} はimportできません。依存の向きは ${roleLabel(featureParts.ui)} → ${roleLabel(featureParts.api)} → ${roleLabel(featureParts.model)} です。`,
                  }
                : {
                    group: ['../ui', '../ui/*', '../api', '../api/*'],
                    message: 'model/ から ui/ や api/ はimportできません。依存の向きは ui → api → model です。',
                  },
              ...(customLayers
                ? []
                : [
                    {
                      group: ['@/shared/ui', '@/shared/ui/*', '@/shared/api', '@/shared/api/*'],
                      message: 'model/ が使えるのは自分のmodelと shared/lib だけです。',
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
      throw new Error(`bugyo({ layers }) の featureParts.${role} は、feature の中のフォルダ名（/ を含まない）の配列にしてください`);
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
      throw new Error(`bugyo({ layers }) の shared.${role} は、フォルダ1つか、フォルダの空でない配列にしてください`);
    }
    return list.map(trimSlash);
  };
  const featureParts = { ui: names('ui', parts?.ui), api: names('api', parts?.api), model: names('model', parts?.model) };
  const all = [...featureParts.ui, ...featureParts.api, ...featureParts.model];
  const twice = all.filter((name, index) => all.indexOf(name) !== index);
  if (twice.length > 0) throw new Error(`bugyo({ layers }) の featureParts で ${[...new Set(twice)].join(', ')} が2つの役割に入っています。1つのフォルダは1つの役割にしてください`);
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
  if (outside.length > 0) throw new Error(`bugyo({ layers }) の ${outside.join(', ')} が src（${src}）の中にありません。src に層をまとめて入れるフォルダを渡してください`);
  return resolved;
}

/** @param {string} path */
const trimSlash = (path) => path.replace(/^\.\//, '').replace(/\/+$/, '');

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
    ]).flatMap(([kind, list]) => list.map((value) => ({ name: ban.name, scope: ban.scope, allow: ban.allow, kind, value }))),
  );

/** @param {Contribution[]} list @param {'plugins' | 'settings' | 'rules' | 'srcPlugins' | 'srcRules'} key */
const merged = (list, key) => Object.assign({}, ...list.map((contribution) => contribution[key] ?? {}));

/** @param {unknown} value */
const lower = (value) => {
  if (value === 'error' || value === 2) return 'warn';
  if (Array.isArray(value) && (value[0] === 'error' || value[0] === 2)) return ['warn', ...value.slice(1)];
  return value;
};

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
  const { root, src = 'src', ignores = [], parts = [common, structure], explicitExtensions = false } = options;
  if (typeof root !== 'string') throw new Error('bugyo({ root }) に import.meta.dirname を渡してください');
  if ('extra' in options) {
    throw new Error('bugyo({ extra }) はありません。独自の禁止は defineBan({ name, ... }) で作り、parts に足してください');
  }
  if (!parts.includes(common)) throw new Error('bugyo({ parts }) には common を必ず入れてください');
  const layers = resolveLayers(src, options.layers);
  const effectsDirs = options.effectHooksDir === undefined ? layers.shared.lib : [trimSlash(options.effectHooksDir)];
  const apiDirs = options.apiClientDir === undefined ? layers.shared.api : [trimSlash(options.apiClientDir)];
  const effectHooksDir = effectsDirs.join('・');
  const apiClientDir = apiDirs.join('・');
  const customLayers = options.layers !== undefined;

  /** @type {Context} */
  const context = {
    root,
    src,
    effectHooksDir,
    apiClientDir,
    ignores,
    explicitExtensions,
    layers,
    customLayers,
    featuresLabel: customLayers ? layers.features : 'features',
  };
  const built = [...new Set(parts)].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map((part) => part.build(context));
  const bans = built.flatMap((contribution) => contribution.bans ?? []);

  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const ban of bans) seen.set(ban.name, (seen.get(ban.name) ?? 0) + 1);
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
  if (duplicated.length > 0) throw new Error(`同じ名前の禁止が2つ以上あります: ${duplicated.join(', ')}。名前を変えてください`);
  const banNames = new Set(seen.keys());

  const severity = options.severity ?? {};
  for (const [name, level] of Object.entries(severity)) {
    if (level !== 'warn') throw new Error(`bugyo({ severity }) で下げられるのは 'warn' だけです（${name}: ${String(level)}）`);
  }
  const warned = new Set(Object.keys(severity).filter((name) => banNames.has(name)));

  const entries = entriesOf(bans);
  const alias = entries.some((entry) => warned.has(entry.name));

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
        return [scope];
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
        return [place];
    }
  };

  /** @param {Ban} ban */
  const banRules = (ban) => Object.fromEntries(Object.entries(ban.rules).map(([id, value]) => [id, warned.has(ban.name) ? lower(value) : value]));

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
    /** @type {Record<string, unknown>} */
    const rules = {};
    for (const ban of bans) if (ban.allow.includes(place)) for (const id of Object.keys(ban.rules)) rules[id] = 'off';
    for (const group of combined) {
      const list = inGroup(group, srcEntries);
      if (touches(list)) Object.assign(rules, pair(group, without(list), true));
    }
    if (Object.keys(rules).length > 0) placeBlocks.push({ files: placeGlobs(place), rules });
    for (const scope of scopes) {
      /** @type {Record<string, unknown>} */
      const scoped = {};
      for (const group of combined) {
        const own = inGroup(group, scopeEntries(scope));
        const list = inGroup(group, [...srcEntries, ...scopeEntries(scope)]);
        if (own.length > 0 && touches(list)) Object.assign(scoped, pair(group, without(list), true));
      }
      if (Object.keys(scoped).length > 0) {
        placeBlocks.push({ files: scopeGlobs(scope).flatMap((scopeGlob) => placeGlobs(place).map((placeGlob) => [scopeGlob, placeGlob])), rules: scoped });
      }
    }
  }

  const settings = merged(built, 'settings');
  const plugins = Object.assign({}, merged(built, 'plugins'), ...bans.map((ban) => ban.plugins));
  const srcPlugins = merged(built, 'srcPlugins');
  const configs = tseslint.config(
    ...built.flatMap((contribution) => contribution.prelude ?? []),
    {
      languageOptions: Object.assign({}, ...built.map((contribution) => contribution.languageOptions ?? {})),
      plugins: alias ? { ...plugins, [warnPlugin]: { rules: Object.fromEntries(combined.map(({ ruleId }) => [ruleId, builtinRules.get(ruleId)])) } } : plugins,
      ...(Object.keys(settings).length === 0 ? {} : { settings }),
      rules: merged(built, 'rules'),
    },
    {
      files: scopeGlobs('src'),
      ...(Object.keys(srcPlugins).length === 0 ? {} : { plugins: srcPlugins }),
      rules: srcRules,
    },
    ...scopeBlocks,
    ...placeBlocks,
    ...built.flatMap((contribution) => contribution.trailing ?? []),
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
      `bugyo({ severity }) の ${unknown.join(', ')} は、禁止の名前（${[...banNames].sort().join(', ')}）でも、設定にあるルール ID でもありません`,
    );
  }
  const lowered = new Set(ruleIds);
  return configs.map((block) =>
    block.rules === undefined
      ? block
      : { ...block, rules: Object.fromEntries(Object.entries(block.rules).map(([id, value]) => [id, lowered.has(id) ? lower(value) : value])) },
  );
}
