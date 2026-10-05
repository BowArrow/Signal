CREATE TABLE `growth_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`key` text NOT NULL,
	`ring` text DEFAULT 'outer' NOT NULL,
	`idea` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `growth_channel_product_key` ON `growth_channels` (`product_id`,`key`);--> statement-breakpoint
CREATE TABLE `growth_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`goal` text NOT NULL,
	`result` text,
	`tracked_url` text NOT NULL,
	`started_at` integer,
	`ends_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channel_id`) REFERENCES `growth_channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `growth_plans` (
	`product_id` text PRIMARY KEY NOT NULL,
	`goal` text NOT NULL,
	`last_scheduled_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `growth_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`output` text,
	`error` text,
	`model` text,
	`prompt_version` text,
	`lease` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `growth_tasks_status` ON `growth_tasks` (`status`,`created_at`);