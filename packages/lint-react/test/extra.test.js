import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture');
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  baseConfig: bugyo({
    parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers],
    root,
    extra: {
      restrictedProperties: [{ object: 'Date', property: 'now', message: 'shared/lib の systemClock を使ってください' }],
      restrictedSyntax: [
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: 'shared/lib の systemClock を使ってください' },
      ],
      restrictedGlobals: [{ name: 'localStorage', message: 'shared/lib の storage を使ってください' }],
    },
  }),
});
const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);

const messagesFor = (file) => {
  const result = results.find((r) => r.filePath.split(sep).join('/').endsWith(file));
  assert.ok(result, `${file} が lint されていません`);
  return result.messages;
};
const count = (file, ruleId) => messagesFor(file).filter((m) => m.ruleId === ruleId).length;

test('extra.restrictedProperties で Date.now を止め、エラー文に代わりを出す', () => {
  const hits = messagesFor('src/features/b/model/time.ts').filter((m) => m.ruleId === 'no-restricted-properties');
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.message ?? '', /systemClock/);
});

test('extra.restrictedSyntax で引数なしの new Date() を止める', () => {
  assert.equal(count('src/features/b/model/time.ts', 'no-restricted-syntax'), 1);
});

test('extra を足しても bugyo 自身の禁止は消えない', () => {
  assert.equal(count('src/features/a/ui/Bad.tsx', 'no-restricted-syntax'), 1, 'React.useLayoutEffect');
  assert.equal(count('src/features/a/ui/Bad.tsx', 'no-restricted-globals'), 2, 'fetch と setTimeout');
  assert.equal(count('src/features/b/model/impure.ts', 'no-restricted-imports'), 2);
});

test('副作用を包む shared/lib では extra の禁止は効かない', () => {
  assert.equal(count('src/shared/lib/clock.ts', 'no-restricted-properties'), 0);
});
