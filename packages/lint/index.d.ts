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

export interface BugyoOptions {
  /** eslint.config.js で `import.meta.dirname` を渡す */
  root: string;
  /** ソースのルート。既定は `src` */
  src?: string;
  /** useEffect を書いてよい場所。既定は `<src>/shared/lib` */
  effectHooksDir?: string;
  /** fetch を呼んでよい場所。既定は `<src>/shared/api` */
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
