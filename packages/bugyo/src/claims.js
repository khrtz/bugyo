import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tr } from './locale.js';

/**
 * タスクの id の予約と着手の記録を、git の ref で持つ。
 * 同じリポジトリの worktree は ref を共有し、`git update-ref <ref> <新> ""` は「まだ無いときだけ作る」を不可分に行うので、
 * 2つの worktree で同時に予約しても片方だけが成功する。`claims.remote` を設定すると、リモートにも push して別のマシンと共有する。
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
function git(cwd, args, env = {}) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { ok: run.status === 0, stdout: (run.stdout ?? '').trim(), stderr: (run.stderr ?? '').trim() };
}

/**
 * @typedef {{ cwd: string, prefix: string, remote: string | undefined }} Claims
 * @typedef {{ task: string, assignee?: string, branch: string, at: string }} ClaimRecord
 */

/**
 * cwd が git のリポジトリの中なら、そのプロジェクトの ref の置き場所を返す。リポジトリでなければ undefined（今までどおり手元のファイルだけで判定する）。
 * 1つのリポジトリに bugyo のプロジェクトが複数あっても混ざらないように、リポジトリのルートからの相対パスで分ける。
 * 相対パスは git に出させる（Windows の短い名前 `RUNNER~1` やシンボリックリンクで、パスの文字列を比べると食い違うため）。
 *
 * @param {string} cwd
 * @param {string | undefined} remote
 * @returns {Claims | undefined}
 */
export function openClaims(cwd, remote) {
  const inside = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout !== 'true') return undefined;
  const prefix = git(cwd, ['rev-parse', '--show-prefix']);
  if (!prefix.ok) return undefined;
  const rel = prefix.stdout.replace(/\/+$/, '');
  const key = rel === '' ? 'root' : rel.replace(/\.\.+/g, '_').replace(/[^A-Za-z0-9._/-]/g, '_');
  return { cwd, prefix: `refs/bugyo/${key}`, remote };
}

