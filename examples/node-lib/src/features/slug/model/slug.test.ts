import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSlug } from './slug.ts';

await test('空白と記号の並びはハイフン1つにまとめる', () => {
  assert.equal(toSlug('Hello,  World!'), 'hello-world');
});

await test('先頭と末尾にハイフンを残さない', () => {
  assert.equal(toSlug('  --Agent Ready--  '), 'agent-ready');
});

await test('英数字が1つもなければ空になる', () => {
  assert.equal(toSlug('見出し'), '');
});
