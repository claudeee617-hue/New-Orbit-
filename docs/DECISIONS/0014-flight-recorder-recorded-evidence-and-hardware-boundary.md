# ADR-0014: FLIGHT RECORDER starts with verified recorded-file evidence

- **Status:** Accepted for the Prompt 9 prototype
- **Date:** 2026-11-08
- **Scope:** FLIGHT RECORDER, telemetry ingestion and evidence storage

## Context

Embedded log formats and hardware transports vary by board, firmware and development host. A permissive live serial implementation would introduce device access, driver, permissions and command-safety concerns before the evidence model and parser contracts have been validated.

## Decision

1. The first FLIGHT RECORDER implementation is recorded-file only: JSON, NDJSON, CSV and key-value logs.
2. Inputs are bounded to 10 MiB and 100,000 records. CSV headers must be unique and each row must match the header width.
3. Parsed events are normalized to a small set of categories (for example `watchdog_reset`, `watchdog`, `reset`, `boot`, `brownout`, `fault`, and `other`). Arbitrary event text and raw log lines are not copied into parsed reports or database attributes.
4. The parser stores the SHA-256 of the exact input bytes. The persistence path re-reads a repository-local artifact, verifies that its real path remains under the selected repository root, and checks its digest before recording evidence.
5. Raw log bytes remain in the user-selected file. SQLite stores the digest, relative path, source metadata and bounded analysis, not the raw log contents.
6. Metric units and threshold rules are caller-supplied. ORBIT does not infer units or universal safe/unsafe thresholds from metric names.
7. Watchdog/reset classifications are heuristic labels, not proof of root cause. Telemetry evidence is observational and is stored as `PARTIAL`.
8. Synthetic samples must be clearly labelled `DEMO`. No synthetic session may be presented as a physical capture.
9. The transport interface currently provides a recorded-file adapter only. Physical USB/serial transport is explicitly unavailable in this build; no device commands or hardware-control capability are exposed.

## Consequences

- Replay and analysis are deterministic and testable without attached hardware.
- Hash verification prevents a session record from silently pointing to different file bytes than were parsed.
- A later serial adapter requires a separate ADR, explicit user approval, read-only protocol design, device/port allowlisting, safe disconnect behaviour and platform-specific tests.
- Live streaming, serial permission UX, board-specific protocol decoding and hardware control remain out of scope.
