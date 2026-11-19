import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** テンプレートの名前と、元になる examples/ のフォルダ */
const sources = { 'react-vite': 'todo-app', 'node-lib': 'node-lib', generic: 'generic' };
const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const target = resolve(import.meta.dirname, '..', 'template');
const skip = new Set(['node_modules', 'artifacts', 'dist', 'test-results', 'playwright-report', '__screenshots__']);
const ledger = ['.bugyo/tasks', '.bugyo/evidence', '.bugyo/mistakes'];

rmSync(target, { recursive: true, force: true });
for (const [name, folder] of Object.entries(sources)) {
  const source = join(examples, folder);
  const dir = join(target, name);
  cpSync(source, dir, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path).split(sep);
      return !rel.some((part) => skip.has(part)) && !ledger.some((prefix) => rel.join('/').startsWith(prefix));
    },
  });

  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = 'bugyo-app';
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  if (existsSync(join(dir, '.gitignore'))) {
    cpSync(join(dir, '.gitignore'), join(dir, '_gitignore'));
    rmSync(join(dir, '.gitignore'));
  }
}
console.log(`template を同期しました: ${Object.keys(sources).map((name) => relative(process.cwd(), join(target, name))).join(', ')}`);
