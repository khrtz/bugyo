import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const source = resolve(import.meta.dirname, '..', '..', '..', 'examples', 'todo-app');
const target = resolve(import.meta.dirname, '..', 'template');
const skip = new Set(['node_modules', 'artifacts', 'dist', 'test-results', 'playwright-report', '__screenshots__']);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !relative(source, path).split(sep).some((part) => skip.has(part)),
});

const pkgPath = join(target, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.name = 'bugyo-app';
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (existsSync(join(target, '.gitignore'))) {
  cpSync(join(target, '.gitignore'), join(target, '_gitignore'));
  rmSync(join(target, '.gitignore'));
}
console.log(`template を同期しました: ${relative(process.cwd(), target)}`);
