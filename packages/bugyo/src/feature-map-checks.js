import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { featureDir, loadFeatures, loadSweepOrder, requiredSections } from './feature-map.js';
import { runsOf } from './runners.js';

/**
 * feature map の整合を確かめる検査の一覧を作る。テストランナーごとの登録は vitest.js と node-test.js が受け持つ。
 * 場所は引数、`.bugyo/config.json` の featureMap、既定値の順に決まる。該当するフォルダがない検査は skip に理由が入る。
 *
 * @param {import('./index.js').FeatureMapOptions} [options]
 * @returns {import('./index.js').FeatureMapCheck[]}
 */
export function featureMapChecks(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const { featureMap: config, verify } = loadConfig(cwd);
  const featuresDir =
    options.featuresDir !== undefined ? options.featuresDir : options.src !== undefined ? `${options.src}/features` : config.featuresDir;
  const specDir = options.specDir !== undefined ? options.specDir : config.specDir;
  const specSuffix = options.specSuffix ?? config.specSuffix;
  const features = loadFeatures(cwd);

  /** @param {string | null} dir */
  const missing = (dir) => (dir === null ? '設定で外されています' : existsSync(join(cwd, dir)) ? null : `${dir} がありません`);

  return [
    {
      title: 'ファイル名と id が一致している',
      skip: null,
      problems: () =>
        features
          .filter((feature) => feature.file !== `${featureDir}/${feature.id}.md`)
          .map((feature) => `${feature.file} の id は ${feature.id} です`),
    },
    {
      title: 'すべての機能に4つの見出しがある',
      skip: null,
      problems: () =>
        features.flatMap((feature) =>
          requiredSections
            .filter((section) => !feature.body.includes(`## ${section}`))
            .map((section) => `${feature.file} に「## ${section}」がありません`),
        ),
    },
    {
      title: 'すべての機能の spec が実在する',
      skip: null,
      problems: () =>
        features.flatMap((feature) => feature.specs.filter((spec) => !existsSync(join(cwd, spec))).map((spec) => `${feature.file}: ${spec} がありません`)),
    },
    {
      title: 'すべての機能の spec の確かめ方が決まる',
      skip: null,
      problems: () =>
        features.flatMap((feature) => {
          const resolved = runsOf(feature, verify);
          return 'error' in resolved ? [resolved.error] : [];
        }),
    },
    {
      title: `${specDir ?? 'spec のフォルダ'} のすべての *${specSuffix} が、どれかの機能に対応している`,
      skip: missing(specDir),
      problems: () => {
        const mapped = new Set(features.flatMap((feature) => feature.specs));
        return readdirSync(join(cwd, specDir ?? ''))
          .filter((name) => name.endsWith(specSuffix))
          .map((name) => `${specDir}/${name}`)
          .filter((spec) => !mapped.has(spec))
          .map((spec) => `${spec} に対応する ${featureDir}/*.md がありません`);
      },
    },
    {
      title: `${featuresDir ?? '機能のフォルダ'} のフォルダがすべて feature map に載っている`,
      skip: missing(featuresDir),
      problems: () => {
        const ids = new Set(features.map((feature) => feature.id));
        return readdirSync(join(cwd, featuresDir ?? ''))
          .filter((dir) => !ids.has(dir))
          .map((dir) => `${featuresDir}/${dir} に対応する ${featureDir}/${dir}.md がありません`);
      },
    },
    {
      title: 'README の回帰の順番に、すべての機能がちょうど1回ずつ載っている',
      skip: null,
      problems: () => {
        const order = loadSweepOrder(cwd);
        const ids = features.map((feature) => feature.id);
        return [
          ...ids.filter((id) => order.filter((entry) => entry === id).length !== 1).map((id) => `${featureDir}/README.md に ${id} がちょうど1回ありません`),
          ...order.filter((entry) => !ids.includes(entry)).map((entry) => `${featureDir}/README.md の ${entry} に対応する機能がありません`),
        ].filter((problem, index, all) => all.indexOf(problem) === index);
      },
    },
  ];
}
