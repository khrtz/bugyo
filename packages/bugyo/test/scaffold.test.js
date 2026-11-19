import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { featureMapChecks } from '../src/feature-map-checks.js';
import { loadFeatures, loadSweepOrder, requiredSections, sectionHeadings, unfilledSections } from '../src/feature-map.js';
import { init, newFeature } from '../src/scaffold.js';

/** このファイルは日本語の出力を確かめる（英語の既定は locale.test.js で確かめる）。子プロセスにも引き継がれる */
process.env['BUGYO_LOCALE'] = 'ja';

function emptyProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'bugyo-'));
  mkdirSync(join(cwd, 'docs/features'), { recursive: true });
  writeFileSync(join(cwd, 'docs/features/README.md'), '# Feature map\n\n## 回帰の順番\n\n');
  return cwd;
}

test('new feature は ui/model/api/index・spec・feature map・回帰順をそろえて作る', () => {
  const cwd = emptyProject();
  const { created } = newFeature('user-settings', { cwd });
  for (const path of [
    'src/features/user-settings/ui/UserSettingsView.tsx',
    'src/features/user-settings/model/user-settings.ts',
    'src/features/user-settings/api/useUserSettingsQuery.ts',
    'src/features/user-settings/index.ts',
    'e2e/user-settings.spec.ts',
    'docs/features/user-settings.md',
  ]) {
    assert.ok(existsSync(join(cwd, path)), `${path} がありません`);
    assert.ok(created.includes(path));
  }
  const [feature] = loadFeatures(cwd);
  assert.equal(feature?.id, 'user-settings');
  assert.equal(feature?.spec, 'e2e/user-settings.spec.ts');
  for (const section of requiredSections) assert.ok(feature?.body.includes(`## ${section}`));
  assert.deepEqual(loadSweepOrder(cwd), ['user-settings']);
});

test('feature map の見出しは英語でも書け、雛形のままかどうかも同じように見る', () => {
  const cwd = emptyProject();
  const write = (/** @type {string} */ body) => writeFileSync(join(cwd, 'docs/features/greet.md'), `---\nid: greet\nspec: checks/greet.js\n---\n\n# greet\n\n${body}`);
  const headingsProblems = () => featureMapChecks({ cwd, specDir: null }).find((check) => check.title === 'すべての機能に4つの見出しがある')?.problems() ?? [];

  write('## What is there\n- A greeting\n\n## How to reach it\n- greet()\n\n## How to check it\n- `pnpm verify greet`\n- Success: returns "hi"\n\n## Where it lies\n- Empty names\n');
  const [english] = loadFeatures(cwd);
  assert.ok(english);
  assert.deepEqual(headingsProblems(), []);
  assert.deepEqual(unfilledSections(english), []);

  write('## What is there\n- (what users see)\n\n## How to reach it\n- greet()\n\n## How to check it\n- Success:\n\n## Where it lies\n- Empty names\n');
  const [placeholder] = loadFeatures(cwd);
  assert.ok(placeholder);
  assert.deepEqual(unfilledSections(placeholder), ['何があるか', 'どう操作して確かめるか']);

  const scaffolded = newFeature('hello', { cwd }).created.find((path) => path.endsWith('hello.md')) ?? '';
  const translated = sectionHeadings.reduce((text, heading) => text.replace(`## ${heading.ja}`, `## ${heading.en}`), readFileSync(join(cwd, scaffolded), 'utf8'));
  writeFileSync(join(cwd, scaffolded), translated);
  const renamed = loadFeatures(cwd).find((feature) => feature.id === 'hello');
  assert.ok(renamed && !renamed.body.includes('## 何があるか'));
  assert.deepEqual(unfilledSections(renamed), requiredSections, '雛形の見出しを英語に替えただけでは、埋めたことにならない');

  write('## 何があるか\n- 挨拶\n\n## How to reach it\n- greet()\n\n## どう操作して確かめるか\n- 手順: README を見る\n');
  const [mixed] = loadFeatures(cwd);
  assert.ok(mixed);
  assert.deepEqual(unfilledSections(mixed), ['よく嘘をつくところ'], '日本語の見出しでは、半角の : で終わる項目を雛形として扱わない');
  assert.deepEqual(headingsProblems(), ['docs/features/greet.md に「## よく嘘をつくところ」（英語なら「## Where it lies」）がありません']);
});

test('new feature は既存ファイルを上書きしない', () => {
  const cwd = emptyProject();
  newFeature('todo', { cwd });
  assert.throws(() => newFeature('todo', { cwd }), /すでにあります/);
});

test('new feature は不正な名前を断る', () => {
  assert.throws(() => newFeature('UserSettings', { cwd: emptyProject() }), /小文字/);
});

test('init はテンプレートをコピーし、依存を公開版に向ける', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'my-app');
  init(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-app');
  assert.match(pkg.devDependencies['bugyo'], /^\^\d/);
  assert.match(pkg.devDependencies['@bugyo/lint'], /^\^\d/);
  assert.match(pkg.devDependencies['@bugyo/lint-react'], /^\^\d/);
  assert.deepEqual(Object.values(pkg.devDependencies).filter((version) => version.startsWith('workspace:')), []);
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.ok(existsSync(join(dir, '.gitignore')));
  assert.ok(!existsSync(join(dir, 'node_modules')));
});

