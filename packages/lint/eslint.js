import js from '@eslint/js';
import comments from '@eslint-community/eslint-plugin-eslint-comments';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { noComments } from './rules/no-comments.js';

/**
 * bugyo の ESLint flat config を作る。
 * no-restricted-imports / no-restricted-globals はスコープごとに1つの設定へ合成して返すので、
 * 利用側で同じルールを上書きせず、追加の禁止は `extra` で渡すこと。
 *
 * @param {import('./index.js').BugyoOptions} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function bugyo(options) {
  const {
    root,
    src = 'src',
    effectHooksDir = `${src}/shared/lib`,
    apiClientDir = `${src}/shared/api`,
    ignores = [],
    extra = {},
  } = options;
  if (typeof root !== 'string') throw new Error('bugyo({ root }) に import.meta.dirname を渡してください');

  const extraPaths = extra.restrictedImports?.paths ?? [];
  const extraPatterns = extra.restrictedImports?.patterns ?? [];
  const extraGlobals = extra.restrictedGlobals ?? [];
  const extraProperties = extra.restrictedProperties ?? [];
  const extraSyntax = extra.restrictedSyntax ?? [];

  const effectBan = {
    name: 'react',
    importNames: ['useEffect', 'useLayoutEffect'],
    message: `製品コードでuseEffectは使えません。データ取得は features/*/api の useXxxQuery、購読やタイマーは ${effectHooksDir} の専用フックを使ってください。該当するフックがなければ ${effectHooksDir} に追加してください。`,
  };

  const featureInternals = {
    group: ['@/features/*/*', '**/features/*/*'],
    message: 'featureの内部ファイルは直接importできません。features/<名前>/index.ts から公開されたものを使ってください。',
  };

  const modelBans = [
    {
      group: ['react', 'react-dom', 'react/*', 'react-dom/*', '@tanstack/*'],
      message: 'model/ は純粋関数だけです。Reactや通信に依存する処理は ui/ か api/ に置いてください。',
    },
    {
      group: ['../ui', '../ui/*', '../api', '../api/*'],
      message: 'model/ から ui/ や api/ はimportできません。依存の向きは ui → api → model です。',
    },
    {
      group: ['@/shared/ui', '@/shared/ui/*', '@/shared/api', '@/shared/api/*'],
      message: 'model/ が使えるのは自分のmodelと shared/lib だけです。',
    },
  ];

  const fetchBan = {
    name: 'fetch',
    message: `fetchを直接呼ばないでください。${apiClientDir} のクライアントを使い、スキーマで応答を検証してください。`,
  };

  const timingBans = ['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
    name,
    message: `UIで${name}によるタイミング合わせはできません。根本原因（状態の持ち方・データの流れ）を直してください。時間に依存する処理が本当に必要なら ${effectHooksDir} に専用フックを作ってください。`,
  }));

  const effectSyntaxBan = {
    selector: "MemberExpression[object.name='React'][property.name=/^use(Layout)?Effect$/]",
    message: effectBan.message,
  };

  const imports = (/** @type {object[]} */ paths, /** @type {object[]} */ patterns) => [
    'error',
    { paths: [...paths, ...extraPaths], patterns: [...patterns, ...extraPatterns] },
  ];
  const globalsBan = (/** @type {object[]} */ names) => ['error', ...names, ...extraGlobals];

  return tseslint.config(
    { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
    { ignores: ['dist', 'artifacts', 'playwright-report', 'test-results', 'node_modules', ...ignores] },

    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: root },
        globals: { ...globals.browser, ...globals.node },
      },
      plugins: {
        'import-x': importX,
        '@eslint-community/eslint-comments': comments,
        bugyo: { rules: { 'no-comments': noComments } },
      },
      settings: {
        'import-x/resolver-next': [createTypeScriptImportResolver({ project: `${root}/tsconfig.json` })],
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
    },

    {
      files: [`${src}/**/*.{ts,tsx}`],
      plugins: { 'react-hooks': reactHooks },
      rules: {
        ...reactHooks.configs.recommended.rules,
        'bugyo/no-comments': 'error',
        'no-restricted-imports': imports([effectBan], [featureInternals]),
        'no-restricted-syntax': ['error', effectSyntaxBan, ...extraSyntax],
        'no-restricted-properties': extraProperties.length > 0 ? ['error', ...extraProperties] : 'off',
        'no-restricted-globals': globalsBan([fetchBan]),
        'import-x/no-restricted-paths': [
          'error',
          {
            basePath: root,
            zones: [
              {
                target: `./${src}/shared`,
                from: [`./${src}/features`, `./${src}/app`],
                message: 'shared は features や app に依存できません。',
              },
              { target: `./${src}/features`, from: `./${src}/app`, message: 'features は app に依存できません。' },
            ],
          },
        ],
      },
    },
    {
      files: [`${src}/features/*/ui/**/*.{ts,tsx}`],
      rules: { 'no-restricted-globals': globalsBan([fetchBan, ...timingBans]) },
    },
    {
      files: [`${src}/features/*/model/**/*.ts`],
      rules: { 'no-restricted-imports': imports([effectBan], [featureInternals, ...modelBans]) },
    },
    {
      files: [`${effectHooksDir}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': imports([], [featureInternals]),
        'no-restricted-syntax': 'off',
        'no-restricted-properties': 'off',
      },
    },
    {
      files: [`${apiClientDir}/**/*.ts`],
      rules: { 'no-restricted-globals': extraGlobals.length > 0 ? globalsBan([]) : 'off' },
    },
    {
      files: [`${src}/**/*.test.{ts,tsx}`],
      rules: {
        'no-restricted-globals': extraGlobals.length > 0 ? globalsBan([]) : 'off',
        'no-restricted-properties': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      files: ['**/*.{js,cjs,mjs}'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ['**/*.cjs'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
  );
}
