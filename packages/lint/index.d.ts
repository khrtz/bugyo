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
