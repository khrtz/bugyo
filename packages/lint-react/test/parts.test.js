import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { bugyo, common, structure } from '@bugyo/lint';
import { react } from '../eslint.js';

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

test('部品の順番を変えても同じ設定になる', () => {
  assert.equal(
    serialize(bugyo({ root, parts: [react, structure, common] })),
    serialize(bugyo({ root, parts: [common, structure, react] })),
  );
});

test('react だけでは common がないので断る', () => {
  assert.throws(() => bugyo({ root, parts: [structure, react] }), /common/);
});
