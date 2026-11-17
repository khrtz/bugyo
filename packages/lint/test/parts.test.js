import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { config } from '../depcruise.cjs';
import { bugyo, common, react, structure } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture-node');
const parts = bugyo({ root, parts: [common, structure], explicitExtensions: true });
const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: parts });
const results = await eslint.lintFiles(['src/**/*.ts']);

const rulesFor = (file) => {
  const result = results.find((r) => r.filePath.split(sep).join('/').endsWith(file));
  assert.ok(result, `${file} が lint されていません`);
  return result.messages.map((m) => m.ruleId ?? m.message);
};
const count = (rules, id) => rules.filter((r) => r === id).length;

const serialize = (value) => {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function') return '[fn]';
    if (item !== null && typeof item === 'object') {
      if (seen.has(item)) return '[seen]';
      seen.add(item);
    }
    return item;
  });
};

test('共通: React のない .ts でも any・アサーション・非 null・浮いた Promise・コメントを止める', () => {
  const rules = rulesFor('src/features/report/model/bad.ts');
  assert.ok(count(rules, '@typescript-eslint/no-explicit-any') >= 1, rules.join(', '));
  assert.ok(count(rules, '@typescript-eslint/consistent-type-assertions') >= 1, rules.join(', '));
  assert.equal(count(rules, '@typescript-eslint/no-non-null-assertion'), 1, rules.join(', '));
  assert.equal(count(rules, '@typescript-eslint/no-floating-promises'), 1, rules.join(', '));
  assert.equal(count(rules, 'bugyo/no-comments'), 1, rules.join(', '));
});

test('構成: feature の内部への import と、shared から features への依存を止める', () => {
  assert.equal(count(rulesFor('src/app/main.ts'), 'no-restricted-imports'), 1, 'features/calc/model/add.ts');
  assert.equal(count(rulesFor('src/shared/lib/leak.ts'), 'import-x/no-restricted-paths'), 1);
});

test('構成: explicitExtensions なら features/<id>/index.ts は拡張子つきで import でき、内部は止まったまま', () => {
  const messages = results.find((r) => r.filePath.endsWith(`app${sep}main.ts`))?.messages ?? [];
  const lines = messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.line);
  assert.deepEqual(lines, [2]);
});

test('構成: explicitExtensions がなければ index.ts への拡張子つき import も内部扱いになる', async () => {
  const strict = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, parts: [common, structure] }) });
  const [result] = await strict.lintFiles(['src/app/main.ts']);
  assert.deepEqual(result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.line), [1, 2]);
});

test('共通と構成だけなら、React 用のルールは1つも登録されていない', async () => {
  const text = serialize(parts.map((block) => block.rules ?? {}));
  for (const block of parts) assert.ok(!Object.keys(block.plugins ?? {}).includes('react-hooks'));
  assert.ok(!/react-hooks\//.test(text), 'react-hooks のルール');
  assert.ok(!/useEffect|useLayoutEffect/.test(text), 'useEffect の禁止');
  assert.ok(!/requestAnimationFrame/.test(text), 'UI のタイマー禁止');
  assert.ok(!/"react-dom"/.test(text), 'model から React への禁止');
  for (const file of ['src/features/report/model/bad.ts', 'src/app/main.ts']) {
    const calculated = await eslint.calculateConfigForFile(join(root, file));
    assert.deepEqual(
      Object.keys(calculated.rules).filter((rule) => rule.startsWith('react-hooks/')),
      [],
    );
  }
});

test('common を外した組み合わせは断る', () => {
  assert.throws(() => bugyo({ root, parts: [structure, react] }), /common/);
});

test('部品の順番を変えても同じ設定になる', () => {
  assert.equal(serialize(bugyo({ root, parts: [react, structure, common] })), serialize(bugyo({ root })));
});

test('depcruise: react: false なら model-is-pure は React とその周辺を見ない', () => {
  const pure = (options) => config(options).forbidden.find((rule) => rule.name === 'model-is-pure').to.path;
  assert.match(pure(), /node_modules\/\(react\|react-dom\|@tanstack\)/);
  assert.doesNotMatch(pure({ react: false }), /node_modules/);
});

test('depcruise: React のないフィクスチャでも構成の境界を止める', () => {
  const run = spawnSync('pnpm', ['exec', 'depcruise', 'src', '--output-type', 'json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const violations = JSON.parse(run.stdout).summary.violations.map((v) => `${v.rule.name} ${v.from} -> ${v.to}`);
  assert.ok(violations.includes('feature-internals-only-via-index src/features/report/model/bad.ts -> src/features/calc/model/add.ts'), violations.join('\n'));
  assert.ok(violations.includes('shared-is-leaf src/shared/lib/leak.ts -> src/features/calc/index.ts'), violations.join('\n'));
  assert.ok(violations.includes('app-only-via-feature-index src/app/main.ts -> src/features/calc/model/add.ts'), violations.join('\n'));
  assert.ok(!violations.includes('app-only-via-feature-index src/app/main.ts -> src/features/calc/index.ts'), violations.join('\n'));
});
