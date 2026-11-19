import type { PlaywrightTestConfig } from '@playwright/test';

export interface Feature {
  id: string;
  /** 画面のある機能で、その機能に辿り着く URL のパス。任意 */
  route?: string;
  /** その機能を確かめるファイル（プロジェクトのルートからの相対パス）。いくつもあるときは最初のもの */
  spec: string;
  /** その機能を確かめるファイルのすべて。frontmatter の spec に `,` 区切りで書く */
  specs: string[];
  /** その機能を確かめる方法の名前（`playwright`・`command`・`verify.runners` の名前）。書かなければ spec ごとに決める */
  runner?: string;
  /** docs/features/<id>.md（cwd からの相対パス） */
  file: string;
  body: string;
}

export const featureDir: string;
export const requiredSections: readonly string[];
/** feature map の4つの見出し。日本語（ja）と英語（en）のどちらで書いてもよい */
export const sectionHeadings: readonly { readonly ja: string; readonly en: string }[];
export function loadFeatures(cwd?: string): Feature[];
export function loadSweepOrder(cwd?: string): string[];

export interface BugyoConfig {
  /** bugyo init で使ったテンプレートの名前。bugyo new feature が生成物を選ぶ */
  template?: string | undefined;
  /** パッケージマネージャー。書かなければ package.json の packageManager か lockfile から決める（見つからなければ npm）。commands の既定を選ぶ */
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  /**
   * bugyo doctor と bugyo baseline で数える、外の lint の結果（SARIF）。`command` があれば実行してから `file` を読む。
   * ツールとルールごとに数える（`sarif: <ツール>/<ルール>`）
   */
  sarif?: { command?: string | undefined; file: string }[] | undefined;
  /** @bugyo/lint の禁止のメッセージの言語。書かなければ `en`（環境変数 `BUGYO_LOCALE` のほうが先） */
  locale?: 'ja' | 'en';
  verify: {
    /**
     * 既定の確かめ方の名前。`playwright`（既定）は JSON レポートから spec ごとの合否を読む。`command` は spec ごとに command を1回ずつ実行する。
     * `runners` に書いた名前も使える
     */
    runner: string;
    /** `command` で spec ごとに実行するコマンド。`{id}` と `{spec}` が置き換わる */
    command?: string | undefined;
    /**
     * 名前を付けた確かめ方。feature map の frontmatter の `runner` で選ぶか、`match` の glob に当たる spec に使う。
     * `env` はそのときだけ足す環境変数
     */
    runners?:
      | Record<
          string,
          {
            runner: 'playwright' | 'command';
            command?: string | undefined;
            env?: Record<string, string> | undefined;
            match?: string | string[] | undefined;
            /**
             * command のとき、実行が書くはずの証拠のファイルの glob（`{id}` と `{spec}` が置き換わる）。
             * 実行のあいだに書かれたファイルが1つもなければ、終了コードが 0 でも FAIL。見つかったファイルはハッシュと一緒に verify.json に残る
             */
            evidence?: string[] | undefined;
            /** `sandbox` なら、`verify.sandbox` のコマンドが通るときだけ動かす（通らなければ FAIL） */
            requires?: 'sandbox' | undefined;
          }
        >
      | undefined;
    /** 隔離環境かどうかを確かめるコマンド。`requires: 'sandbox'` の確かめ方を動かす前に1回だけ実行する */
    sandbox?: string | undefined;
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
  layers?:
    | {
        app: string;
        features: string;
        /** shared の場所。設定では1つなら文字列でも書け、読み込むと配列になる */
        shared: { ui: string[]; api: string[]; lib: string[]; model: string[]; other: string[] };
        /** feature の中のフォルダ名を役割ごとに。書かなかった役割は ui・api・model */
        featureParts: { ui: string[]; api: string[]; model: string[] };
      }
    | undefined;
  /**
   * 層の決まりを当てるソースがいくつもあるとき（フロントとサーバーなど）の、ソースごとの場所。layers とは一緒に書けない。
   * 台帳と feature map は1つのままで、同じ id の機能のフォルダは、どのソースにあっても同じ機能として扱う
   */
  sources?:
    | Record<
        string,
        {
          src: string;
          layers: NonNullable<BugyoConfig['layers']>;
          tsconfig?: string | undefined;
        }
      >
    | undefined;
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
  pullRequests: {
    /** bugyo task pr-check が、タスクに紐づかなくても通すブランチ名の glob（例: `dependabot/**`） */
    allowBranches: string[];
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
  /**
   * 同じポートですでに動いているサーバーを使い回すか。既定は false で、ポートが使われていれば起動せずに失敗する
   * （別のプロジェクトのサーバーを撮って証拠にしないため）。使い回すのは、そのサーバーがこのプロジェクトのものだと決まっているときだけにする
   */
  reuseExistingServer?: boolean;
  overrides?: PlaywrightTestConfig;
}
