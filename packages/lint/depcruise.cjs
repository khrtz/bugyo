/**
 * bugyo の dependency-cruiser 設定を作る。
 * 利用側の .dependency-cruiser.cjs で `module.exports = require('@bugyo/lint/depcruise').config()` とする。
 *
 * React を使うなら `react: true` にする。`model-is-pure` が React とその周辺（react・react-dom・@tanstack）への依存も止める。既定は false。
 *
 * `layers` で層のフォルダの場所を変えられる（ESLint の `bugyo({ layers })` と同じ形。指定のないところは `<src>/app` などで埋める）。
 *
 * @param {{
 *   src?: string,
 *   tsConfig?: string,
 *   forbidden?: object[],
 *   react?: boolean,
 *   layers?: {
 *     app?: string,
 *     features?: string,
 *     shared?: { ui?: string, api?: string, lib?: string },
 *     featureParts?: { ui?: string[], api?: string[], model?: string[] },
 *   },
 * }} [options]
 */
function config(options = {}) {
  const src = options.src ?? 'src';
  const react = options.react ?? false;
  const escape = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const s = escape(src);
  const layers = options.layers;
  const dir = (/** @type {string | undefined} */ value, /** @type {string} */ fallback) => escape((value ?? `${src}/${fallback}`).replace(/^\.\//, '').replace(/\/+$/, ''));
  const p =
    layers === undefined
      ? {
          features: `${s}/features`,
          app: `${s}/app`,
          shared: `${s}/shared`,
          sharedTo: `^${s}/(features|app)/`,
          modelTo: `^${s}/(features|shared/(ui|api)|app)/`,
          model: 'model',
        }
      : (() => {
          const features = dir(layers.features, 'features');
          const app = dir(layers.app, 'app');
          const ui = dir(layers.shared?.ui, 'shared/ui');
          const api = dir(layers.shared?.api, 'shared/api');
          const lib = dir(layers.shared?.lib, 'shared/lib');
          return {
            features,
            app,
            shared: `(${ui}|${api}|${lib})`,
            sharedTo: `^(${features}|${app})/`,
            modelTo: `^(${features}|${ui}|${api}|${app})/`,
            model: `(${(layers.featureParts?.model ?? ['model']).map(escape).join('|')})`,
          };
        })();
  return {
    forbidden: [
      {
        name: 'no-circular',
        severity: 'error',
        comment: '循環依存は設計の崩れです。共通部分を shared に切り出すか、依存の向きを揃えてください。',
        from: {},
        to: { circular: true },
      },
      {
        name: 'feature-internals-only-via-index',
        severity: 'error',
        comment: '他のfeatureの内部には依存できません。features/<名前>/index.ts から公開されたものを使ってください。',
        from: { path: `^${p.features}/([^/]+)/` },
        to: {
          path: `^${p.features}/([^/]+)/.+`,
          pathNot: [`^${p.features}/$1/`, `^${p.features}/[^/]+/index[.]ts$`],
        },
      },
      {
        name: 'app-only-via-feature-index',
        severity: 'error',
        comment: 'app は features/<名前>/index.ts だけをimportできます。',
        from: { path: `^${p.app}/` },
        to: { path: `^${p.features}/[^/]+/.+`, pathNot: `^${p.features}/[^/]+/index[.]ts$` },
      },
      {
        name: 'shared-is-leaf',
        severity: 'error',
        comment: 'shared は features や app に依存できません。',
        from: { path: `^${p.shared}/` },
        to: { path: p.sharedTo },
      },
      {
        name: 'features-not-to-app',
        severity: 'error',
        comment: 'features は app に依存できません。',
        from: { path: `^${p.features}/` },
        to: { path: `^${p.app}/` },
      },
      {
        name: 'model-is-pure',
        severity: 'error',
        comment: 'model/ が使えるのは自分のmodel、shared/lib、純粋なライブラリだけです。',
        from: { path: `^${p.features}/([^/]+)/${p.model}/` },
        to: {
          path: react ? `(${p.modelTo}|(^|/)node_modules/(react|react-dom|@tanstack)/)` : p.modelTo,
          pathNot: `^${p.features}/$1/${p.model}/`,
        },
      },
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
