import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, structure } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture-sources');

test('sources: ソースごとに層・部品・tsconfig を分け、それぞれの別名で境界を止める', async () => {
  const linter = new ESLint({ cwd: root });
  const found = (await linter.lintFiles(['web/**/*.ts', 'server/src/**/*.ts'])).flatMap((result) =>
    result.messages.map((m) => `${relative(root, result.filePath).split(sep).join('/')}:${m.line} ${m.ruleId}`),
  );
  assert.deepEqual(found.sort(), [
    'server/src/app.ts:3 no-restricted-imports',
    'server/src/app.ts:5 @typescript-eslint/no-floating-promises',
    'server/src/features/users/routes/create.ts:3 no-restricted-syntax',
    'server/src/lib/leak.ts:1 import-x/no-restricted-paths',
    'server/src/lib/leak.ts:2 no-restricted-imports',
    'server/src/middleware/auth.ts:1 import-x/no-restricted-paths',
    'web/app/main.ts:1 bugyo/no-comments',
    'web/features/calc/model/add.ts:1 no-restricted-globals',
  ]);
});

test('sources: サーバーの層（app をファイルに、middleware と db を shared.other に）を dependency-cruiser でも止める', () => {
  const run = spawnSync('pnpm', ['exec', 'depcruise', 'server/src', '--config', 'server.dependency-cruiser.cjs', '--output-type', 'json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const violations = JSON.parse(run.stdout).summary.violations.map((/** @type {any} */ v) => `${v.rule.name} ${v.from} -> ${v.to}`);
  assert.deepEqual(violations.sort(), [
    'app-only-via-feature-index server/src/app.ts -> server/src/features/users/model/user.ts',
    'shared-is-leaf server/src/lib/leak.ts -> server/src/features/users/index.ts',
    'shared-is-leaf server/src/middleware/auth.ts -> server/src/features/users/index.ts',
  ]);
});

test('sources: 1つのソースの部品と範囲の禁止は、ほかのソースに当たらない', async () => {
  const linter = new ESLint({ cwd: root });
  const rulesFor = async (/** @type {string} */ file) => (await linter.calculateConfigForFile(join(root, file))).rules;
  const server = await rulesFor('server/src/features/users/model/user.ts');
  assert.equal(server['bugyo/no-comments'], undefined, 'web だけの noComments は server に当たらない');
  const globals = server['no-restricted-globals'];
  assert.ok(!JSON.stringify(globals ?? []).includes('model では Date を使わない'), 'web の model の禁止は server の model に当たらない');
  assert.ok(JSON.stringify(globals).includes('fetch'), '両方に入れた fetch の禁止は、どちらにも当たる');
  assert.ok(JSON.stringify((await rulesFor('web/features/calc/model/add.ts'))['no-restricted-globals']).includes('fetch'));
});

test('sources: 外に書いたソースの項目と、重なる src は断る', () => {
  assert.throws(() => bugyo({ root, src: 'web', sources: [{ src: 'server/src' }] }), /write src inside each source/);
  assert.throws(() => bugyo({ root, sources: [] }), /one or more sources/);
  assert.throws(() => bugyo({ root, sources: [{ src: 'web' }, { src: 'web/admin' }] }), /src of bugyo\(\{ sources \}\) overlap/);
  assert.throws(() => bugyo({ root, sources: [{ src: 'web', parts: [structure] }] }), /must include common/);
  assert.doesNotThrow(() => bugyo({ root, sources: [{ src: 'web', parts: [common, structure] }, { src: 'server/src', parts: [common, structure] }] }));
});
