import { createRequire } from 'node:module';
import { Language as TsLanguage, Parser, type Tree } from 'web-tree-sitter';
import type { Language } from './types.js';

/** Grammar names shipped by `tree-sitter-wasms`. */
export type Grammar = 'typescript' | 'tsx' | 'javascript' | 'python' | 'java' | 'c' | 'cpp';

const require = createRequire(import.meta.url);
const PARSE_TIMEOUT_MS = 10_000;

let initialised: Promise<void> | undefined;
const grammars = new Map<Grammar, Promise<TsLanguage>>();
const parsers = new Map<Grammar, Parser>();

export function grammarFor(language: Language, path: string): Grammar {
  if (language === 'typescript') return path.toLowerCase().endsWith('.tsx') ? 'tsx' : 'typescript';
  return language;
}

function ensureInit(): Promise<void> {
  initialised ??= Parser.init();
  return initialised;
}

async function loadGrammar(grammar: Grammar): Promise<TsLanguage> {
  let loaded = grammars.get(grammar);
  if (!loaded) {
    const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`);
    loaded = ensureInit().then(() => TsLanguage.load(wasmPath));
    grammars.set(grammar, loaded);
  }
  return loaded;
}

export interface ParsedSource {
  tree: Tree;
  grammar: Grammar;
}

/** Parse source text. Returns undefined if the parser gave up (timeout). Caller must `tree.delete()`. */
export async function parseSource(
  language: Language,
  path: string,
  content: string,
): Promise<ParsedSource | undefined> {
  const grammar = grammarFor(language, path);
  const lang = await loadGrammar(grammar);
  let parser = parsers.get(grammar);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(lang);
    parsers.set(grammar, parser);
  }
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  // Returning true from the progress callback cancels the parse (the tree comes back null).
  const tree = parser.parse(content, null, { progressCallback: () => Date.now() > deadline });
  return tree ? { tree, grammar } : undefined;
}
