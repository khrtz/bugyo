import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { bugyo, common, defineBan, fetchOnlyInApi, noComments, structure } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture-node');

const noDateNow = defineBan({
  name: 'no-date-now',
  allow: ['effects', 'tests'],
  properties: [{ object: 'Date', property: 'now', message: 'Date.now は shared/lib の clock を使ってください。' }],
});
const noLodash = defineBan({
  name: 'no-lodash',
  allow: ['tests'],
  imports: { paths: [{ name: 'lodash', message: 'lodash は使いません。' }] },
});
const noConsoleInApi = defineBan({
  name: 'no-console-in-api',
  scope: 'src/features/*/api/**/*.ts',
  rules: { 'no-console': 'error' },
});

/** @param {import('eslint').Linter.Config[]} config @param {string} file */
async function rulesFor(config, file) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: config });
  return (await eslint.calculateConfigForFile(join(root, file))).rules;
}

/** @param {unknown} rule */
const importMessages = (rule) => {
  if (!Array.isArray(rule) || rule[0] === 0) return [];
  const [, option] = rule;
  return [...option.paths, ...option.patterns].map((entry) => entry.message);
};

test('defineBan: 独自の禁止は bugyo の禁止と同じ場所の決まりで当たる', async () => {
  const config = bugyo({ root, explicitExtensions: true, parts: [common, structure, noDateNow, noConsoleInApi] });
  assert.equal((await rulesFor(config, 'src/features/calc/model/add.ts'))['no-restricted-properties'][1].property, 'now');
  assert.equal((await rulesFor(config, 'src/shared/lib/clock.ts'))['no-restricted-properties'][0], 0, 'effects では許す');
  assert.equal((await rulesFor(config, 'src/features/calc/model/add.test.ts'))['no-restricted-properties'][0], 0, 'テストでは許す');
  assert.equal((await rulesFor(config, 'src/features/calc/api/load.ts'))['no-console'][0], 2, 'scope の glob の中だけで当たる');
  assert.notEqual((await rulesFor(config, 'src/features/calc/model/add.ts'))['no-console']?.[0], 2);
});

test('defineBan: テストで許す import の禁止を足しても、model/ のテストから model/ の禁止は消えない', async () => {
  const config = bugyo({ root, explicitExtensions: true, parts: [common, structure, noLodash] });
  const product = importMessages((await rulesFor(config, 'src/features/calc/model/add.ts'))['no-restricted-imports']);
  const tests = importMessages((await rulesFor(config, 'src/features/calc/model/add.test.ts'))['no-restricted-imports']);
  assert.ok(product.includes('lodash は使いません。'), product.join('\n'));
  assert.ok(product.some((message) => message.startsWith('model/ から ui/')), product.join('\n'));
  assert.ok(!tests.includes('lodash は使いません。'), `テストでは lodash を許す\n${tests.join('\n')}`);
  assert.ok(tests.some((message) => message.startsWith('model/ から ui/')), `model/ の禁止は残る\n${tests.join('\n')}`);
});

test('defineBan: 名前で warn に下げられ、rules の禁止も下がる', async () => {
  const config = bugyo({ root, explicitExtensions: true, parts: [common, structure, noConsoleInApi, noDateNow], severity: { 'no-console-in-api': 'warn', 'no-date-now': 'warn' } });
  assert.equal((await rulesFor(config, 'src/features/calc/api/load.ts'))['no-console'][0], 1);
  const rules = await rulesFor(config, 'src/features/calc/model/add.ts');
  assert.equal(rules['bugyo-warn/no-restricted-properties'][0], 1);
  assert.equal(rules['no-restricted-properties'][0], 0);
});

test('comments も名前で warn に下げられる', async () => {
  const config = bugyo({ root, explicitExtensions: true, parts: [common, structure, noComments], severity: { comments: 'warn' } });
  assert.equal((await rulesFor(config, 'src/features/calc/model/add.ts'))['bugyo/no-comments'][0], 1);
});

