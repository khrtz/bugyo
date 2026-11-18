import { posix } from 'node:path';

/**
 * @typedef {{ name: string, runner: 'playwright' | 'command', command: string | undefined, env: Record<string, string>, match: string[], evidence: string[], sandbox: boolean }} Runner
 * @typedef {{ spec: string, runner: Runner }} Run
 */

/** 設定に書かなくても使える確かめ方の名前 */
export const builtinRunners = /** @type {const} */ (['playwright', 'command']);

/**
 * 設定から、名前ごとの確かめ方を作る。`playwright` と `command`（`verify.command` を使う）は常にある。
 *
 * @param {import('./index.js').BugyoConfig['verify']} verify
 * @returns {Map<string, Runner>}
 */
export function runnersOf(verify) {
  /** @type {Map<string, Runner>} */
  const runners = new Map([
    ['playwright', { name: 'playwright', runner: 'playwright', command: undefined, env: {}, match: [], evidence: [], sandbox: false }],
    ['command', { name: 'command', runner: 'command', command: verify.command, env: {}, match: [], evidence: [], sandbox: false }],
  ]);
  for (const [name, runner] of Object.entries(verify.runners ?? {})) {
    const match = runner.match === undefined ? [] : typeof runner.match === 'string' ? [runner.match] : runner.match;
    runners.set(name, {
      name,
      runner: runner.runner,
      command: runner.command,
      env: { ...(runner.env ?? {}) },
      match,
      evidence: [...(runner.evidence ?? [])],
      sandbox: runner.requires === 'sandbox',
    });
  }
  return runners;
}

/**
 * 機能の spec ごとに、どの確かめ方で動かすかを決める。
 * frontmatter の `runner` があればすべての spec をそれで、なければ `match` の glob に当たる確かめ方で、どれにも当たらなければ `verify.runner` で動かす。
 * 決められないとき（知らない名前、2つの glob に当たる spec、コマンドのない command）は、理由を返す。
 *
 * @param {import('./index.js').Feature} feature
 * @param {import('./index.js').BugyoConfig['verify']} verify
 * @returns {{ runs: Run[] } | { error: string }}
 */
export function runsOf(feature, verify) {
  const runners = runnersOf(verify);
  const known = () => [...runners.keys()].join(', ');
  /** @type {Run[]} */
  const runs = [];
  for (const spec of feature.specs) {
    /** @type {Runner | undefined} */
    let runner;
    if (feature.runner !== undefined) {
      runner = runners.get(feature.runner);
      if (runner === undefined) return { error: `${feature.file}: runner の ${feature.runner} がありません（使えるのは ${known()}。.bugyo/config.json の verify.runners に書きます）` };
    } else {
      const matched = [...runners.values()].filter((candidate) => candidate.match.some((glob) => posix.matchesGlob(spec, glob)));
      if (matched.length > 1) return { error: `${feature.file}: ${spec} が ${matched.map((candidate) => candidate.name).join(' と ')} の match の両方に当たります。frontmatter に runner を書くか、match を直してください` };
      runner = matched[0] ?? runners.get(verify.runner);
      if (runner === undefined) return { error: `.bugyo/config.json: verify.runner の ${verify.runner} がありません（使えるのは ${known()}）` };
    }
    if (runner.runner === 'command' && !runner.command?.trim()) {
      return { error: `${feature.file}: ${runner.name} で動かすにはコマンドが要ります（.bugyo/config.json の ${runner.name === 'command' ? 'verify.command' : `verify.runners.${runner.name}.command`}）` };
    }
    runs.push({ spec, runner });
  }
  return { runs };
}
