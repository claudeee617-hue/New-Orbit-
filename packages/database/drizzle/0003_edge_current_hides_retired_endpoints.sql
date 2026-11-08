DROP VIEW `edge_current`;
--> statement-breakpoint
-- An edge is current only while both endpoints are current. Endpoint liveness is checked with
-- primary-key lookups (JOINs), not IN (SELECT ...): the latter was measured at ~12 s for 10k edges.
CREATE VIEW `edge_current` AS
SELECT e.`id` AS `id`, e.`repository_id` AS `repository_id`, e.`type` AS `type`,
       e.`from_id` AS `from_id`, e.`to_id` AS `to_id`,
       v.`version` AS `version`, v.`attrs_json` AS `attrs_json`, v.`confidence` AS `confidence`,
       v.`valid_from_commit` AS `valid_from_commit`, v.`evidence_id` AS `evidence_id`,
       v.`recorded_at` AS `recorded_at`
FROM `edges` e
JOIN `edge_versions` v ON v.`edge_id` = e.`id`
JOIN `node_versions` fv ON fv.`node_id` = e.`from_id` AND fv.`deleted` = 0
  AND fv.`version` = (SELECT MAX(`version`) FROM `node_versions` WHERE `node_id` = e.`from_id`)
JOIN `node_versions` tv ON tv.`node_id` = e.`to_id` AND tv.`deleted` = 0
  AND tv.`version` = (SELECT MAX(`version`) FROM `node_versions` WHERE `node_id` = e.`to_id`)
WHERE v.`deleted` = 0
  AND v.`version` = (SELECT MAX(`version`) FROM `edge_versions` WHERE `edge_id` = e.`id`);
