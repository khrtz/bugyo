import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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
