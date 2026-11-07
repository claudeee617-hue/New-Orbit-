DROP VIEW `edge_current`;
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
  AND v.`version` = (SELECT MAX(`version`) FROM `edge_versions` WHERE `edge_id` = e.`id`)
  AND e.`from_id` IN (SELECT `id` FROM `node_current`)
  AND e.`to_id` IN (SELECT `id` FROM `node_current`);
