CREATE TABLE `engineering_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_request_unique` ON `engineering_requests` (`product_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `marketing_cash` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_cash_reference` ON `marketing_cash` (`product_id`,`reference`);--> statement-breakpoint
CREATE TABLE `marketing_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_commitment_reference` ON `marketing_commitments` (`product_id`,`reference`);--> statement-breakpoint
CREATE TABLE `marketing_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`value` text NOT NULL,
	`published_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketing_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`relation` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_id`) REFERENCES `marketing_memory`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `marketing_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_edge_unique` ON `marketing_edges` (`from_id`,`to_id`,`relation`);--> statement-breakpoint
CREATE TABLE `marketing_media` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`prompt_id` text,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`base_url` text NOT NULL,
	`workflow_hash` text NOT NULL,
	`error` text,
	`outputs` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`) REFERENCES `marketing_workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketing_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`supersedes_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `marketing_memory_product` ON `marketing_memory` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `marketing_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`task_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketing_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `marketing_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`workflow` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
