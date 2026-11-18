import type { Linter } from 'eslint';

export interface RestrictedImportPath {
  name: string;
  importNames?: string[];
  message: string;
}

export interface RestrictedImportPattern {
  group: string[];
  message: string;
}

export interface RestrictedGlobal {
  name: string;
  message: string;
}

export interface RestrictedProperty {
  object?: string;
  property?: string;
  message: string;
}

export interface RestrictedSyntax {
  /** ESLint の AST セレクタ（例: "NewExpression[callee.name='Date'][arguments.length=0]"） */
  selector: string;
  message: string;
}

/**
 * 組み合わせられる設定の部品（React 用の部品は @bugyo/lint-react にある）。同じスコープの禁止（no-restricted-imports など）は bugyo() が1つのルールに合成する。
 */
export interface BugyoPart {
  readonly name: string;
  readonly rank: number;
}

/** 共通: 厳しい型検査、any・型アサーション・非 null アサーション・待っていない Promise・switch の漏れ、理由のない eslint-disable。必須 */
export const common: BugyoPart;
/** 構成: app / features/<id> / shared の境界、feature の外からは index.ts だけ、model から ui・api・shared/ui・shared/api への依存の禁止 */
export const structure: BugyoPart;
/** 禁止 `comments`: コメントは公開 API の JSDoc と理由つきの eslint-disable だけ */
export const noComments: BugyoPart;
/** 禁止 `fetch`: fetch は apiClientDir とテストでだけ呼べる */
export const fetchOnlyInApi: BugyoPart;

/** 禁止が、build のときに受け取る bugyo の設定 */
export interface BugyoContext {
  root: string;
  src: string;
  /** import の解決に使う tsconfig（root からの相対パス） */
  tsconfig: string;
  /** エラー文に書く、`effects` の場所。いくつもあれば `・` でつなぐ */
  effectHooksDir: string;
  /** エラー文に書く、`api` の場所。いくつもあれば `・` でつなぐ */
  apiClientDir: string;
  layers: ResolvedLayers;
  /** エラー文に書く、機能のフォルダの名前（layers がなければ `features`） */
  featuresLabel: string;
}

/**
 * 禁止1つ。bugyo の禁止も、利用側で足す禁止も、この形で書く。
 */
export interface BanSpec {
  /** 禁止の名前。小文字・数字・ハイフン。`severity` で warn に下げるときにも使う。同じ名前の禁止は2つ置けない */
  name: string;
  /**
   * どこで止めるか。`src`（既定。src の下の .ts / .tsx）、`ui`（features の各 feature の ui/）、`model`（各 feature の model/ と `layers.shared.model`）。
   * root からの glob は、`rules` だけの禁止で使える（imports・globals・syntax・properties があると断る）
   */
  scope?: string;
  /**
   * どこでは許すか。`effects`（effectHooksDir、なければ `layers.shared.lib` のすべて）、`api`（apiClientDir、なければ `layers.shared.api` のすべて）、`tests`（src の下の *.test.ts(x)）か、root からの glob
   */
  allow?: string[];
  imports?: { paths?: RestrictedImportPath[]; patterns?: RestrictedImportPattern[] };
  globals?: (string | RestrictedGlobal)[];
  syntax?: RestrictedSyntax[];
  properties?: RestrictedProperty[];
  /** 合成しない ESLint のルール（例: `{ 'no-console': 'error' }`）。scope の中で当て、allow の場所では off にする */
  rules?: Record<string, Linter.RuleEntry>;
  /** rules で使うプラグイン */
  plugins?: Record<string, object>;
}

/**
 * 禁止を1つ、部品として作る。`bugyo({ parts: [common, structure, defineBan({ ... })] })` のように、bugyo の部品や禁止と並べて渡す。
 * エラー文に effectHooksDir などを使うときは、`build(context)` で name 以外の項目を返す。
 */
export function defineBan(spec: BanSpec | ({ name: string; build: (context: BugyoContext) => Omit<BanSpec, 'name'> } & Omit<BanSpec, 'name'>)): BugyoPart;

/** 部品の中で禁止を書くときに使う。書き方を確かめ、足りない項目を埋める */
export function normalizeBan(spec: BanSpec): object;

