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
  /** パッケージマネージャー。書かなければ package.json の packageManager か lockfile から決める（見つからなければ pnpm）。commands の既定を選ぶ */
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
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
    /** 機能のフォルダを並べる場所。既定は `layers.features`、layers がなければ `src/features`。null で検査を飛ばす */
    featuresDir: string | null;
  };
  /**
   * 層のフォルダの場所（プロジェクトのルートからの相対パス）。書いたときは bugyo new feature が雛形を作らず断り、
   * bugyo doctor がどの層にも入っていないファイルを出す。ESLint と dependency-cruiser には同じ値を渡す
   */
  layers?: { app: string; features: string; shared: { ui: string; api: string; lib: string } } | undefined;
  /** bugyo task done が実行するコマンド。このキーがないときだけ、packageManager に合わせた既定値（pnpm なら pnpm check / pnpm test / bugyo verify {feature}）を使う */
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
    /** そのうち中止したタスクの上限。既定は 2 */
    maxDropped: number;
    /**
     * 作業の種類のまとまりごとの判定。ないときは ui（feature・ui-flow・ui-look）、code（logic・bugfix・refactor）、chore（chore）。
     * しきい値を省いたまとまりは、上の値を使う
     */
    scopes?: Record<string, { types: string[]; window?: number; maxRework?: number; minFirstPass?: number; maxDropped?: number }> | undefined;
  };
  claims: {
    /** id の予約と着手の記録（git の ref）を共有するリモート。書かなければ、同じマシンの worktree の間だけで共有する */
    remote?: string | undefined;
  };
  notify: {
    /**
     * bugyo task recheck --notify が、証拠を取り直して通った課題つきのタスクごとに実行するコマンド。
     * `{issue}`・`{task}`・`{evidence}` が置き換わる。手元の bugyo task done では実行しない
     */
    verified?: string | undefined;
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
  /** dev サーバーを起動するコマンド。既定は `vite --port <port> --strictPort`（node_modules/.bin の vite を使う） */
  command?: string;
  overrides?: PlaywrightTestConfig;
}
