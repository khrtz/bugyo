import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, 'fixture');
const run = spawnSync('pnpm', ['exec', 'depcruise', 'src', '--output-type', 'json'], {
  cwd: root,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const report = JSON.parse(run.stdout);
const violations = report.summary.violations.map((v) => `${v.rule.name} ${v.from} -> ${v.to}`);
const has = (rule, from, to) =>
  violations.some((v) => v.startsWith(`${rule} ${from}`) && v.includes(to));

test('他featureの内部への依存を止める', () => {
  assert.ok(has('feature-internals-only-via-index', 'src/features/a/ui/Bad.tsx', 'src/features/b/model/impure.ts'), violations.join('\n'));
});

test('features → app を止める', () => {
  assert.ok(has('features-not-to-app', 'src/features/a/ui/Bad.tsx', 'src/app/App.ts'), violations.join('\n'));
});

test('shared → features を止める', () => {
  assert.ok(has('shared-is-leaf', 'src/shared/lib/leak.ts', 'src/features/a/index.ts'), violations.join('\n'));
});

test('react: true なら model → React を止める（pnpm の node_modules/.pnpm 経由でも）', () => {
  assert.ok(has('model-is-pure', 'src/features/b/model/impure.ts', '/node_modules/react/'), violations.join('\n'));
});

test('model → shared/ui を止める', () => {
  assert.ok(has('model-is-pure', 'src/features/b/model/impure.ts', 'src/shared/ui/index.ts'), violations.join('\n'));
});
