CREATE TYPE "public"."google_connection_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'success', 'error', 'blocked');--> statement-breakpoint
CREATE TABLE "calendar_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_connection" (
	"id" serial PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"encrypted_access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"status" "google_connection_status" DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_connection_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"deleted_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_details" jsonb,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "synced_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"lesson_key" text NOT NULL,
	"google_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD CONSTRAINT "calendar_settings_connection_id_google_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_history" ADD CONSTRAINT "sync_history_connection_id_google_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_event" ADD CONSTRAINT "synced_event_connection_id_google_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_settings_connection_id_uq" ON "calendar_settings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "google_connection_status_idx" ON "google_connection" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_history_connection_started_idx" ON "sync_history" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_history_one_running_uq" ON "sync_history" USING btree ("connection_id") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "synced_event_connection_key_uq" ON "synced_event" USING btree ("connection_id","lesson_key");--> statement-breakpoint
CREATE UNIQUE INDEX "synced_event_google_event_id_uq" ON "synced_event" USING btree ("google_event_id");--> statement-breakpoint
CREATE INDEX "synced_event_starts_at_idx" ON "synced_event" USING btree ("starts_at");