import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openClaims } from '../src/claims.js';

test('ref の置き場所は、別の名前のパス（リンクや Windows の短い名前）から開いても同じになる', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bugyo-claims-')));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'apps', 'web'), { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const link = join(base, 'link');
  symlinkSync(repo, link, process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(openClaims(join(repo, 'apps', 'web'), undefined)?.prefix, 'refs/bugyo/apps/web');
  assert.equal(openClaims(join(link, 'apps', 'web'), undefined)?.prefix, 'refs/bugyo/apps/web');
  assert.equal(openClaims(repo, undefined)?.prefix, 'refs/bugyo/root');
  assert.equal(openClaims(link, undefined)?.prefix, 'refs/bugyo/root');
  assert.equal(openClaims(base, undefined), undefined, 'リポジトリの外では使わない');
});
