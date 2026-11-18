import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { bugyo, common, fetchOnlyInApi, noComments, structure } from '@bugyo/lint';
import { noUiTimers, noUseEffect, react } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture');

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

test('react を足すと、src に react-hooks のプラグインとルールが入る', () => {
  const config = bugyo({ root, parts: [common, structure, react] });
  const src = config.find((block) => block.files?.includes('src/**/*.{ts,tsx}'));
  assert.ok(src?.plugins?.['react-hooks'], 'react-hooks のプラグイン');
  assert.ok(Object.keys(src?.rules ?? {}).some((rule) => rule.startsWith('react-hooks/')), 'react-hooks のルール');
});

test('react だけでは useEffect と UI のタイマーを止めず、react-hooks と model から React への禁止は入る', async () => {
  const text = serialize(bugyo({ root, parts: [common, structure, react] }).map((block) => block.rules ?? {}));
  assert.ok(!/useEffect|useLayoutEffect/.test(text), 'useEffect の禁止');
  assert.ok(!/requestAnimationFrame/.test(text), 'UI のタイマーの禁止');
  assert.match(text, /react-hooks\//);
  assert.match(text, /"react-dom"/);
});

test('noUseEffect と noUiTimers を足すと、useEffect と UI のタイマーを止める', () => {
  const text = serialize(bugyo({ root, parts: [common, structure, react, noUseEffect, noUiTimers] }).map((block) => block.rules ?? {}));
  assert.match(text, /useLayoutEffect/);
  assert.match(text, /requestAnimationFrame/);
});

test('部品と禁止の順番を変えても同じ設定になる', () => {
  assert.equal(
    serialize(bugyo({ root, parts: [noUiTimers, react, fetchOnlyInApi, structure, noUseEffect, noComments, common] })),
    serialize(bugyo({ root, parts: [common, structure, react, noComments, fetchOnlyInApi, noUseEffect, noUiTimers] })),
  );
});

test('react だけでは common がないので断る', () => {
  assert.throws(() => bugyo({ root, parts: [structure, react] }), /common/);
});
