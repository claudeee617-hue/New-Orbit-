# ADR-0004: tree-sitter for language-aware parsing

Status: Accepted · Date: 2026-11-08

## Context
Regex-only analysis produces unreliable symbols and relationships.

## Decision
Use tree-sitter grammars (TS, JS, Python, Java, C, C++) behind a `LanguageParser` interface. Every extracted relationship stores source location and parser confidence; unsupported constructs are reported explicitly.

## Consequences
Better accuracy, with native/WASM packaging to verify per platform. Call-graph resolution will be partial and labelled as such.

## Update (Prompt 4)
Implemented with **web-tree-sitter 0.25.10 (WASM) + tree-sitter-wasms 0.1.13**, not the native `tree-sitter` bindings. Verified here: all six grammars (TypeScript/TSX, JavaScript, Python, Java, C, C++) load and parse with no native compilation, so installs work wherever Node runs (the native route needs node-gyp and Node headers, which failed in this environment, see ADR-0008). Grammar ABI is 14. The newer web-tree-sitter 0.27.x was not tested against these grammars and is not used.
`setTimeoutMicros` is deprecated and threw in 0.25.10, so parse time limits use the `progressCallback` deadline (10 s per file).
