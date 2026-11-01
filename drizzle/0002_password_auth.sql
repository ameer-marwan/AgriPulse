ALTER TABLE `fieldshift_users` ADD `username` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `fieldshift_users` ADD `password_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `fieldshift_users` ADD `password_salt` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `fieldshift_login_attempts` (
	`email` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt` integer NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL
);
