CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
