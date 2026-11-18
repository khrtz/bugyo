import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { config } from '../depcruise.cjs';
import { bugyo, common, defineBan, fetchOnlyInApi, noComments, structure } from '../eslint.js';

const root = join(import.meta.dirname, 'fixture-node');
const parts = bugyo({ root, parts: [common, structure], explicitExtensions: true });
const eslint = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: parts });
const results = await eslint.lintFiles(['src/**/*.ts']);

const rulesFor = (file) => {
  const result = results.find((r) => r.filePath.split(sep).join('/').endsWith(file));
  assert.ok(result, `${file} が lint されていません`);
  return result.messages.map((m) => m.ruleId ?? m.message);
};
const count = (rules, id) => rules.filter((r) => r === id).length;

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

test('共通: React のない .ts でも any・アサーション・非 null・浮いた Promise を止める', () => {
  const rules = rulesFor('src/features/report/model/bad.ts');
  assert.ok(count(rules, '@typescript-eslint/no-explicit-any') >= 1, rules.join(', '));
  assert.ok(count(rules, '@typescript-eslint/consistent-type-assertions') >= 1, rules.join(', '));
  assert.equal(count(rules, '@typescript-eslint/no-non-null-assertion'), 1, rules.join(', '));
  assert.equal(count(rules, '@typescript-eslint/no-floating-promises'), 1, rules.join(', '));
});

test('既定（共通と構成）は、コメントと fetch の禁止を入れない。noComments と fetchOnlyInApi を足すと止める', async () => {
  assert.equal(count(rulesFor('src/features/report/model/bad.ts'), 'bugyo/no-comments'), 0);
  const text = serialize(parts.map((block) => block.rules ?? {}));
  assert.ok(!/"bugyo\/no-comments"/.test(text), 'コメントの禁止');
  assert.ok(!/fetchを直接呼ばないでください/.test(text), 'fetch の禁止');

  const opted = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, explicitExtensions: true, parts: [common, structure, noComments, fetchOnlyInApi] }) });
  const [result] = await opted.lintFiles(['src/features/report/model/bad.ts']);
  assert.equal(count(result?.messages.map((m) => m.ruleId) ?? [], 'bugyo/no-comments'), 1);
  const calculated = await opted.calculateConfigForFile(join(root, 'src/features/report/model/bad.ts'));
  assert.equal(calculated.rules['no-restricted-globals'][1].name, 'fetch');
});

test('構成: feature の内部への import と、shared から features への依存を止める', () => {
  assert.equal(count(rulesFor('src/app/main.ts'), 'no-restricted-imports'), 1, 'features/calc/model/add.ts');
  assert.equal(count(rulesFor('src/shared/lib/leak.ts'), 'import-x/no-restricted-paths'), 1);
});

test('構成: explicitExtensions なら features/<id>/index.ts は拡張子つきで import でき、内部は止まったまま', () => {
  const messages = results.find((r) => r.filePath.endsWith(`app${sep}main.ts`))?.messages ?? [];
  const lines = messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.line);
  assert.deepEqual(lines, [2]);
});

test('構成: explicitExtensions がなければ index.ts への拡張子つき import も内部扱いになる', async () => {
  const strict = new ESLint({ cwd: root, overrideConfigFile: true, baseConfig: bugyo({ root, parts: [common, structure] }) });
  const [result] = await strict.lintFiles(['src/app/main.ts']);
  assert.deepEqual(result?.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.line), [1, 2]);
});

