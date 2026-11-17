/**
 * bugyo の dependency-cruiser 設定を作る。
 * 利用側の .dependency-cruiser.cjs で `module.exports = require('@bugyo/lint/depcruise').config()` とする。
 *
 * React を使うなら `react: true` にする。`model-is-pure` が React とその周辺（react・react-dom・@tanstack）への依存も止める。既定は false。
 *
 * @param {{ src?: string, tsConfig?: string, forbidden?: object[], react?: boolean }} [options]
 */
function config(options = {}) {
  const src = options.src ?? 'src';
  const react = options.react ?? false;
  const s = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        from: { path: `^${s}/features/([^/]+)/` },
        to: {
          path: `^${s}/features/([^/]+)/.+`,
          pathNot: [`^${s}/features/$1/`, `^${s}/features/[^/]+/index[.]ts$`],
        },
      },
      {
        name: 'app-only-via-feature-index',
        severity: 'error',
        comment: 'app は features/<名前>/index.ts だけをimportできます。',
        from: { path: `^${s}/app/` },
        to: { path: `^${s}/features/[^/]+/.+`, pathNot: `^${s}/features/[^/]+/index[.]ts$` },
      },
      {
        name: 'shared-is-leaf',
        severity: 'error',
        comment: 'shared は features や app に依存できません。',
        from: { path: `^${s}/shared/` },
        to: { path: `^${s}/(features|app)/` },
      },
      {
        name: 'features-not-to-app',
        severity: 'error',
        comment: 'features は app に依存できません。',
        from: { path: `^${s}/features/` },
        to: { path: `^${s}/app/` },
      },
      {
        name: 'model-is-pure',
        severity: 'error',
        comment: 'model/ が使えるのは自分のmodel、shared/lib、純粋なライブラリだけです。',
        from: { path: `^${s}/features/([^/]+)/model/` },
        to: {
          path: react
            ? `(^${s}/(features|shared/(ui|api)|app)/|(^|/)node_modules/(react|react-dom|@tanstack)/)`
            : `^${s}/(features|shared/(ui|api)|app)/`,
          pathNot: `^${s}/features/$1/model/`,
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