export interface BugyoLayers {
  /** 画面を組み立てる層。feature の index.ts だけを使える */
  app?: string;
  /** feature を1つずつフォルダに置く層 */
  features?: string;
  /**
   * どの feature からも使える層。features と app には依存できない。それぞれフォルダ1つか、フォルダの配列で書く。
   * - `model`: 共有の純粋なロジック。feature の model と同じく、`scope: 'model'` の禁止が当たり、shared の lib と model だけを使える。既定はなし
   * - `other`: 役割を持たない共有のフォルダ（状態管理など）。features と app に依存できないことだけを守る。model からは使えない。既定はなし
   */
  shared?: {
    ui?: string | string[];
    api?: string | string[];
    lib?: string | string[];
    model?: string | string[];
    other?: string | string[];
  };
  /**
   * feature の中のフォルダ名を役割ごとに書く。既定は `{ ui: ['ui'], api: ['api'], model: ['model'] }`。
   * ui に書いたフォルダには ui の禁止が、model に書いたフォルダには model の禁止が当たる。1つの名前は1つの役割にだけ書ける。
   * 例: `{ ui: ['components', 'hooks'], api: ['api'], model: ['lib'] }`
   */
  featureParts?: { ui?: string[]; api?: string[]; model?: string[] };
}

export interface ResolvedLayers {
  app: string;
  features: string;
  shared: { ui: string[]; api: string[]; lib: string[]; model: string[]; other: string[] };
  featureParts: { ui: string[]; api: string[]; model: string[] };
}

export function resolveLayers(src: string, layers: BugyoLayers | undefined): ResolvedLayers;

/** ソース1つ分の設定。`bugyo({ sources })` のそれぞれに書く。項目の意味は BugyoOptions の同じ名前のもの */
export interface BugyoSource {
  src?: string;
  layers?: BugyoLayers;
  parts?: readonly BugyoPart[];
  /** import の解決に使う tsconfig（root からの相対パス）。既定は `tsconfig.json` */
  tsconfig?: string;
  explicitExtensions?: boolean;
  effectHooksDir?: string;
  apiClientDir?: string;
}

export interface BugyoOptions extends BugyoSource {
  /** eslint.config.js で `import.meta.dirname` を渡す */
  root: string;
  /**
   * 1つのリポジトリに、層の決まりを当てるソースがいくつもあるとき（フロントとサーバーなど）に、ソースごとの設定を並べる。
   * 書くときは src・layers・parts・tsconfig・explicitExtensions・effectHooksDir・apiClientDir を外に書かない。
   * 部品の、src の外にも当てるルール（common の型の検査など）は、どれかのソースに入っていれば全体に1回だけ当てる
   */
  sources?: readonly BugyoSource[];
  /**
   * 使う部品と禁止。既定は `[common, structure]`。common は必須。React を使うなら @bugyo/lint-react の `react` を足す。
   * 禁止（`noComments`・`fetchOnlyInApi`、@bugyo/lint-react の `noUseEffect`・`noUiTimers`、defineBan で作ったもの）も並べて渡す。順番は結果に影響しない
   */
  parts?: readonly BugyoPart[];
  /**
   * import に拡張子を書くプロジェクト（Node の型除去で .ts を直接動かすなど）で true にする。
   * `features/<id>/index.ts` をファイル名つきで import できるようにする。既定は false
   */
  explicitExtensions?: boolean;
  /** ソースのルート。既定は `src`。`layers` のフォルダはすべてこの中に置く */
  src?: string;
  /**
   * 層のフォルダの場所（root からの相対パス）。既定は `<src>/app`・`<src>/features`・`<src>/shared/{ui,api,lib}`。
   * 指定すると、import の別名（`@/` など）に頼らず、解決したパスで層の境界を確かめる。
   * 例: `{ app: 'web/pages', features: 'web/features', shared: { ui: 'web/app/ui', api: 'web/app/api', lib: 'web/app/lib' } }`
   */
  layers?: BugyoLayers;
  /** useEffect を書いてよい場所。既定は `layers.shared.lib`（`<src>/shared/lib`） */
  effectHooksDir?: string;
  /** fetch を呼んでよい場所。既定は `layers.shared.api`（`<src>/shared/api`） */
  apiClientDir?: string;
  /** 追加で lint 対象から外すパス */
  ignores?: string[];
  /**
   * 禁止を warn に下げる（off にはできない）。キーは parts に入れた禁止の名前（`comments`・`fetch`・`feature-internals`・`model-layers`、
   * @bugyo/lint-react の `use-effect`・`ui-timers`・`model-react`、defineBan で作った禁止の name）か、設定にあるルール ID。
   * 禁止の名前で下げたものは、ルール ID が `bugyo-warn/<元のルール>`（例: `bugyo-warn/no-restricted-imports`）になる。
   * 知らない名前を渡すと断る。
   */
  severity?: Record<string, 'warn'>;
}

export function bugyo(options: BugyoOptions): Linter.Config[];

/** 禁止の名前で warn に下げたルールの置き場所（プラグインの名前）。`bugyo-warn` */
export const warnPlugin: string;
