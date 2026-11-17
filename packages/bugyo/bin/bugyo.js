#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { defaultTemplate, init, newFeature, templates } from '../src/scaffold.js';
import { UsageError, gateCommand, mistakeCommand, taskCommand, taskUsage } from '../src/task-cli.js';
import { verify } from '../src/verify.js';

const usage = `使い方:
  bugyo init <dir> [--template <名前>]
                               土台入りの新しいプロジェクトを作る（既定は react-vite。使える名前: ${templates().join(', ')}）
  bugyo new feature <id>       feature を、テンプレートに合わせた雛形・feature map・spec つきで作る
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

/** @param {string[]} values */
function parseInit(values) {
  try {
    return parseArgs({ args: values, allowPositionals: true, options: { template: { type: 'string' } } });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
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
      const { created, next } = newFeature(id);
      console.log(`作成しました:\n${created.map((path) => `  ${path}`).join('\n')}`);
      console.log(`\n次にやること:\n${next.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`);
      return 0;
    }
    case 'init': {
      const { values, positionals } = parseInit(args);
      const [dir] = positionals;
      if (dir === undefined) break;
      const template = values.template ?? defaultTemplate;
      const created = init(dir, { template });
      const steps = ['pnpm install', ...(template === 'react-vite' ? ['pnpm exec playwright install chromium'] : []), 'pnpm check && pnpm test && pnpm verify --all'];
      console.log(`作成しました: ${created}（テンプレート: ${template}）\n\n次にやること:\n  cd ${dir}\n${steps.map((step) => `  ${step}`).join('\n')}`);
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
