/**
 * @param {unknown} option
 * @returns {'en' | 'ja'}
 */
function resolveLocale(option) {
  const chosen = option ?? (process.env['BUGYO_LOCALE'] || undefined) ?? configLocale();
  if (chosen === undefined) return 'en';
  if (chosen === 'en' || chosen === 'ja') return chosen;
  throw new Error(`locale must be one of en, ja / locale は en / ja のどれかです: ${String(chosen)}`);
}

function configLocale() {
  const file = require('node:path').join(process.cwd(), '.bugyo', 'config.json');
  try {
    const locale = JSON.parse(require('node:fs').readFileSync(file, 'utf8')).locale;
    return typeof locale === 'string' ? locale : undefined;
  } catch {
    return undefined;
  }
}

/**
 * bugyo の dependency-cruiser 設定を作る。
 * 利用側の .dependency-cruiser.cjs で `module.exports = require('@bugyo/lint/depcruise').config()` とする。
 *
 * React を使うなら `react: true` にする。`model-is-pure` が React とその周辺（react・react-dom・@tanstack）への依存も止める。既定は false。
 *
 * `locale` でルールの説明の言語を選ぶ（`en` か `ja`）。なければ環境変数 `BUGYO_LOCALE`、今のフォルダの `.bugyo/config.json` の `locale` の順に見て、どれもなければ `en`。
 *
 * `layers` で層のフォルダの場所を変えられる（ESLint の `bugyo({ layers })` と同じ形。指定のないところは `<src>/app` などで埋める）。
 *
 * @param {{
 *   src?: string,
 *   tsConfig?: string,
 *   forbidden?: object[],
 *   react?: boolean,
 *   locale?: 'en' | 'ja',
 *   layers?: {
 *     app?: string,
 *     features?: string,
 *     shared?: { ui?: string | string[], api?: string | string[], lib?: string | string[], model?: string | string[], other?: string | string[] },
 *     featureParts?: { ui?: string[], api?: string[], model?: string[] },
 *   },
 * }} [options]
 */
