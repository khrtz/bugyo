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

/** 共通: 厳しい型検査、any・型アサーション・非 null アサーション・待っていない Promise・switch の漏れ、理由のない eslint-disable、コメント、extra の合成。必須 */
export const common: BugyoPart;
/** 構成: app / features/<id> / shared の境界、feature の外からは index.ts だけ、model から ui・api・shared/ui・shared/api への依存の禁止、fetch は apiClientDir だけ */
export const structure: BugyoPart;

/** 禁止が、build のときに受け取る bugyo の設定 */
export interface BugyoContext {
  root: string;
  src: string;
  effectHooksDir: string;
  apiClientDir: string;
  layers: { app: string; features: string; shared: { ui: string; api: string; lib: string } };
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
   * どこで止めるか。`src`（既定。src の下の .ts / .tsx）、`ui`（features の各 feature の ui/）、`model`（各 feature の model/）か、root からの glob
   */
  scope?: string;
  /**
   * どこでは許すか。`effects`（effectHooksDir）、`api`（apiClientDir）、`tests`（src の下の *.test.ts(x)）か、root からの glob
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
  /** どの feature からも使える層。features と app には依存できない */
  shared?: { ui?: string; api?: string; lib?: string };
}

export function resolveLayers(
  src: string,
  layers: BugyoLayers | undefined,
): { app: string; features: string; shared: { ui: string; api: string; lib: string } };

export interface BugyoOptions {
  /** eslint.config.js で `import.meta.dirname` を渡す */
  root: string;
  /** 使う部品。既定は `[common, structure]`。common は必須。React を使うなら @bugyo/lint-react の `react` を足す。順番は結果に影響しない */
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
   * 禁止を warn に下げる（off にはできない）。キーは禁止の名前（`feature-internals`・`fetch`・`model-layers`、
   * @bugyo/lint-react の `use-effect`・`ui-timers`・`model-react`）か、設定にあるルール ID。
   * 禁止の名前で下げたものは、ルール ID が `bugyo-warn/<元のルール>`（例: `bugyo-warn/no-restricted-imports`）になる。
   * 知らない名前を渡すと断る。
   */
  severity?: Record<string, 'warn'>;
  /**
   * 追加の禁止。bugyo の禁止と同じスコープに合成される（上書きしない）。
   * restrictedProperties と restrictedSyntax は、副作用を包む場所（effectHooksDir）とテストでは効かない。
   * 例: Date.now を禁止し、shared/lib の clock だけで使わせる。
   */
  extra?: {
    restrictedImports?: { paths?: RestrictedImportPath[]; patterns?: RestrictedImportPattern[] };
    restrictedGlobals?: RestrictedGlobal[];
    restrictedProperties?: RestrictedProperty[];
    restrictedSyntax?: RestrictedSyntax[];
  };
}

export function bugyo(options: BugyoOptions): Linter.Config[];

/** 禁止の名前で warn に下げたルールの置き場所（プラグインの名前）。`bugyo-warn` */
export const warnPlugin: string;
