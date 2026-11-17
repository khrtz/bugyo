#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { sep } from 'node:path';
import { loadFeatures } from '../src/feature-map.js';
import { init, newFeature } from '../src/scaffold.js';

const usage = `使い方:
  bugyo init <dir>             土台入りの新しいプロジェクトを作る
  bugyo new feature <id>       feature を ui/model/api・feature map・spec つきで作る
  bugyo verify <id>            その feature を実際に動かし、合否と証拠の場所だけを出す
  bugyo verify --all           feature map の回帰の順番で全部を確かめる`;

const [command, ...args] = process.argv.slice(2);

const reportFile = 'artifacts/results.json';

/** @param {string[]} specs */
function runPlaywright(specs) {
  rmSync('artifacts', { recursive: true, force: true });
  return spawnSync('pnpm', ['exec', 'playwright', 'test', ...specs, '--reporter=line,json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
  });
}

/**
 * Playwright の JSON レポートから、spec ファイルごとの合否を読む。
 *
 * @returns {Map<string, boolean>}
 */
function resultsBySpec() {
  const results = new Map();
  if (!existsSync(reportFile)) return results;
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  /** @param {any} suite */
  const visit = (suite) => {
    const file = `e2e/${String(suite.file ?? '').split(sep).join('/').replace(/^e2e\//, '')}`;
    for (const spec of suite.specs ?? []) results.set(file, (results.get(file) ?? true) && spec.ok === true);
    for (const child of suite.suites ?? []) visit({ file: suite.file, ...child });
  };
  for (const suite of report.suites ?? []) visit(suite);
  return results;
}

function verify() {
  const features = loadFeatures();
  const ids = features.map((feature) => feature.id);
  const targets = args[0] === '--all' ? features : features.filter((feature) => feature.id === args[0]);
  if (targets.length === 0) {
    console.error(`使い方: bugyo verify <feature>|--all  (候補: ${ids.join(', ')})`);
    return 2;
  }
  const result = runPlaywright(targets.map((feature) => feature.spec));
  const passed = result.status === 0;
  const bySpec = resultsBySpec();
  for (const feature of targets) {
    const ok = bySpec.get(feature.spec);
    const label = ok === undefined ? (passed ? 'PASS' : 'FAIL?') : ok ? 'PASS' : 'FAIL';
    console.log(`${label} ${feature.id}  確認手順: ${feature.file}`);
  }
  console.log('証拠: artifacts/test-results（動画・スクリーンショット・トレース）, artifacts/report/index.html');
  if (!passed) {
    const tail = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-30).join('\n');
    console.log(tail);
  }
  return passed ? 0 : 1;
}

function main() {
  switch (command) {
    case 'verify':
      return verify();
    case 'new': {
      const [kind, id] = args;
      if (kind !== 'feature' || id === undefined) break;
      const { created, view, importPath } = newFeature(id);
      console.log(`作成しました:\n${created.map((path) => `  ${path}`).join('\n')}`);
      console.log(`\n次にやること:
  1. 画面に組み込む: import { ${view} } from '${importPath}'; を src/app から使う（使うまで knip が「未使用」と止めます）
  2. docs/features/${id}.md の4つの見出しを埋める
  3. pnpm check && pnpm test && pnpm verify ${id}`);
      return 0;
    }
    case 'init': {
      const [dir] = args;
      if (dir === undefined) break;
      const created = init(dir);
      console.log(`作成しました: ${created}\n\n次にやること:\n  cd ${dir}\n  pnpm install\n  pnpm exec playwright install chromium\n  pnpm check && pnpm test && pnpm verify --all`);
      return 0;
    }
    default:
      break;
  }
  console.error(usage);
  return 2;
}

try {
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
