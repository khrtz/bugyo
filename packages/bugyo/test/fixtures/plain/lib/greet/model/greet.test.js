import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greet } from './greet.js';

test('名前の前に hello, を付ける', () => {
  assert.equal(greet('a'), 'hello, a');
});
