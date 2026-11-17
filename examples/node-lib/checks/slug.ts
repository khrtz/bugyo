import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cli = (...args: string[]) => spawnSync(process.execPath, ['src/app/cli.ts', ...args], { encoding: 'utf8' });

const converted = cli('Hello, World!');
assert.equal(converted.status, 0, converted.stderr);
assert.equal(converted.stdout.trim(), 'hello-world');

const missing = cli();
assert.equal(missing.status, 2);
assert.match(missing.stderr, /使い方/);

console.log('slug: ok');
