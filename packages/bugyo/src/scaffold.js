import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { featureDir } from './feature-map.js';

const templateDir = resolve(import.meta.dirname, '..', 'template');

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
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    if (existsSync(full)) throw new Error(`${path} はすでにあります。上書きしません`);
  }
  for (const [path, content] of Object.entries(files)) {
    const full = join(cwd, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return Object.keys(files);
}

/**
 * 新しい feature を、ui / model / api / index.ts・feature map・E2E spec・サンプルデータつきで作る。
 *
 * @param {string} id
 * @param {{ cwd?: string, src?: string }} [options]
 */
export function newFeature(id, options = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`feature 名 "${id}" は小文字・数字・ハイフンにしてください（例: user-settings）`);
  const cwd = options.cwd ?? process.cwd();
  const src = options.src ?? 'src';
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
    [`${featureDir}/${id}.md`]: `---
id: ${id}
route: /
spec: e2e/${id}.spec.ts
---

# ${id}

## 何があるか
- （利用者から見える機能を箇条書きで）

## どう辿り着くか
- （どの画面から、どの操作で着くか）

## どう操作して確かめるか
- \`pnpm verify ${id}\`
- 成功：
- エラー：
- 空：
- 永続化：

## よく嘘をつくところ
- （見た目は通るのに壊れている、が起きやすい点）
`,
  });

  appendFileSync(join(cwd, featureDir, 'README.md'), `1. [${id}](${id}.md)\n`);
  created.push(`${featureDir}/README.md（回帰の順番に追記）`);
  return { created, view: `${P}View`, importPath: `@/features/${id}` };
}

/**
 * bugyo の土台が入った新しいプロジェクトを作る。
 *
 * @param {string} target
 * @param {{ lintVersion?: string, bugyoVersion?: string }} [options]
 */
export function init(target, options = {}) {
  if (!existsSync(templateDir)) throw new Error(`テンプレートが見つかりません: ${templateDir}`);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} は空ではありません`);
  cpSync(templateDir, dir, { recursive: true });

  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const self = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
  pkg.devDependencies['bugyo'] = options.bugyoVersion ?? `^${self.version}`;
  pkg.devDependencies['@bugyo/lint'] = options.lintVersion ?? `^${self.version}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const gitignore = join(dir, '_gitignore');
  if (existsSync(gitignore)) renameSync(gitignore, join(dir, '.gitignore'));
  return dir;
}