test('既定（共通と構成）には、React 用のルールが1つも登録されていない', async () => {
  const text = serialize(parts.map((block) => block.rules ?? {}));
  for (const block of parts) assert.ok(!Object.keys(block.plugins ?? {}).includes('react-hooks'));
  assert.ok(!/react-hooks\//.test(text), 'react-hooks のルール');
  assert.ok(!/useEffect|useLayoutEffect/.test(text), 'useEffect の禁止');
  assert.ok(!/requestAnimationFrame/.test(text), 'UI のタイマー禁止');
  assert.ok(!/"react-dom"/.test(text), 'model から React への禁止');
  for (const file of ['src/features/report/model/bad.ts', 'src/app/main.ts']) {
    const calculated = await eslint.calculateConfigForFile(join(root, file));
    assert.deepEqual(
      Object.keys(calculated.rules).filter((rule) => rule.startsWith('react-hooks/')),
      [],
    );
  }
});

test('common を外した組み合わせは断る', () => {
  assert.throws(() => bugyo({ root, parts: [structure] }), /common/);
});

test('既定は共通と構成で、部品の順番を変えても同じ設定になる', () => {
  assert.equal(serialize(bugyo({ root, parts: [structure, common] })), serialize(bugyo({ root })));
});

test('depcruise: 既定では model-is-pure は React とその周辺を見ず、react: true で見る', () => {
  const pure = (options) => config(options).forbidden.find((rule) => rule.name === 'model-is-pure').to.path;
  assert.doesNotMatch(pure(), /node_modules/);
  assert.match(pure({ react: true }), /node_modules\/\(react\|react-dom\|@tanstack\)/);
});

const layersRoot = join(import.meta.dirname, 'fixture-layers');
const { layers } = JSON.parse(readFileSync(join(layersRoot, '.bugyo/config.json'), 'utf8'));

test('layers: 層のフォルダ名と import の別名が既定と違っても、解決したパスで境界を止める', async () => {
  const linter = new ESLint({ cwd: layersRoot });
  const found = (await linter.lintFiles(['web/**/*.ts'])).flatMap((result) =>
    result.messages.map((m) => `${relative(layersRoot, result.filePath).split(sep).join('/')}:${m.line} ${m.ruleId}`),
  );
  assert.deepEqual(found.sort(), [
    'web/app/lib/leak.ts:1 import-x/no-restricted-paths',
    'web/app/lib/leak.ts:2 import-x/no-restricted-paths',
    'web/features/billing/domain/total.ts:1 import-x/no-restricted-paths',
    'web/features/billing/domain/total.ts:2 no-restricted-imports',
    'web/features/billing/domain/total.ts:3 no-restricted-imports',
    'web/features/report/api/fetchReport.ts:1 no-restricted-globals',
    'web/features/report/model/bad.ts:1 import-x/no-restricted-paths',
    'web/features/report/model/bad.ts:2 import-x/no-restricted-paths',
    'web/features/report/model/bad.ts:3 no-restricted-imports',
    'web/pages/main.ts:2 no-restricted-imports',
  ]);
});

test('featureParts: ui・model の範囲は、役割に書いたフォルダ名のどれにも当たる', async () => {
  const alert = defineBan({ name: 'no-alert-in-ui', scope: 'ui', globals: [{ name: 'alert', message: 'ui では alert を使わない' }] });
  const pure = defineBan({ name: 'no-date-in-model', scope: 'model', globals: [{ name: 'Date', message: 'model では Date を使わない' }] });
  const linter = new ESLint({
    cwd: layersRoot,
    overrideConfigFile: true,
    baseConfig: bugyo({ root: layersRoot, src: 'web', layers, parts: [common, structure, alert, pure] }),
  });
  const globalsFor = async (file) => {
    const rule = (await linter.calculateConfigForFile(join(layersRoot, file))).rules['no-restricted-globals'];
    return (rule?.slice(1) ?? []).map((entry) => entry.name);
  };
  assert.deepEqual(await globalsFor('web/features/billing/components/view.ts'), ['alert']);
  assert.deepEqual(await globalsFor('web/features/report/ui/view.ts'), ['alert']);
  assert.deepEqual(await globalsFor('web/features/billing/domain/total.ts'), ['Date']);
  assert.deepEqual(await globalsFor('web/features/calc/model/add.ts'), ['Date']);
  assert.deepEqual(await globalsFor('web/features/billing/services/amount.ts'), []);
});

test('featureParts: フォルダ名に / を含むか、空の配列なら断る', () => {
  for (const featureParts of [{ ui: ['a/b'] }, { ui: ['..'] }, { model: [] }, { api: 'services' }, { ui: ['ui', 'lib'], model: ['lib'] }]) {
    assert.throws(() => bugyo({ root: layersRoot, src: 'web', layers: { ...layers, featureParts } }), /featureParts/, JSON.stringify(featureParts));
  }
});

test('layers: src の外にある層は断る', () => {
  assert.throws(() => bugyo({ root: layersRoot, layers }), /src（src）の中にありません/);
});

test('depcruise: layers の場所で構成の境界を止める', () => {
  const run = spawnSync('pnpm', ['exec', 'depcruise', 'web', '--output-type', 'json'], { cwd: layersRoot, encoding: 'utf8', shell: process.platform === 'win32' });
  const violations = JSON.parse(run.stdout).summary.violations.map((v) => `${v.rule.name} ${v.from} -> ${v.to}`);
  assert.deepEqual(violations.sort(), [
    'app-only-via-feature-index web/pages/main.ts -> web/features/calc/model/add.ts',
    'feature-internals-only-via-index web/features/report/model/bad.ts -> web/features/calc/model/add.ts',
    'model-is-pure web/features/billing/domain/total.ts -> web/app/ui/label.ts',
    'model-is-pure web/features/billing/domain/total.ts -> web/features/billing/components/view.ts',
    'model-is-pure web/features/billing/domain/total.ts -> web/features/billing/services/amount.ts',
    'model-is-pure web/features/report/model/bad.ts -> web/app/api/client.ts',
    'model-is-pure web/features/report/model/bad.ts -> web/app/ui/label.ts',
    'model-is-pure web/features/report/model/bad.ts -> web/features/calc/model/add.ts',
    'shared-is-leaf web/app/lib/leak.ts -> web/features/calc/index.ts',
    'shared-is-leaf web/app/lib/leak.ts -> web/pages/main.ts',
  ]);
});

test('depcruise: React のないフィクスチャでも構成の境界を止める', () => {
  const run = spawnSync('pnpm', ['exec', 'depcruise', 'src', '--output-type', 'json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const violations = JSON.parse(run.stdout).summary.violations.map((v) => `${v.rule.name} ${v.from} -> ${v.to}`);
  assert.ok(violations.includes('feature-internals-only-via-index src/features/report/model/bad.ts -> src/features/calc/model/add.ts'), violations.join('\n'));
  assert.ok(violations.includes('shared-is-leaf src/shared/lib/leak.ts -> src/features/calc/index.ts'), violations.join('\n'));
  assert.ok(violations.includes('app-only-via-feature-index src/app/main.ts -> src/features/calc/model/add.ts'), violations.join('\n'));
  assert.ok(!violations.includes('app-only-via-feature-index src/app/main.ts -> src/features/calc/index.ts'), violations.join('\n'));
});
