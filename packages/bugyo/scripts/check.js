import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = [
  'bin/bugyo.js',
  ...readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `src/${name}`),
  ...readdirSync(join(root, 'scripts'))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `scripts/${name}`),
];

const failed = files.filter((file) => spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'inherit' }).status !== 0);
if (failed.length > 0) {
  console.error(`構文エラー: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`構文を確かめました: ${files.length} ファイル`);
