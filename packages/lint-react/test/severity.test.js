import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture');
const parts = [common, structure, react];

/** @param {Record<string, 'warn'>} severity */
async function lint(severity) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, parts, severity }) });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
  /** @param {string} file */
  const messagesOf = (file) => {
    const result = results.find((r) => r.filePath.split(sep).join('/').endsWith(file));
    assert.ok(result, `${file} が lint されていません`);
    return result.messages.map((m) => `${m.line} ${m.severity === 1 ? 'warn' : 'error'} ${m.ruleId}`);
  };
  return { eslint, messagesOf };
}

test('禁止の名前で warn に下げると、その禁止だけが warn になり、同じルールの他の禁止は error のまま', async () => {
  const { messagesOf } = await lint({ 'use-effect': 'warn', fetch: 'warn' });
  const messages = messagesOf('src/features/a/ui/Bad.tsx');
  assert.ok(messages.includes('1 warn bugyo-warn/no-restricted-imports'), messages.join('\n'));
  assert.ok(messages.includes('2 error no-restricted-imports'), `feature の内部は error のまま\n${messages.join('\n')}`);
  assert.ok(messages.includes('7 warn bugyo-warn/no-restricted-syntax'), messages.join('\n'));
  assert.ok(messages.includes('10 warn bugyo-warn/no-restricted-globals'), messages.join('\n'));
  assert.ok(messages.includes('9 error no-restricted-globals'), `UI のタイマーは error のまま\n${messages.join('\n')}`);
  assert.ok(!messages.some((m) => m.startsWith('1 error no-restricted-imports')), messages.join('\n'));
});

test('warn に下げた禁止も、例外の場所では止めない', async () => {
  const { eslint, messagesOf } = await lint({ 'use-effect': 'warn', fetch: 'warn' });
  assert.deepEqual(messagesOf('src/shared/lib/useTicker.ts').filter((m) => m.includes('restricted')), []);
  const api = await eslint.calculateConfigForFile(join(root, 'src/shared/api/client.ts'));
  assert.equal(api.rules['bugyo-warn/no-restricted-globals'][0], 0);
  const test = await eslint.calculateConfigForFile(join(root, 'src/features/a/ui/Bad.test.tsx'));
  assert.equal(test.rules['bugyo-warn/no-restricted-globals'][0], 0);
});

test('UI の範囲だけの禁止も warn に下げられる', async () => {
  const { messagesOf } = await lint({ 'ui-timers': 'warn' });
  const messages = messagesOf('src/features/a/ui/Bad.tsx');
  assert.ok(messages.includes('9 warn bugyo-warn/no-restricted-globals'), messages.join('\n'));
  assert.ok(messages.includes('10 error no-restricted-globals'), messages.join('\n'));
});

test('ルール ID で指定すると、そのルールが warn になる', async () => {
  const { messagesOf } = await lint({ '@typescript-eslint/no-non-null-assertion': 'warn' });
  assert.ok(messagesOf('src/features/a/ui/Bad.tsx').includes('11 warn @typescript-eslint/no-non-null-assertion'));
});

test('知らない名前と、warn 以外の値は断る', () => {
  assert.throws(() => bugyo({ root, parts, severity: { 'no-such-ban': 'warn' } }), /no-such-ban は、禁止の名前（comments, feature-internals, fetch, model-layers, model-react, ui-timers, use-effect）/);
  // @ts-expect-error off には下げられない
  assert.throws(() => bugyo({ root, parts, severity: { fetch: 'off' } }), /'warn' だけです/);
});
