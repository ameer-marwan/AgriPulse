CREATE TABLE `fieldshift_workspaces` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);