test('部品と禁止の順番を変えても同じ設定になる', () => {
  const serialize = (/** @type {unknown} */ value) => {
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
  assert.equal(
    serialize(bugyo({ root, parts: [common, structure, noDateNow, noLodash] })),
    serialize(bugyo({ root, parts: [noLodash, structure, noDateNow, common] })),
  );
});

test('defineBan: 決めた入口だけで使える import を、allow に場所を書いて作れる（glob の記号のない場所はフォルダの下のすべて）', async () => {
  const imports = {
    paths: [{ name: 'node:child_process', message: '子プロセスは src/shared/system から起動してください。' }],
    patterns: [{ group: ['child_process'], message: '子プロセスは src/shared/system から起動してください。' }],
  };
  const processOnlyInSystem = defineBan({ name: 'child-process', allow: ['src/shared/system', 'tests'], imports });
  const config = bugyo({ root, explicitExtensions: true, parts: [common, structure, processOnlyInSystem] });
  const banned = async (/** @type {string} */ file) =>
    importMessages((await rulesFor(config, file))['no-restricted-imports']).filter((message) => message.startsWith('子プロセス')).length;
  assert.equal(await banned('src/features/calc/model/add.ts'), 2);
  assert.equal(await banned('src/app/main.ts'), 2);
  for (const file of ['src/shared/system/run.ts', 'src/shared/system/git/status.ts', 'src/features/calc/model/add.test.ts']) {
    assert.equal(await banned(file), 0, `${file} では許す`);
  }

  const outside = bugyo({ root, explicitExtensions: true, parts: [common, structure, defineBan({ name: 'scripts-process', allow: ['scripts'], imports })] });
  const importsRule = async (/** @type {import('eslint').Linter.Config[]} */ config, /** @type {string} */ file) => (await rulesFor(config, file))['no-restricted-imports'];
  for (const [built, file] of /** @type {const} */ ([[config, 'src/shared/system/run.js'], [outside, 'scripts/release.ts']])) {
    const rule = await importsRule(built, file);
    assert.ok(rule === undefined || (Array.isArray(rule) && rule[0] === 0), `許す場所のブロックが src の .ts / .tsx の外に禁止を足さない: ${file} ${JSON.stringify(rule)}`);
  }
});

test('defineBan: 書き方の誤りと、同じ名前の禁止は断る', () => {
  assert.throws(() => defineBan({ name: 'No Spaces', globals: ['x'] }), /小文字・数字・ハイフン/);
  // @ts-expect-error 知らない項目
  assert.throws(() => bugyo({ root, parts: [common, defineBan({ name: 'typo', global: ['x'] })] }), /知らない項目があります: global/);
  assert.throws(() => bugyo({ root, parts: [common, defineBan({ name: 'empty' })] }), /何も止めていません/);
  assert.throws(
    () => bugyo({ root, parts: [common, structure, defineBan({ name: 'calc-only', scope: 'src/features/calc/**/*.ts', imports: { paths: [{ name: 'lodash', message: 'x' }] } })] }),
    /scope を src \/ ui \/ model のどれかにしてください/,
    'glob の範囲の合成する禁止は、model/ の禁止を上書きしてしまうので断る',
  );
  assert.throws(
    () => bugyo({ root, parts: [common, fetchOnlyInApi, defineBan({ name: 'e2e-only', scope: 'e2e/**/*.ts', globals: ['alert'] })] }),
    /scope を src \/ ui \/ model のどれかにしてください/,
    'src の外の glob に合成する禁止を置くと、src の禁止が漏れるので断る',
  );
  assert.throws(() => bugyo({ root, parts: [common, structure, fetchOnlyInApi, defineBan({ name: 'fetch', globals: ['x'] })] }), /同じ名前の禁止が2つ以上あります: fetch/);
  assert.throws(() => bugyo({ root, severity: { fetch: 'warn' } }), /fetch は、禁止の名前/, '入れていない禁止は下げられない');
});
