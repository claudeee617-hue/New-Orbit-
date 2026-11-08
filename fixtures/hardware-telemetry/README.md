# Hardware telemetry fixtures (DEMO)

Every file in this directory is **synthetic demonstration data**. These files were authored as parser and workflow fixtures; they were not captured from a physical ESP32, STM32 or other device.

Use them to test parsing, explicit metric units, caller-supplied threshold rules, watchdog/reset classification, immutable session storage and Change Passport linkage.

Examples:

```bash
node apps/cli/dist/index.js device replay fixtures/hardware-telemetry/esp32-demo.ndjson \
  --units '{"voltage":"V","temperature":"°C","heap_free":"bytes"}' \
  --thresholds '[{"id":"voltage-low","metric":"voltage","min":3.0,"unit":"V","severity":"warning"}]' \
  --demo --out esp32-demo-session.json
```

For persistence, use a repository-local copy of the fixture and provide `--db`, `--repo`, `--repo-root` and `--artifact-path`. ORBIT re-reads the referenced file and checks its SHA-256 before writing telemetry evidence.

No serial connection or device command is provided by these fixtures. The current build advertises physical serial transport as unavailable.
