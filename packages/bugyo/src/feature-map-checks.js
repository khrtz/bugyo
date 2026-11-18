import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { featureRoots, loadConfig } from './config.js';
import { featureDir, loadFeatures, loadSweepOrder, missingSections, sectionHeadings } from './feature-map.js';
import { tr } from './locale.js';
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
  const loaded = loadConfig(cwd);
  const { featureMap: config, verify } = loaded;
  const override = options.featuresDir !== undefined ? options.featuresDir : options.src !== undefined ? `${options.src}/features` : undefined;
  /** @type {(string | null)[]} */
  const featuresDirs =
    override !== undefined ? [override] : loaded.sources !== undefined ? featureRoots(loaded).map((root) => root.featuresDir) : [config.featuresDir];
  const specDir = options.specDir !== undefined ? options.specDir : config.specDir;
  const specSuffix = options.specSuffix ?? config.specSuffix;
  const features = loadFeatures(cwd);

  /** @param {string | null} dir */
  const missing = (dir) =>
    dir === null
      ? tr({ en: 'turned off in the config', ja: '設定で外されています' })
      : existsSync(join(cwd, dir))
        ? null
        : tr({ en: `${dir} does not exist`, ja: `${dir} がありません` });

  return [
    {
      title: tr({ en: 'file names match their ids', ja: 'ファイル名と id が一致している' }),
      skip: null,
      problems: () =>
        features
          .filter((feature) => feature.file !== `${featureDir}/${feature.id}.md`)
          .map((feature) => tr({ en: `the id of ${feature.file} is ${feature.id}`, ja: `${feature.file} の id は ${feature.id} です` })),
    },
    {
      title: tr({ en: 'every feature has the four headings', ja: 'すべての機能に4つの見出しがある' }),
      skip: null,
      problems: () =>
        features.flatMap((feature) =>
          missingSections(feature).map((section) => {
            const english = sectionHeadings.find((heading) => heading.ja === section)?.en;
            return tr({ en: `${feature.file} has no "## ${english}" (or "## ${section}" in Japanese)`, ja: `${feature.file} に「## ${section}」（英語なら「## ${english}」）がありません` });
          }),
        ),
    },
    {
      title: tr({ en: 'every feature spec exists', ja: 'すべての機能の spec が実在する' }),
      skip: null,
      problems: () =>
        features.flatMap((feature) => feature.specs.filter((spec) => !existsSync(join(cwd, spec))).map((spec) => `${feature.file}: ${tr({ en: `${spec} does not exist`, ja: `${spec} がありません` })}`)),
    },
    {
      title: tr({ en: 'every feature spec has a way to check it', ja: 'すべての機能の spec の確かめ方が決まる' }),
      skip: null,
      problems: () =>
        features.flatMap((feature) => {
          const resolved = runsOf(feature, verify);
          return 'error' in resolved ? [resolved.error] : [];
        }),
    },
    {
      title: tr({
        en: `every *${specSuffix} in ${specDir ?? 'the spec folder'} belongs to a feature`,
        ja: `${specDir ?? 'spec のフォルダ'} のすべての *${specSuffix} が、どれかの機能に対応している`,
      }),
      skip: missing(specDir),
      problems: () => {
        const mapped = new Set(features.flatMap((feature) => feature.specs));
        return readdirSync(join(cwd, specDir ?? ''))
          .filter((name) => name.endsWith(specSuffix))
          .map((name) => `${specDir}/${name}`)
          .filter((spec) => !mapped.has(spec))
          .map((spec) => tr({ en: `no ${featureDir}/*.md for ${spec}`, ja: `${spec} に対応する ${featureDir}/*.md がありません` }));
      },
    },
    ...featuresDirs.map((featuresDir) => ({
      title: tr({ en: `every folder in ${featuresDir ?? 'the features folder'} is in the feature map`, ja: `${featuresDir ?? '機能のフォルダ'} のフォルダがすべて feature map に載っている` }),
      skip: missing(featuresDir),
      problems: () => {
        const ids = new Set(features.map((feature) => feature.id));
        return readdirSync(join(cwd, featuresDir ?? ''))
          .filter((dir) => !ids.has(dir))
          .map((dir) => tr({ en: `no ${featureDir}/${dir}.md for ${featuresDir}/${dir}`, ja: `${featuresDir}/${dir} に対応する ${featureDir}/${dir}.md がありません` }));
      },
    })),
    {
      title: tr({ en: 'the sweep order in the README lists every feature exactly once', ja: 'README の回帰の順番に、すべての機能がちょうど1回ずつ載っている' }),
      skip: null,
      problems: () => {
        const order = loadSweepOrder(cwd);
        const ids = features.map((feature) => feature.id);
        return [
          ...ids.filter((id) => order.filter((entry) => entry === id).length !== 1).map((id) => tr({ en: `${featureDir}/README.md does not list ${id} exactly once`, ja: `${featureDir}/README.md に ${id} がちょうど1回ありません` })),
          ...order.filter((entry) => !ids.includes(entry)).map((entry) => tr({ en: `${featureDir}/README.md lists ${entry}, but there is no such feature`, ja: `${featureDir}/README.md の ${entry} に対応する機能がありません` })),
        ].filter((problem, index, all) => all.indexOf(problem) === index);
      },
    },
  ];
}
