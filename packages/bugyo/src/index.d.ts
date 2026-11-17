import type { PlaywrightTestConfig } from '@playwright/test';

export interface Feature {
  id: string;
  /** 画面のある機能で、その機能に辿り着く URL のパス。任意 */
  route?: string;
  /** その機能を確かめるファイル（プロジェクトのルートからの相対パス） */
  spec: string;
  /** docs/features/<id>.md（cwd からの相対パス） */
  file: string;
  body: string;
}

export const featureDir: string;
export const requiredSections: readonly string[];
export function loadFeatures(cwd?: string): Feature[];
export function loadSweepOrder(cwd?: string): string[];

export interface BugyoConfig {
  /** bugyo init で使ったテンプレートの名前。bugyo new feature が生成物を選ぶ */
  template?: string | undefined;
  verify: {
    /** `playwright`（既定）は JSON レポートから spec ごとの合否を読む。`command` は機能ごとに command を1回ずつ実行する */
    runner: 'playwright' | 'command';
    /** runner が `command` のときに機能ごとに実行するコマンド。`{id}` と `{spec}` が置き換わる */
    command?: string | undefined;
  };
  featureMap: {
    /** spec を探すフォルダ。既定は `e2e`。null で検査を飛ばす */
    specDir: string | null;
    /** spec のファイル名の末尾。既定は `.spec.ts` */
    specSuffix: string;
    /** 機能のフォルダを並べる場所。既定は `src/features`。null で検査を飛ばす */
    featuresDir: string | null;
  };
  /** bugyo task done が実行するコマンド。このキーがないときだけ既定値（pnpm check / pnpm test / bugyo verify {feature}）を使う */
  commands?: { check?: string | undefined; test?: string | undefined; verify?: string | undefined } | undefined;
  evidence: {
    /** evidence-tree のハッシュを取るパス。既定は `["src", "e2e"]` */
    tree: string[];
  };
  gate: {
    /** 門番が見る直近の完了タスクの件数。既定は 20 */
    window: number;
    /** そのうち手直しが要ったタスクの上限。既定は 2 */
    maxRework: number;
    /** そのうち1回の done で閉じたタスクの下限。既定は 16 */
    minFirstPass: number;
  };
}

export const configFile: string;
export function loadConfig(cwd?: string): BugyoConfig;

export interface FeatureMapOptions {
  cwd?: string;
  /** ソースのルート。featuresDir を指定しないとき `<src>/features` を機能のフォルダにする */
  src?: string;
  specDir?: string | null;
  specSuffix?: string;
  featuresDir?: string | null;
}

export interface FeatureMapCheck {
  title: string;
  /** 対象のフォルダがなく飛ばすときの理由。飛ばさないときは null */
  skip: string | null;
  /** 見つかった問題。空なら合格 */
  problems(): string[];
}

export function featureMapChecks(options?: FeatureMapOptions): FeatureMapCheck[];

export interface BugyoPlaywrightOptions {
  port?: number;
  /** dev サーバーを起動するコマンド。既定は `pnpm exec vite --port <port> --strictPort` */
  command?: string;
  overrides?: PlaywrightTestConfig;
}
