CREATE TABLE `clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`clicked_at` integer NOT NULL,
	`cookie_id` text,
	`ip_hash` text,
	`user_agent` text,
	`referer` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `links`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clicks_link_idx` ON `clicks` (`link_id`);--> statement-breakpoint
CREATE INDEX `clicks_cookie_idx` ON `clicks` (`cookie_id`);--> statement-breakpoint
CREATE INDEX `clicks_clicked_at_idx` ON `clicks` (`clicked_at`);--> statement-breakpoint
CREATE TABLE `communities` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`url` text,
	`description` text,
	`subscribers` integer,
	`monitored` integer DEFAULT false NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`blocked_at` integer,
	`blocked_reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communities_platform_name_idx` ON `communities` (`platform`,`name`);--> statement-breakpoint
CREATE TABLE `community_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`community_id` text NOT NULL,
	`raw_rules` text,
	`raw_sidebar` text,
	`source_url` text,
	`fetched_at` integer,
	`self_promo` text NOT NULL,
	`self_promo_ratio_max_pct` real,
	`flair_required` integer DEFAULT false NOT NULL,
	`flair_value` text,
	`min_account_age_days` integer,
	`min_karma` integer,
	`notes` text,
	`evidence` text,
	`interpreted_by` text,
	`confidence` real,
	`verified` integer DEFAULT false NOT NULL,
	`last_reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_rules_community_idx` ON `community_rules` (`community_id`);--> statement-breakpoint
CREATE TABLE `content_calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`product_id` text,
	`title` text NOT NULL,
	`slug` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`scheduled_for` integer,
	`published_at` integer,
	`body_path` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_calendar_status_idx` ON `content_calendar` (`status`);--> statement-breakpoint
CREATE TABLE `conversions` (
	`id` text PRIMARY KEY NOT NULL,
	`external_order_id` text NOT NULL,
	`processor` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`product_id` text,
	`attributed_publication_id` text,
	`attribution_method` text NOT NULL,
	`attributed_click_id` text,
	`cookie_id` text,
	`raw` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`attributed_publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversions_external_order_idx` ON `conversions` (`external_order_id`);--> statement-breakpoint
CREATE INDEX `conversions_publication_idx` ON `conversions` (`attributed_publication_id`);--> statement-breakpoint
CREATE INDEX `conversions_occurred_at_idx` ON `conversions` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`product_id` text,
	`prompt_version` text NOT NULL,
	`generated_body` text NOT NULL,
	`human_edited_body` text,
	`disclosure_present` integer NOT NULL,
	`product_mentioned` integer NOT NULL,
	`validator_results` text NOT NULL,
	`blocked` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`rejection_reason` text,
	`rejection_note` text,
	`regenerate_note` text,
	`supersedes_draft_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`opportunity_id`) REFERENCES `opportunities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drafts_opportunity_idx` ON `drafts` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `drafts_status_idx` ON `drafts` (`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`run_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`last_error` text,
	`dedupe_key` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_idx` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `links` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`publication_id` text,
	`destination_url` text NOT NULL,
	`utm_source` text NOT NULL,
	`utm_medium` text NOT NULL,
	`utm_campaign` text NOT NULL,
	`utm_content` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `links_publication_idx` ON `links` (`publication_id`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	`upvotes` integer,
	`comments` integer,
	`clicks` integer,
	`raw` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metrics_publication_idx` ON `metrics` (`publication_id`);--> statement-breakpoint
CREATE INDEX `metrics_captured_at_idx` ON `metrics` (`captured_at`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`community_id` text,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`author` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`posted_at` integer,
	`discovered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`comment_count` integer,
	`platform_score` integer,
	`score_contribution` real,
	`score_intent` real,
	`score_fit` real,
	`score_risk` real,
	`score_total` real,
	`score_weights_hash` text,
	`scored_at` integer,
	`matched_product_id` text,
	`score_rationale` text,
	`status` text DEFAULT 'new' NOT NULL,
	`status_reason` text,
	`raw` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunities_source_external_idx` ON `opportunities` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `opportunities_status_idx` ON `opportunities` (`status`);--> statement-breakpoint
CREATE INDEX `opportunities_discovered_idx` ON `opportunities` (`discovered_at`);--> statement-breakpoint
CREATE INDEX `opportunities_score_total_idx` ON `opportunities` (`score_total`);--> statement-breakpoint
CREATE INDEX `opportunities_community_idx` ON `opportunities` (`community_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`positioning` text NOT NULL,
	`target_buyer` text NOT NULL,
	`price_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`proof_points` text NOT NULL,
	`links` text NOT NULL,
	`utm_base` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_key_idx` ON `products` (`key`);--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`source_id` text NOT NULL,
	`community_id` text,
	`platform` text NOT NULL,
	`method` text NOT NULL,
	`external_post_id` text,
	`external_url` text,
	`published_at` integer NOT NULL,
	`link_id` text,
	`posted_body` text NOT NULL,
	`promotional` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `publications_source_idx` ON `publications` (`source_id`);--> statement-breakpoint
CREATE INDEX `publications_community_idx` ON `publications` (`community_id`);--> statement-breakpoint
CREATE INDEX `publications_published_at_idx` ON `publications` (`published_at`);--> statement-breakpoint
CREATE INDEX `publications_platform_idx` ON `publications` (`platform`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`identifier` text NOT NULL,
	`display_name` text NOT NULL,
	`poll_interval_seconds` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`discovered` integer DEFAULT false NOT NULL,
	`discovered_via` text,
	`last_polled_at` integer,
	`last_poll_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_kind_identifier_idx` ON `sources` (`kind`,`identifier`);