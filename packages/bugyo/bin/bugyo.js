#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { baselineCommand, doctorCommand, doctorUsage } from '../src/doctor-cli.js';
import { localeFor, setLocale, tr } from '../src/locale.js';
import { defaultTemplate, init, newFeature, templates } from '../src/scaffold.js';
import { UsageError, gateCommand, mistakeCommand, statsCommand, taskCommand, taskUsage } from '../src/task-cli.js';
import { verify } from '../src/verify.js';

const usage = () =>
  tr({
    en: `Usage:
  bugyo init <dir> [--template <name>]
                               create a new project with the foundation (default react-vite; available: ${templates().join(', ')})
  bugyo new feature <id>       create a feature with the template's scaffold, a feature map entry, and a spec
  bugyo verify <id>            run the feature for real and print only pass/fail and where the evidence is
  bugyo verify --all           check every feature in the feature map
${taskUsage()}
${doctorUsage()}`,
    ja: `使い方:
  bugyo init <dir> [--template <名前>]
                               土台入りの新しいプロジェクトを作る（既定は react-vite。使える名前: ${templates().join(', ')}）
  bugyo new feature <id>       feature を、テンプレートに合わせた雛形・feature map・spec つきで作る
  bugyo verify <id>            その feature を実際に動かし、合否と証拠の場所だけを出す
  bugyo verify --all           feature map にあるすべての feature を確かめる
${taskUsage()}
${doctorUsage()}`,
  });

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

/**
 * init のあとに見せるコマンド。bugyo を実行したパッケージマネージャー（npx・pnpm dlx など）に合わせる。
 *
 * @param {string} template
 */
function initSteps(template) {
  const agent = process.env['npm_config_user_agent'] ?? '';
  const pm = agent.startsWith('npm/') ? 'npm' : agent.startsWith('yarn/') ? 'yarn' : agent.startsWith('bun/') ? 'bun' : 'pnpm';
  const run = { npm: 'npm run', yarn: 'yarn', bun: 'bun run', pnpm: 'pnpm' }[pm];
  const exec = { npm: 'npx', yarn: 'yarn', bun: 'bunx', pnpm: 'pnpm exec' }[pm];
  return [
    `${pm} install`,
    ...(template === 'react-vite' ? [`${exec} playwright install chromium`] : []),
    `${run} check && ${pm === 'npm' ? 'npm test' : `${run} test`} && ${run} verify --all`,
  ];
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
    case 'stats':
      return statsCommand(args);
    case 'doctor':
      return doctorCommand(args);
    case 'baseline':
      return baselineCommand(args);
    case 'new': {
      const [kind, id] = args;
      if (kind !== 'feature' || id === undefined) break;
      const { created, next } = newFeature(id);
      console.log(`${tr({ en: 'Created:', ja: '作成しました:' })}\n${created.map((path) => `  ${path}`).join('\n')}`);
      console.log(`\n${tr({ en: 'Next:', ja: '次にやること:' })}\n${next.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`);
      return 0;
    }
    case 'init': {
      const { values, positionals } = parseInit(args);
      const [dir] = positionals;
      if (dir === undefined) break;
      const template = values.template ?? defaultTemplate;
      const created = init(dir, { template });
      const steps = [`cd ${dir}`, ...initSteps(template)].map((step) => `  ${step}`).join('\n');
      console.log(
        tr({
          en: `Created: ${created} (template: ${template})\n\nNext:\n${steps}`,
          ja: `作成しました: ${created}（テンプレート: ${template}）\n\n次にやること:\n${steps}`,
        }),
      );
      return 0;
    }
    default:
      break;
  }
  console.error(usage());
  return 2;
}

try {
  setLocale(localeFor(process.cwd()));
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof UsageError) console.error(`\n${usage()}`);
  process.exit(error instanceof UsageError ? 2 : 1);
}
