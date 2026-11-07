# ADR-0004: tree-sitter for language-aware parsing

Status: Proposed · Date: 2026-11-07

## Context
Regex-only analysis produces unreliable symbols and relationships.

## Decision
Use tree-sitter grammars (TS, JS, Python, Java, C, C++) behind a `LanguageParser` interface. Every extracted relationship stores source location and parser confidence; unsupported constructs are reported explicitly.

## Consequences
Better accuracy, with native/WASM packaging to verify per platform. Call-graph resolution will be partial and labelled as such.
