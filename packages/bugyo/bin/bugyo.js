#!/usr/bin/env node
import { init, newFeature } from '../src/scaffold.js';
import { UsageError, gateCommand, mistakeCommand, taskCommand, taskUsage } from '../src/task-cli.js';
import { verify } from '../src/verify.js';

const usage = `使い方:
  bugyo init <dir>             土台入りの新しいプロジェクトを作る
  bugyo new feature <id>       feature を ui/model/api・feature map・spec つきで作る
  bugyo verify <id>            その feature を実際に動かし、合否と証拠の場所だけを出す
  bugyo verify --all           feature map にあるすべての feature を確かめる
${taskUsage}`;

const [command, ...args] = process.argv.slice(2);

function runVerify() {
  const outcome = verify(args[0]);
  const print = outcome.status === 2 ? console.error : console.log;
  for (const line of outcome.lines) print(line);
  return outcome.status;
}

function main() {
  switch (command) {
    case 'verify':
      return runVerify();
    case 'task':
      return taskCommand(args);
    case 'mistake':
      return mistakeCommand(args);
    case 'gate':
      return gateCommand(args);
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
  if (error instanceof UsageError) console.error(`\n${usage}`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
