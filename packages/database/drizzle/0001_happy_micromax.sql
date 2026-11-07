CREATE TABLE `edge_versions` (
	`edge_id` text NOT NULL,
	`version` integer NOT NULL,
	`attrs_json` text NOT NULL,
	`attrs_hash` text NOT NULL,
	`confidence` real,
	`deleted` integer NOT NULL,
	`valid_from_commit` text,
	`evidence_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`edge_id`, `version`),
	FOREIGN KEY (`edge_id`) REFERENCES `edges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `edges` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edges_identity_unique` ON `edges` (`repository_id`,`type`,`from_id`,`to_id`);--> statement-breakpoint
CREATE INDEX `edges_from_idx` ON `edges` (`repository_id`,`from_id`,`type`);--> statement-breakpoint
CREATE INDEX `edges_to_idx` ON `edges` (`repository_id`,`to_id`,`type`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`source` text NOT NULL,
	`source_type` text NOT NULL,
	`timestamp` text,
	`commit_sha` text,
	`location_path` text,
	`location_start_line` integer,
	`location_end_line` integer,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`limitations_json` text NOT NULL,
	`related_entity_ids_json` text NOT NULL,
	`supersedes` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_repo_commit_idx` ON `evidence` (`repository_id`,`commit_sha`);--> statement-breakpoint
CREATE INDEX `evidence_repo_source_type_idx` ON `evidence` (`repository_id`,`source_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_supersedes_unique` ON `evidence` (`supersedes`);--> statement-breakpoint
CREATE TABLE `evidence_refs` (
	`repository_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`evidence_id`, `entity_id`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_refs_entity_idx` ON `evidence_refs` (`repository_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `ledger` (
	`repository_id` text NOT NULL,
	`seq` integer NOT NULL,
	`ts` text NOT NULL,
	`op` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`repository_id`, `seq`),
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `node_versions` (
	`node_id` text NOT NULL,
	`version` integer NOT NULL,
	`attrs_json` text NOT NULL,
	`attrs_hash` text NOT NULL,
	`deleted` integer NOT NULL,
	`valid_from_commit` text,
	`evidence_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`node_id`, `version`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`type` text NOT NULL,
	`key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_identity_unique` ON `nodes` (`repository_id`,`type`,`key`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_key_unique` ON `repositories` (`key`);