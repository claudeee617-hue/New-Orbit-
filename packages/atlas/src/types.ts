/** Version of the extraction logic. Bump when extractors change so cached results are discarded. */
export const ATLAS_VERSION = '0.2.0';

export const LANGUAGES = ['typescript', 'javascript', 'python', 'java', 'c', 'cpp'] as const;
export type Language = (typeof LANGUAGES)[number];

export const FILE_CATEGORIES = [
  'source',
  'test',
  'docs',
  'config',
  'build',
  'vendor',
  'generated',
  'asset',
  'other',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** 1-based lines, 0-based columns (tree-sitter convention shifted to 1-based lines). */
export interface SourceLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type SymbolKind =
  'function' | 'method' | 'class' | 'interface' | 'struct' | 'enum' | 'type' | 'namespace';

export interface ExtractedSymbol {
  name: string;
  /** Dotted/qualified name within the file, e.g. `Greeter.hello`. */
  qualifiedName: string;
  kind: SymbolKind;
  location: SourceLocation;
  exported: boolean;
  /** Cyclomatic complexity for functions and methods. */
  complexity?: number;
}

export type ImportKind =
  'static' | 'type' | 'reexport' | 'dynamic' | 'require' | 'include-local' | 'include-system';

/** A local name introduced by an import. `imported` is `*` for a whole module/class, `default` for a default export. */
export interface ImportBinding {
  local: string;
  imported: string;
}

export interface ExtractedImport {
  /** Module specifier exactly as written (`./a`, `os.path`, `a.b.C`, `"x.h"`). */
  specifier: string;
  kind: ImportKind;
  /** Imported names, when the syntax lists them. `*` for wildcard imports. */
  names: string[];
  /** Local names this import creates (aliases, namespaces), used to resolve calls. */
  bindings: ImportBinding[];
  /** Number of leading dots for Python relative imports. */
  relativeLevel: number;
  location: SourceLocation;
  /** Parser confidence that this is a real import of that specifier (0–1). */
  confidence: number;
}

export interface ExtractedCall {
  /** Called name (last segment): `foo` for `foo()` and `a.foo()`. */
  callee: string;
  /** Receiver text for member calls (`a` in `a.foo()`), if simple. */
  receiver?: string;
  /** Qualified name of the enclosing function/method, when there is one. */
  enclosing?: string;
  location: SourceLocation;
}

export interface UnsupportedConstruct {
  construct: string;
  reason: string;
  location: SourceLocation;
}

export interface FileExtraction {
  language: Language;
  lines: number;
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
  calls: ExtractedCall[];
  unsupported: UnsupportedConstruct[];
  /** Syntax errors tree-sitter recovered from. Results for such files are partial. */
  parseErrors: number;
  /** Total cyclomatic complexity of the file (sum over functions + top-level code). */
  complexity: number;
  entryPointReasons: string[];
  /** Java package or C++/other namespace hint, when declared. */
  packageName?: string;
}

export interface ScanConfig {
  /** Glob patterns (relative, POSIX). If set, only matching files are scanned. */
  include?: string[];
  /** Extra exclude globs on top of the defaults. */
  exclude?: string[];
  /** Disable the built-in excludes (node_modules, .git, dist, …). */
  noDefaultExcludes?: boolean;
  maxFiles?: number;
  maxFileBytes?: number;
  maxCommits?: number;
  /** Skip git history indexing entirely. */
  skipGit?: boolean;
  /** Skip call extraction (faster, smaller graph). */
  skipCalls?: boolean;
}

export interface ResolvedScanConfig {
  include: string[];
  exclude: string[];
  noDefaultExcludes: boolean;
  maxFiles: number;
  maxFileBytes: number;
  maxCommits: number;
  skipGit: boolean;
  skipCalls: boolean;
}

export const DEFAULT_SCAN_LIMITS = {
  maxFiles: 50_000,
  maxFileBytes: 1024 * 1024,
  maxCommits: 500,
} as const;

export interface SkippedFile {
  path: string;
  reason:
    'too-large' | 'binary' | 'unreadable' | 'max-files' | 'excluded-symlink' | 'parse-timeout';
}
