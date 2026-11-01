CREATE TABLE `fieldshift_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL UNIQUE,
	`name` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`email_verified` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fieldshift_email_codes` (
	`email` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fieldshift_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `fieldshift_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fieldshift_sessions_user_id_idx` ON `fieldshift_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `fieldshift_sessions_expires_at_idx` ON `fieldshift_sessions` (`expires_at`);