function config(options = {}) {
  const locale = resolveLocale(options.locale);
  const t = (/** @type {{ en: string, ja: string }} */ text) => text[locale];
  const src = options.src ?? 'src';
  const react = options.react ?? false;
  const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = escape(src);
  const layers = options.layers;
  const trim = (/** @type {string} */ path) => escape(path.replace(/^\.\//, '').replace(/\/+$/, ''));
  const dir = (/** @type {string | undefined} */ value, /** @type {string} */ fallback) => trim(value ?? `${src}/${fallback}`);
  /** @returns {string[]} */
  const dirs = (/** @type {string | string[] | undefined} */ value, /** @type {string[]} */ fallback) =>
    value === undefined ? fallback.map(trim) : (typeof value === 'string' ? [value] : value).map(trim);
  const any = (/** @type {string[]} */ list) => `(${list.join('|')})`;
  /** @type {{ features: string, app: string, shared: string, sharedTo: string, modelTo: string, model: string, sharedModel?: string, sharedModelTo?: string }} */
  const p =
    layers === undefined
      ? {
          features: `${s}/features`,
          app: `^${s}/app/`,
          shared: `${s}/shared`,
          sharedTo: `^${s}/(features|app)/`,
          modelTo: `^${s}/(features|shared/(ui|api)|app)/`,
          model: 'model',
        }
      : (() => {
          const features = dir(layers.features, 'features');
          const app = dir(layers.app, 'app');
          const ui = dirs(layers.shared?.ui, [`${src}/shared/ui`]);
          const api = dirs(layers.shared?.api, [`${src}/shared/api`]);
          const lib = dirs(layers.shared?.lib, [`${src}/shared/lib`]);
          const sharedModel = dirs(layers.shared?.model, []);
          const other = dirs(layers.shared?.other, []);
          const impure = [...ui, ...api, ...other];
          const impureTo = `^(${any([features, ...impure])}/|${app}(/|$))`;
          return {
            features,
            app: `^${app}(/|$)`,
            shared: any([...ui, ...api, ...lib, ...sharedModel, ...other]),
            sharedTo: `^(${features}/|${app}(/|$))`,
            modelTo: impureTo,
            model: any((layers.featureParts?.model ?? ['model']).map(escape)),
            ...(sharedModel.length === 0 ? {} : { sharedModel: any(sharedModel), sharedModelTo: impureTo }),
          };
        })();
  const reactLibs = '(^|/)node_modules/(react|react-dom|@tanstack)/';
  return {
    forbidden: [
      {
        name: 'no-circular',
        severity: 'error',
        comment: t({ en: 'A circular dependency breaks the design. Move the common part into shared, or make the dependencies point one way.', ja: '循環依存は設計の崩れです。共通部分を shared に切り出すか、依存の向きを揃えてください。' }),
        from: {},
        to: { circular: true },
      },
      {
        name: 'feature-internals-only-via-index',
        severity: 'error',
        comment: t({ en: 'Do not depend on another feature\'s internals. Use what features/<name>/index.ts exports.', ja: '他のfeatureの内部には依存できません。features/<名前>/index.ts から公開されたものを使ってください。' }),
        from: { path: `^${p.features}/([^/]+)/` },
        to: {
          path: `^${p.features}/([^/]+)/.+`,
          pathNot: [`^${p.features}/$1/`, `^${p.features}/[^/]+/index[.]ts$`],
        },
      },
      {
        name: 'app-only-via-feature-index',
        severity: 'error',
        comment: t({ en: 'app can only import features/<name>/index.ts.', ja: 'app は features/<名前>/index.ts だけをimportできます。' }),
        from: { path: p.app },
        to: { path: `^${p.features}/[^/]+/.+`, pathNot: `^${p.features}/[^/]+/index[.]ts$` },
      },
      {
        name: 'shared-is-leaf',
        severity: 'error',
        comment: t({ en: 'shared cannot depend on features or app.', ja: 'shared は features や app に依存できません。' }),
        from: { path: `^${p.shared}/` },
        to: { path: p.sharedTo },
      },
      {
        name: 'features-not-to-app',
        severity: 'error',
        comment: t({ en: 'features cannot depend on app.', ja: 'features は app に依存できません。' }),
        from: { path: `^${p.features}/` },
        to: { path: p.app },
      },
      {
        name: 'model-is-pure',
        severity: 'error',
        comment: t({ en: 'model/ can only use its own model, shared/lib, and pure libraries.', ja: 'model/ が使えるのは自分のmodel、shared/lib、純粋なライブラリだけです。' }),
        from: { path: `^${p.features}/([^/]+)/${p.model}/` },
        to: {
          path: react ? `(${p.modelTo}|${reactLibs})` : p.modelTo,
          pathNot: `^${p.features}/$1/${p.model}/`,
        },
      },
      ...(p.sharedModel === undefined || p.sharedModelTo === undefined
        ? []
        : [
            {
              name: 'shared-model-is-pure',
              severity: 'error',
              comment: t({ en: 'A shared model can only use the shared lib and model, and pure libraries.', ja: '共有の model が使えるのは shared の lib と model、純粋なライブラリだけです。' }),
              from: { path: `^${p.sharedModel}/` },
              to: { path: react ? `(${p.sharedModelTo}|${reactLibs})` : p.sharedModelTo },
            },
          ]),
      {
        name: 'not-to-unresolvable',
        severity: 'error',
        from: {},
        to: { couldNotResolve: true },
      },
      ...(options.forbidden ?? []),
    ],
    options: {
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
      tsConfig: { fileName: options.tsConfig ?? 'tsconfig.json' },
      enhancedResolveOptions: {
        exportsFields: ['exports'],
        conditionNames: ['import', 'require', 'node', 'default', 'types'],
      },
    },
  };
}

module.exports = { config };
