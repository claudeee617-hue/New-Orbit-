# ADR-0011: ATLAS scanning model

Status: Accepted · Date: 2026-11-08

## Context
ATLAS must understand an unfamiliar repository without running its code, preserve source locations and confidence for every relationship, scale to large repositories, and be honest about what it could not analyse.

## Decision
1. **Read-only and non-executing.** ATLAS only reads files and runs fixed, read-only `git` commands (`rev-parse`, `log`) via `execFile` with external-program config neutralised. Symlinks are never followed. It never writes into the scanned repository; the extraction cache lives next to the workspace database.
2. **Parsing.** Language-aware extraction walks tree-sitter syntax trees (ADR-0004). Text patterns are used only for non-code build manifests (requirements.txt, pyproject.toml, pom.xml, build.gradle, CMakeLists.txt), and that is stated as a limitation. `package.json` is parsed as JSON.
3. **Graph mapping.** Files → `File`; functions/methods → `Function`; classes/interfaces/structs/enums → `Class`; type aliases/namespaces → `Symbol`; directories and package roots → `Module`; test files → `Test` (+ a `File`); declared and observed external packages → `Dependency`; the repository summary → `Repository`; commits → `Commit`. Relationships: `IMPORTS` (File → File/Module/Dependency), `CALLS` (callable → callable), `DEPENDS_ON` (Module → Module/Dependency, aggregated), `TESTS` (Test → File), `MODIFIES` (Commit → File). Every node and edge has `producer: "atlas"` so ATLAS only retires its own facts.
4. **Confidence.** Edge confidence = parser confidence × resolution confidence. Examples: static import to an exactly matching file 1.0; extension/index probing 0.95; workspace package 0.9; Python third-party-or-stdlib 0.6; C include found by unique file name 0.5; call resolved in the same file 0.9, via an imported name 0.8, by unique exported name in the repository 0.4 (marked `heuristic`). Unresolvable relationships are not stored; they are counted and listed.
5. **Locations.** Each edge keeps up to 10 source locations (path, line, column range); each symbol keeps its range.
6. **Unsupported constructs are reported, never guessed:** dynamic `import()`/`require()`/`__import__`/`importlib` with non-literal arguments, `eval`/`exec`/`new Function`, wildcard imports, C/C++ macros and conditional compilation, computed includes, syntax errors (with partial results flagged), deep nesting.
7. **Evidence.** Each scan writes one `parser` evidence record (status PARTIAL whenever any limitation applies, INCOMPLETE when nothing could be parsed, PASS only when nothing was skipped, unsupported or unmeasured). Git indexing writes a separate `git` evidence record. Identical input produces identical evidence, so unchanged scans write nothing.
8. **Incrementality.** Per-file extraction is cached by content hash (+ ATLAS version + call setting). The graph write is idempotent (unchanged facts are no-ops), atomic (one transaction), and reconciles: ATLAS facts no longer observed are retired (tombstoned) and can be revived. Commits are history and are never retired. The cache is only an optimisation; deleting it changes nothing but speed.
9. **Analysis definitions.** Cycles use iterative Tarjan SCC (no recursion limit); runtime cycles exclude `import type` edges, which are reported separately. Hotspot score = cyclomatic complexity × max(churn, 1), with both inputs reported; churn is commits in the indexed window. Ownership is commit share per author name (no emails stored), not surviving lines. Entry points come from `package.json` main/module/bin/exports, shebangs, Python `__main__` guards, Java `public static void main`, and C/C++ `main`.

## Update 2026-11-10 (ATLAS 0.2.0)
- Imports record **bindings** (local name to imported name): aliases, namespace imports, default imports, destructured `require`, Python `import x as y` / `from x import a as b`, Java class imports. Calls like `h()` (alias), `ns.fn()` and `Util.twice()` (Java) now resolve through them at confidence 0.8.
- Python standard-library modules are recognised from a list generated from Python 3.13 `sys.stdlib_module_names` and recorded as `python-stdlib:<name>` dependencies; everything else not in the repository is assumed third-party at 0.6.
- Git is read with `core.quotepath=false` so non-ASCII file names are not mangled.

## Consequences
- Call graphs are partial by design (no type information); the 0.4/0.3 heuristics can be wrong and are labelled.
- Path aliases (tsconfig `paths`), C include paths from build systems, and Python stdlib vs third-party are not resolved without further inputs.
- Renames are not followed in git history.
- Scan speed (measured here, synthetic repo of 3000 TypeScript files, 9000 imports, 18000 calls, no git): about 16 s first scan, about 8 s when nothing changed; the ORBIT repo itself (59 files) takes about 4 s then about 1 s. Graph writes dominate; there is room to batch them.
