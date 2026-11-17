import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { sep } from 'node:path';

const files = readdirSync('lib', { recursive: true })
  .map((path) => String(path).split(sep).join('/'))
  .filter((path) => path.endsWith('.js'));
const failed = files.filter((file) => spawnSync(process.execPath, ['--check', `lib/${file}`], { stdio: 'inherit' }).status !== 0);
if (failed.length > 0) process.exit(1);
console.log(`check: ${files.length} files`);
