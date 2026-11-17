import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';

/**
 * 設定に書かれたコマンドの文字列を、そのままシェルで実行する。
 * pnpm の scripts と同じく、プロジェクトの node_modules/.bin を PATH の先頭に足す。
 *
 * @param {string} command
 * @param {string} cwd
 * @returns {{ status: number, output: string, ms: number }}
 */
export function runCommand(command, cwd) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [join(cwd, 'node_modules', '.bin'), env[pathKey] ?? ''].join(delimiter);
  const started = Date.now();
  const result = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
    ms: Date.now() - started,
  };
}

/**
 * @param {string} text
 * @param {number} [lines]
 */
export function tail(text, lines = 30) {
  return text.trim().split('\n').slice(-lines).join('\n');
}