/** @param {string} branchCwd */
function currentBranch(branchCwd) {
  const run = git(branchCwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return run.ok ? run.stdout : '';
}

/**
 * 中身を JSON で持つ、毎回違うコミットを作る（同じ ref を2人が取ろうとしたとき、必ず別の値になるように）。
 *
 * @param {Claims} claims
 * @param {Omit<ClaimRecord, 'branch' | 'at'>} record
 */
function recordCommit(claims, record) {
  const tree = git(claims.cwd, ['mktree'], {});
  if (!tree.ok) throw new Error(tr({ en: `git mktree failed: ${tree.stderr}`, ja: `git mktree が失敗しました: ${tree.stderr}` }));
  const body = JSON.stringify({ ...record, branch: currentBranch(claims.cwd), at: new Date().toISOString(), nonce: randomBytes(6).toString('hex') });
  const identity = { GIT_AUTHOR_NAME: 'bugyo', GIT_AUTHOR_EMAIL: 'bugyo@localhost', GIT_COMMITTER_NAME: 'bugyo', GIT_COMMITTER_EMAIL: 'bugyo@localhost' };
  const commit = git(claims.cwd, ['commit-tree', tree.stdout, '-m', body], identity);
  if (!commit.ok) throw new Error(tr({ en: `git commit-tree failed: ${commit.stderr}`, ja: `git commit-tree が失敗しました: ${commit.stderr}` }));
  return commit.stdout;
}

/**
 * @param {Claims} claims
 * @param {'ids' | 'claims'} kind
 * @param {string} id
 */
const refName = (claims, kind, id) => `${claims.prefix}/${kind}/${id}`;

/**
 * リモートの ref を取ってくる。リモートが正なので、手元の同じ名前の ref は上書きする。
 *
 * @param {Claims} claims
 */
export function fetchClaims(claims) {
  if (claims.remote === undefined) return;
  const run = git(claims.cwd, ['fetch', '--quiet', claims.remote, `+${claims.prefix}/*:${claims.prefix}/*`]);
  if (!run.ok && !/couldn't find remote ref/i.test(run.stderr)) throw new Error(tr({ en: `git fetch ${claims.remote} failed: ${run.stderr}`, ja: `git fetch ${claims.remote} が失敗しました: ${run.stderr}` }));
}

/**
 * ref を「まだ無いときだけ」作り、リモートがあれば push する。取られていたら false。
 *
 * @param {Claims} claims
 * @param {string} ref
 * @param {string} commit
 */
function createRef(claims, ref, commit) {
  if (!git(claims.cwd, ['update-ref', ref, commit, '']).ok) return false;
  if (claims.remote === undefined) return true;
  if (git(claims.cwd, ['push', '--quiet', claims.remote, `${ref}:${ref}`]).ok) return true;
  git(claims.cwd, ['update-ref', '-d', ref, commit]);
  return false;
}

/**
 * @param {Claims} claims
 * @param {'ids' | 'claims'} kind
 * @returns {string[]} 記録のある id
 */
export function listRecords(claims, kind) {
  const run = git(claims.cwd, ['for-each-ref', '--format=%(refname)', `${claims.prefix}/${kind}/`]);
  return run.ok ? run.stdout.split('\n').filter((line) => line !== '').map((line) => line.split('/').pop() ?? '') : [];
}

/**
 * @param {Claims} claims
 * @param {'ids' | 'claims'} kind
 * @param {string} id
 * @returns {(ClaimRecord & { commit: string }) | undefined}
 */
export function readRecord(claims, kind, id) {
  const ref = refName(claims, kind, id);
  const commit = git(claims.cwd, ['rev-parse', '--verify', '--quiet', ref]);
  if (!commit.ok) return undefined;
  const message = git(claims.cwd, ['log', '-1', '--format=%B', ref]);
  try {
    return { ...JSON.parse(message.stdout), commit: commit.stdout };
  } catch {
    return { task: id, branch: '', at: '', commit: commit.stdout };
  }
}

/**
 * 次の id を予約する。手元のタスクと予約済みの id の最大に1を足し、取られていれば番号を進めて取り直す。
 *
 * @param {Claims} claims
 * @param {number} localMax 手元のタスクの最大の番号
 * @returns {string}
 */
export function reserveId(claims, localMax) {
  for (let round = 0; round < 5; round += 1) {
    fetchClaims(claims);
    const reserved = listRecords(claims, 'ids').map((id) => Number(id.slice(2))).filter((n) => Number.isFinite(n));
    let next = Math.max(localMax, ...reserved, 0) + 1;
    for (let attempt = 0; attempt < 20; attempt += 1, next += 1) {
      const id = `t-${String(next).padStart(3, '0')}`;
      if (createRef(claims, refName(claims, 'ids', id), recordCommit(claims, { task: id }))) return id;
    }
  }
  throw new Error(tr({ en: 'Could not reserve a task id. Wait a moment and try again', ja: 'タスクの id を予約できませんでした。少し待ってからやり直してください' }));
}

/**
 * 着手を記録する。別の人が記録していれば、その記録を返して断る。
 * 同じ人が同じブランチで記録していれば（start の途中で止まったあとのやり直し）、そのまま通す。
 *
 * @param {Claims} claims
 * @param {string} id
 * @param {string} assignee
 * @returns {{ ok: true } | { ok: false, holder: ClaimRecord }}
 */
export function claimTask(claims, id, assignee) {
  fetchClaims(claims);
  const ref = refName(claims, 'claims', id);
  if (createRef(claims, ref, recordCommit(claims, { task: id, assignee }))) return { ok: true };
  const holder = readRecord(claims, 'claims', id);
  if (holder === undefined) return claimTask(claims, id, assignee);
  if (holder.assignee === assignee && holder.branch === currentBranch(claims.cwd)) return { ok: true };
  return { ok: false, holder };
}

/**
 * 着手の記録の担当を書き換える（rework --as）。記録がなければ作る。
 *
 * @param {Claims} claims
 * @param {string} id
 * @param {string} assignee
 */
export function reassignClaim(claims, id, assignee) {
  fetchClaims(claims);
  const ref = refName(claims, 'claims', id);
  const current = readRecord(claims, 'claims', id);
  const next = recordCommit(claims, { task: id, assignee });
  const run = git(claims.cwd, ['update-ref', ref, next, current?.commit ?? '']);
  if (!run.ok) throw new Error(tr({ en: `Could not update the claim for ${id} (someone else is changing it): ${run.stderr}`, ja: `${id} の着手の記録を書き換えられませんでした（同時に誰かが書き換えています）: ${run.stderr}` }));
  if (claims.remote !== undefined) {
    const push = git(claims.cwd, ['push', '--quiet', '--force-with-lease', claims.remote, `${ref}:${ref}`]);
    if (!push.ok) throw new Error(tr({ en: `Could not push the claim for ${id} to ${claims.remote}: ${push.stderr}`, ja: `${id} の着手の記録を ${claims.remote} に送れませんでした: ${push.stderr}` }));
  }
}

/**
 * 着手の記録を消す（drop と release）。記録がなければ何もしない。
 *
 * @param {Claims} claims
 * @param {string} id
 */
export function releaseClaim(claims, id) {
  const ref = refName(claims, 'claims', id);
  const existed = readRecord(claims, 'claims', id) !== undefined;
  if (existed) git(claims.cwd, ['update-ref', '-d', ref]);
  if (claims.remote !== undefined) git(claims.cwd, ['push', '--quiet', claims.remote, `:${ref}`]);
  return existed;
}
