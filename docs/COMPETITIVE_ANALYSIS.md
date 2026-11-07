# ORBIT — Competitive Analysis

Version: 0.1 · Research date: 2026-11-07

This document separates **verified** findings (fetched and read during Prompt 0) from **unverified** claims (carried over from the original idea notes). ORBIT is not claimed to be unique.

## 1. Verified findings

| Project | What it does (as read from its own page) | Overlap with ORBIT | Gap / note |
|---|---|---|---|
| Serial Studio | Live dashboard for hardware data: plots, gauges, maps, 3D views; session recording/replay and PDF export; Arduino, ESP32, STM32, Raspberry Pi, Teensy; GPL build covers serial/UART, BLE, TCP/UDP/WebSocket/HTTP; JavaScript/Lua frame parsers; has TCP API, gRPC server and an MCP server. Core is GPL-3.0 with commercial Pro features. | FLIGHT RECORDER (telemetry capture, replay, parsing) | The page does not say it ties sessions to git commits, firmware build IDs or CI evidence. That linkage is ORBIT's angle. GPL-3.0 means ORBIT must not copy its code. |
| FlakeRadar (hahaharsh/flakeradar) | CLI and Python API; ingests JUnit/TestNG XML; Wilson-score and pass→fail flip detection (default threshold 0.7); local SQLite history; HTML/JSON reports; failure clustering with optional OpenAI-based suggestions; pytest/Jest listed as planned. | FLARE | Does not relate flaky tests to changed code, coverage or environments. ORBIT should adopt sound statistics but add cross-engine context. |
| cov-diff (panagiotisptr/cov-diff) | GitHub Action reporting coverage of new/changed code in a PR; Go only; MIT. | WITNESS (changed-line coverage) | Single-language. Shows demand exists; ORBIT needs LCOV/Cobertura and clear limitation reporting. |
| MCP TypeScript SDK | Per a 2026 article, current stable v1.27.1 (Feb 2026), with a v2 branch introducing breaking changes. | MCP server | Pin version and re-verify before Prompt 5. |

## 2. Unverified claims (from idea notes)

The idea notes mention these projects. Search during Prompt 0 returned many unrelated repositories with similar names, so none of the following has been confirmed:

- CodeGraph — code graphs, memory, dependency analysis, PR context
- CodeCortex — graph-based retrieval, impact analysis, memory
- Chisel, PatchProof — PR verification tools
- GitHub Code Quality coverage features
- claude-mem, graphify, NVIDIA SkillSpector — trending agent-memory/workflow projects

Action: re-verify each (owner, licence, activity, features) before any public positioning (task DOC-04).

## 3. Honest differentiation

What ORBIT intends to do differently, none of which is proven unique:

1. One data model joining code structure, history, verification evidence, CI reliability, environments and device sessions.
2. A per-change **Change Passport** whose claims all resolve to hashed artifacts.
3. Explicit missing-evidence reporting (e.g. "no hardware session for this build").
4. Local-first, no account, no API key for core features.
5. Embedded telemetry linked to commits and firmware builds (Serial Studio handles capture and visualisation; the commit/build linkage was not found in what we read).

Risks to this positioning: individual engines are each well served by focused tools; a broad platform can be shallow in all five. Mitigation is the vertical-slice delivery plan and publishing narrow, genuinely working capabilities first.

## 4. Licensing and reuse

- Do not copy code or branding from competitors. Serial Studio's core is GPL-3.0; ORBIT targets Apache-2.0, so no code reuse.
- Algorithms such as Wilson intervals are standard and may be implemented independently.
- Format specs (LCOV, Cobertura, JUnit, SARIF) are implemented from public documentation.

## 5. Follow-up research tasks

- Verify the unverified list above.
- Survey existing PR-comment coverage tools for LCOV and Cobertura.
- Survey MCP servers for code intelligence to avoid duplicating tool names/semantics.
- Check name availability (GitHub, npm, domains, trademarks).
