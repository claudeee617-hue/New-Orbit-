-- Custom migration: make every graph table append-only and expose "current state" views.
-- Triggers abort UPDATE/DELETE so history can only grow. Views select each entity's latest
-- non-retired version.
CREATE TRIGGER `repositories_no_update` BEFORE UPDATE ON `repositories`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: repositories is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `repositories_no_delete` BEFORE DELETE ON `repositories`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: repositories is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_no_update` BEFORE UPDATE ON `evidence`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: evidence is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_no_delete` BEFORE DELETE ON `evidence`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: evidence is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_refs_no_update` BEFORE UPDATE ON `evidence_refs`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: evidence_refs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_refs_no_delete` BEFORE DELETE ON `evidence_refs`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: evidence_refs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `nodes_no_update` BEFORE UPDATE ON `nodes`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: nodes is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `nodes_no_delete` BEFORE DELETE ON `nodes`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: nodes is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `node_versions_no_update` BEFORE UPDATE ON `node_versions`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: node_versions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `node_versions_no_delete` BEFORE DELETE ON `node_versions`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: node_versions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `edges_no_update` BEFORE UPDATE ON `edges`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: edges is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `edges_no_delete` BEFORE DELETE ON `edges`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: edges is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `edge_versions_no_update` BEFORE UPDATE ON `edge_versions`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: edge_versions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `edge_versions_no_delete` BEFORE DELETE ON `edge_versions`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: edge_versions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_no_update` BEFORE UPDATE ON `ledger`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: ledger is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `ledger_no_delete` BEFORE DELETE ON `ledger`
BEGIN
  SELECT RAISE(ABORT, 'ORBIT_IMMUTABLE: ledger is append-only');
END;
--> statement-breakpoint
CREATE VIEW `node_current` AS
SELECT n.`id` AS `id`, n.`repository_id` AS `repository_id`, n.`type` AS `type`, n.`key` AS `key`,
       v.`version` AS `version`, v.`attrs_json` AS `attrs_json`,
       v.`valid_from_commit` AS `valid_from_commit`, v.`evidence_id` AS `evidence_id`,
       v.`recorded_at` AS `recorded_at`
FROM `nodes` n
JOIN `node_versions` v ON v.`node_id` = n.`id`
WHERE v.`deleted` = 0
  AND v.`version` = (SELECT MAX(`version`) FROM `node_versions` WHERE `node_id` = n.`id`);
--> statement-breakpoint
CREATE VIEW `edge_current` AS
SELECT e.`id` AS `id`, e.`repository_id` AS `repository_id`, e.`type` AS `type`,
       e.`from_id` AS `from_id`, e.`to_id` AS `to_id`,
       v.`version` AS `version`, v.`attrs_json` AS `attrs_json`, v.`confidence` AS `confidence`,
       v.`valid_from_commit` AS `valid_from_commit`, v.`evidence_id` AS `evidence_id`,
       v.`recorded_at` AS `recorded_at`
FROM `edges` e
JOIN `edge_versions` v ON v.`edge_id` = e.`id`
WHERE v.`deleted` = 0
  AND v.`version` = (SELECT MAX(`version`) FROM `edge_versions` WHERE `edge_id` = e.`id`);
