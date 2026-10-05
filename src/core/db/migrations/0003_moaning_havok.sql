CREATE TABLE `studio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`kind` text NOT NULL,
	`copy` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL,
	`due_at` integer,
	`destination` text DEFAULT '' NOT NULL,
	`published_url` text,
	`publication_note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `studio_campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_asset_campaign_kind` ON `studio_assets` (`campaign_id`,`kind`);--> statement-breakpoint
CREATE TABLE `studio_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`brief` text NOT NULL,
	`tracked_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `studio_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `studio_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`reference` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_outcome_reference` ON `studio_outcomes` (`product_id`,`reference`);