test('init は既定で react-vite を使い、そのことを .bugyo/config.json に残す', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'web');
  init(dir);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.bugyo/config.json'), 'utf8')), { template: 'react-vite' });
  assert.ok(existsSync(join(dir, 'playwright.config.ts')));
  assert.equal(loadConfig(dir).template, 'react-vite');
});

test('init --template node-lib は React・Vite・Playwright を依存に入れない', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'my-lib');
  init(dir, { template: 'node-lib' });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-lib');
  assert.match(pkg.devDependencies['bugyo'], /^\^\d/);
  assert.match(pkg.devDependencies['@bugyo/lint'], /^\^\d/);
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const banned of ['react', 'react-dom', 'vite', 'vitest', '@vitejs/plugin-react', '@playwright/test', '@bugyo/lint-react']) {
    assert.ok(!deps.includes(banned), `${banned} が依存に入っています`);
  }
  const config = loadConfig(dir);
  assert.equal(config.template, 'node-lib');
  assert.equal(config.verify.runner, 'command');
  assert.ok(existsSync(join(dir, '.gitignore')));
  assert.ok(existsSync(join(dir, 'CLAUDE.md')));
  assert.ok(!existsSync(join(dir, 'node_modules')));
  assert.ok(!existsSync(join(dir, '.bugyo/tasks')));
});

test('init は存在しないテンプレート名を、使える名前の一覧つきで断る', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'x');
  assert.throws(() => init(dir, { template: 'vue' }), /テンプレート "vue" はありません。使える名前: generic, node-lib, react-vite/);
  assert.ok(!existsSync(dir));
});

test('node-lib の new feature は model・index.ts・テスト・確かめるスクリプト・feature map を作り、React の部品は作らない', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'lib');
  init(dir, { template: 'node-lib' });
  const { created } = newFeature('word-count', { cwd: dir });
  for (const path of [
    'src/features/word-count/model/word-count.ts',
    'src/features/word-count/model/word-count.test.ts',
    'src/features/word-count/index.ts',
    'checks/word-count.ts',
    'docs/features/word-count.md',
  ]) {
    assert.ok(existsSync(join(dir, path)), `${path} がありません`);
    assert.ok(created.includes(path));
  }
  for (const path of ['src/features/word-count/ui', 'src/features/word-count/api', 'e2e', 'public']) {
    assert.ok(!existsSync(join(dir, path)), `${path} は作らない`);
  }
  assert.match(readFileSync(join(dir, 'checks/word-count.ts'), 'utf8'), /from '\.\.\/src\/features\/word-count\/index\.ts'/);
  const feature = loadFeatures(dir).find((candidate) => candidate.id === 'word-count');
  assert.equal(feature?.spec, 'checks/word-count.ts');
  assert.equal(feature?.route, undefined);
  assert.deepEqual(loadSweepOrder(dir), ['slug', 'word-count']);
  assert.deepEqual(
    featureMapChecks({ cwd: dir }).flatMap((check) => check.problems()),
    [],
  );
});

test('init --template generic は lint も TypeScript も入れず、command の確かめ方で feature map と台帳だけを使う', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'site');
  init(dir, { template: 'generic' });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.devDependencies), ['bugyo']);
  for (const file of ['eslint.config.js', 'tsconfig.json', '.dependency-cruiser.cjs', 'src']) assert.ok(!existsSync(join(dir, file)), `${file} は作らない`);
  const config = loadConfig(dir);
  assert.equal(config.template, 'generic');
  assert.equal(config.verify.runner, 'command');
  assert.equal(config.featureMap.featuresDir, null);
  assert.deepEqual(featureMapChecks({ cwd: dir }).flatMap((check) => check.problems()), []);
});

test('generic の new feature は feature map と、書くまで落ちる確かめるスクリプトだけを作る', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'bugyo-init-')), 'site');
  init(dir, { template: 'generic' });
  const { created, next } = newFeature('contact', { cwd: dir });
  assert.deepEqual(created.sort(), ['checks/contact.mjs', 'docs/features/README.md（回帰の順番に追記）', 'docs/features/contact.md']);
  assert.match(next[0], /checks\/contact\.mjs を、機能を実際に動かし、壊れていれば落ちるように書き換える/);
  const run = spawnSync(process.execPath, [join(dir, 'checks/contact.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 1, '書くまでは通らない');
  assert.match(run.stderr, /contact: この機能を実際に確かめる手順を checks\/contact\.mjs に書いてください/);
  assert.deepEqual(loadSweepOrder(dir), ['hours', 'contact']);
  assert.deepEqual(featureMapChecks({ cwd: dir }).flatMap((check) => check.problems()), []);
});

test('new feature は雛形のないテンプレートでは理由を言って断り、何も作らない', () => {
  const cwd = emptyProject();
  mkdirSync(join(cwd, '.bugyo'));
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ template: 'go-service' }));
  assert.throws(() => newFeature('orders', { cwd }), /template "go-service" には new feature の雛形がありません/);
  assert.ok(!existsSync(join(cwd, 'src')));
  assert.ok(!existsSync(join(cwd, 'docs/features/orders.md')));
});
