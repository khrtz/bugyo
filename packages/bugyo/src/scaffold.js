import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { configFile, loadConfig } from './config.js';
import { featureDir } from './feature-map.js';

const templateRoot = resolve(import.meta.dirname, '..', 'template');
export const defaultTemplate = 'react-vite';

/** @param {string} id */
function pascal(id) {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * @param {string} cwd
 * @param {Record<string, string>} files
 */
function writeAll(cwd, files) {
  for (const path of Object.keys(files)) {
    if (existsSync(join(cwd, path))) throw new Error(`${path} はすでにあります。上書きしません`);
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return Object.keys(files);
}

/**
 * feature map の雛形。4つの見出しは雛形のまま（`（…）` と `：` の後が空の項目）で、埋めるまで task done の feature は通らない。
 *
 * @param {string} id
 * @param {string} spec
 * @param {string | undefined} route
 * @param {string} reach
 */
function featureMapDoc(id, spec, route, reach) {
  return `---
id: ${id}
${route === undefined ? '' : `route: ${route}\n`}spec: ${spec}
---

# ${id}

## 何があるか
- （利用者から見える機能を箇条書きで）

## どう辿り着くか
- （${reach}）

## どう操作して確かめるか
- \`pnpm verify ${id}\`
- 成功：
- エラー：
- 空：
${route === undefined ? '' : '- 永続化：\n'}
## よく嘘をつくところ
- （見た目は通るのに壊れている、が起きやすい点）
`;
}

/**
 * @param {string} cwd
 * @param {string} id
 * @param {string[]} created
 */
function appendSweepOrder(cwd, id, created) {
  appendFileSync(join(cwd, featureDir, 'README.md'), `1. [${id}](${id}.md)\n`);
  created.push(`${featureDir}/README.md（回帰の順番に追記）`);
}

/**
 * React + Vite のテンプレート: ui / model / api / index.ts・feature map・E2E spec・サンプルデータ。
 *
 * @param {string} id
 * @param {string} cwd
 * @param {string} src
 */
function reactFeature(id, cwd, src) {
  const P = pascal(id);
  const base = `${src}/features/${id}`;

  const created = writeAll(cwd, {
    [`${base}/model/${id}.ts`]: `import { z } from 'zod';

export const ${P}Item = z.object({
  id: z.string().min(1),
  name: z.string(),
});
export type ${P}Item = z.infer<typeof ${P}Item>;

export function count${P}(items: readonly ${P}Item[]): number {
  return items.length;
}
`,
    [`${base}/model/${id}.test.ts`]: `import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { count${P}, ${P}Item } from './${id}';

const itemArb = fc.record({ id: fc.string({ minLength: 1 }), name: fc.string() }).map((raw) => ${P}Item.parse(raw));

describe('${id} model', () => {
  it('件数は配列の長さと一致する', () => {
    fc.assert(
      fc.property(fc.array(itemArb), (items) => {
        expect(count${P}(items)).toBe(items.length);
      }),
    );
  });
});
`,
    [`${base}/api/use${P}Query.ts`]: `import { z } from 'zod';
import { getJson, useRemoteQuery, type Remote } from '@/shared/api';
import { ${P}Item } from '../model/${id}';

export function use${P}Query(): Remote<${P}Item[]> {
  return useRemoteQuery(['${id}'], () => getJson('/api/${id}.json', z.array(${P}Item)));
}
`,
    [`${base}/ui/${P}View.tsx`]: `import { use${P}Query } from '../api/use${P}Query';
import { count${P} } from '../model/${id}';

export function ${P}View() {
  const query = use${P}Query();
  switch (query.status) {
    case 'loading':
      return <p role="status">読み込み中…</p>;
    case 'error':
      return <p role="alert">読み込みに失敗しました: {query.error.message}</p>;
    case 'ready':
      return (
        <section aria-label="${id}">
          <h2>${id}</h2>
          <p>{count${P}(query.data)} 件</p>
          <ul>
            {query.data.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        </section>
      );
  }
}
`,
    [`${base}/index.ts`]: `export { ${P}View } from './ui/${P}View';
`,
    [`public/api/${id}.json`]: `[
  { "id": "1", "name": "サンプル" }
]
`,
    [`e2e/${id}.spec.ts`]: `import { expect, test } from '@playwright/test';

test('${id} を表示できる', async ({ page }) => {
  await page.goto('/');
  const section = page.getByRole('region', { name: '${id}' });
  await expect(section).toBeVisible();
  await expect(section.getByText('1 件')).toBeVisible();
});
`,
    [`${featureDir}/${id}.md`]: featureMapDoc(id, `e2e/${id}.spec.ts`, '/', 'どの画面から、どの操作で着くか'),
  });

  appendSweepOrder(cwd, id, created);
  return {
    created,
    next: [
      `画面に組み込む: import { ${P}View } from '@/features/${id}'; を src/app から使う（使うまで knip が「未使用」と止めます）`,
      `docs/features/${id}.md の4つの見出しを埋める`,
      `pnpm check && pnpm test && pnpm verify ${id}`,
    ],
  };
}

/**
 * 画面のない TypeScript のライブラリ／CLI のテンプレート: model・index.ts・テスト・確かめるスクリプト・feature map。
 *
 * @param {string} id
 * @param {string} cwd
 * @param {import('./index.js').BugyoConfig} config
 */
function nodeLibFeature(id, cwd, config) {
  const { featuresDir, specDir, specSuffix } = config.featureMap;
  if (featuresDir === null || specDir === null) {
    throw new Error(`${configFile} の featureMap.featuresDir と featureMap.specDir がないと、node-lib の機能を置く場所が決まりません`);
  }
  const P = pascal(id);
  const run = `run${P}`;
  const base = `${featuresDir}/${id}`;
  const spec = `${specDir}/${id}${specSuffix}`;
  const fromSpec = posix.relative(specDir, `${base}/index.ts`);

  const created = writeAll(cwd, {
    [`${base}/model/${id}.ts`]: `export function ${run}(input: string): string {
  return input.trim();
}
`,
    [`${base}/model/${id}.test.ts`]: `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ${run} } from './${id}.ts';

await test('前後の空白を取り除く', () => {
  assert.equal(${run}('  サンプル  '), 'サンプル');
});
`,
    [`${base}/index.ts`]: `export { ${run} } from './model/${id}.ts';
`,
    [spec]: `import assert from 'node:assert/strict';
import { ${run} } from '${fromSpec.startsWith('.') ? fromSpec : `./${fromSpec}`}';

assert.equal(${run}('  サンプル  '), 'サンプル');

console.log('${id}: ok');
`,
    [`${featureDir}/${id}.md`]: featureMapDoc(id, spec, undefined, 'どの関数・どのコマンドから使うか'),
  });

  appendSweepOrder(cwd, id, created);
  return {
    created,
    next: [
      `${base}/model/${id}.ts を本当の振る舞いに書き換え、そのテストと ${spec}（実際に動かして確かめるスクリプト）も合わせる`,
      `外に見せるなら src/index.ts から、コマンドなら src/app から ${base}/index.ts を使う`,
      `docs/features/${id}.md の4つの見出しを埋める`,
      `pnpm check && pnpm test && pnpm verify ${id}`,
    ],
  };
}

/**
 * 新しい feature を作る。何を作るかは `.bugyo/config.json` の template で決まる（ないときは react-vite）。
 *
 * @param {string} id
 * @param {{ cwd?: string, src?: string }} [options]
 * @returns {{ created: string[], next: string[] }}
 */
export function newFeature(id, options = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`feature 名 "${id}" は小文字・数字・ハイフンにしてください（例: user-settings）`);
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  if (config.layers !== undefined) {
    throw new Error(
      `${configFile} に layers があるので、new feature は雛形を作りません（雛形は src/features の形でしか作れないため）。${config.layers.features}/${id} を手で作り、docs/features/${id}.md を足してください`,
    );
  }
  if (config.sources !== undefined) {
    const dirs = Object.values(config.sources).map((source) => `${source.layers.features}/${id}`);
    throw new Error(`${configFile} に sources があるので、new feature は雛形を作りません。${dirs.join('・')} のうち使うものを手で作り、docs/features/${id}.md を足してください`);
  }
  const template = config.template ?? defaultTemplate;
  switch (template) {
    case 'react-vite':
      return reactFeature(id, cwd, options.src ?? 'src');
    case 'node-lib':
      return nodeLibFeature(id, cwd, config);
    default:
      throw new Error(
        `${configFile} の template "${template}" には new feature の雛形がありません（雛形があるのは react-vite と node-lib）。src/features/${id} は手で作り、docs/features/${id}.md を足してください`,
      );
  }
}

/** 使えるテンプレートの名前 */
export function templates() {
  if (!existsSync(templateRoot)) return [];
  return readdirSync(templateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * bugyo の土台が入った新しいプロジェクトを作る。使ったテンプレートの名前は .bugyo/config.json に残す。
 *
 * @param {string} target
 * @param {{ template?: string, lintVersion?: string, lintReactVersion?: string, bugyoVersion?: string }} [options]
 */
export function init(target, options = {}) {
  const template = options.template ?? defaultTemplate;
  const names = templates();
  if (names.length === 0) throw new Error(`テンプレートが見つかりません: ${templateRoot}`);
  if (!names.includes(template)) throw new Error(`テンプレート "${template}" はありません。使える名前: ${names.join(', ')}`);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} は空ではありません`);
  cpSync(join(templateRoot, template), dir, { recursive: true });

  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const self = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
  /** @type {Record<string, string | undefined>} */
  const pinned = { bugyo: options.bugyoVersion, '@bugyo/lint': options.lintVersion, '@bugyo/lint-react': options.lintReactVersion };
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    if (String(version).startsWith('workspace:')) pkg.devDependencies[name] = pinned[name] ?? `^${self.version}`;
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const gitignore = join(dir, '_gitignore');
  if (existsSync(gitignore)) renameSync(gitignore, join(dir, '.gitignore'));

  const configPath = join(dir, configFile);
  const existing = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(Object.assign({ template }, existing, { template }), null, 2)}\n`);
  return dir;
}
