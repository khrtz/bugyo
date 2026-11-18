import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';

/**
 * 設定に書かれたコマンドの文字列を、そのままシェルで実行する。
 * pnpm の scripts と同じく、プロジェクトの node_modules/.bin を PATH の先頭に足す。
 *
 * @param {string} command
 * @param {string} cwd
 * @param {Record<string, string>} [extraEnv] 足す環境変数
 * @returns {{ status: number, output: string, ms: number }}
 */
export function runCommand(command, cwd, extraEnv = {}) {
  const env = { ...commandEnv(cwd), ...extraEnv };
  const started = Date.now();
  const result = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
    ms: Date.now() - started,
  };
}

/**
 * runCommand と同じ環境変数（node_modules/.bin を PATH の先頭に足したもの）。
 *
 * @param {string} cwd
 */
export function commandEnv(cwd) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [join(cwd, 'node_modules', '.bin'), env[pathKey] ?? ''].join(delimiter);
  return env;
}

/**
 * コマンドの最初の語が、runCommand と同じ PATH で見つかるか。
 * 見つからないときも終了コードは0以外になるので、「テストが落ちた」と区別するために使う。
 * 最初の語が `NAME=値` やパスの形なら、見つかるものとして扱う。
 *
 * @param {string} command
 * @param {string} cwd
 */
export function commandExists(command, cwd) {
  const first = /^\s*(?:"([^"]+)"|(\S+))/.exec(command);
  const name = first?.[1] ?? first?.[2] ?? '';
  if (name === '' || name.includes('=') || name.includes('/') || name.includes('\\')) return true;
  const probe =
    process.platform === 'win32'
      ? spawnSync('where', [name], { cwd, env: commandEnv(cwd), encoding: 'utf8' })
      : spawnSync('sh', ['-c', 'command -v "$1"', 'sh', name], { cwd, env: commandEnv(cwd), encoding: 'utf8' });
  return probe.status === 0;
}

/**
 * テストを1件も実行していないことを示す出力か（node:test、Vitest、Playwright、Jest）。
 *
 * @param {string} output
 */
export function ranNoTests(output) {
  return /^ℹ tests 0$/m.test(output) || /No test files found/i.test(output) || /No tests found/i.test(output);
}

/**
 * @param {string} text
 * @param {number} [lines]
 */
export function tail(text, lines = 30) {
  return text.trim().split('\n').slice(-lines).join('\n');
}
