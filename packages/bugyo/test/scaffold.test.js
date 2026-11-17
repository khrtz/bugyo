import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { featureMapChecks } from '../src/feature-map-checks.js';
import { loadFeatures, loadSweepOrder, requiredSections } from '../src/feature-map.js';
import { init, newFeature } from '../src/scaffold.js';

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
  for (const banned of ['react', 'react-dom', 'vite', 'vitest', '@vitejs/plugin-react', '@playwright/test']) {
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
  assert.throws(() => init(dir, { template: 'vue' }), /テンプレート "vue" はありません。使える名前: node-lib, react-vite/);
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

test('new feature は雛形のないテンプレートでは理由を言って断り、何も作らない', () => {
  const cwd = emptyProject();
  mkdirSync(join(cwd, '.bugyo'));
  writeFileSync(join(cwd, '.bugyo/config.json'), JSON.stringify({ template: 'go-service' }));
  assert.throws(() => newFeature('orders', { cwd }), /template "go-service" には new feature の雛形がありません/);
  assert.ok(!existsSync(join(cwd, 'src')));
  assert.ok(!existsSync(join(cwd, 'docs/features/orders.md')));
});
