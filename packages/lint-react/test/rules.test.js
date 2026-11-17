import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture');
const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, parts: [common, structure, react] }) });
const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);

const rulesFor = (file) => {
  const result = results.find((r) => r.filePath.split(sep).join('/').endsWith(file));
  assert.ok(result, `${file} が lint されていません`);
  return result.messages.map((m) => m.ruleId ?? m.message);
};

const count = (rules, id) => rules.filter((r) => r === id).length;

test('ui: useEffect・内部import・fetch・タイマー・アサーション・コメント・浮いたPromiseを止める', () => {
  const rules = rulesFor('src/features/a/ui/Bad.tsx');
  assert.equal(count(rules, 'no-restricted-imports'), 2, `useEffect と feature内部: ${rules.join(', ')}`);
  assert.equal(count(rules, 'no-restricted-syntax'), 1, 'React.useLayoutEffect');
  assert.equal(count(rules, 'no-restricted-globals'), 2, 'fetch と setTimeout');
  assert.equal(count(rules, 'import-x/no-restricted-paths'), 1, 'features → app');
  assert.equal(count(rules, 'bugyo/no-comments'), 1);
  assert.equal(count(rules, '@typescript-eslint/no-non-null-assertion'), 1);
  assert.ok(count(rules, '@typescript-eslint/consistent-type-assertions') >= 1);
  assert.equal(count(rules, '@typescript-eslint/no-floating-promises'), 1);
});

test('model: React と shared/ui を止める', () => {
  const rules = rulesFor('src/features/b/model/impure.ts');
  assert.equal(count(rules, 'no-restricted-imports'), 2, rules.join(', '));
});

test('shared: features への依存を止める', () => {
  assert.equal(count(rulesFor('src/shared/lib/leak.ts'), 'import-x/no-restricted-paths'), 1);
});

test('shared/lib では useEffect を書ける', () => {
  assert.equal(count(rulesFor('src/shared/lib/useTicker.ts'), 'no-restricted-imports'), 0);
});
