import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** One row per signed-in user. Holds that person's default experience level. */
export const trackerProfilesTable = pgTable("tracker_profiles", {
  userId: text("user_id").primaryKey(),
  /** "any" or one of the levels in apps/api/src/lib/experience.ts */
  experienceLevel: text("experience_level").notNull().default("any"),
  /** Popular companies are followed automatically once, the first time the feed is opened. */
  starterAdded: boolean("starter_added").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Companies a user follows. `source` + `boardToken` say where their jobs are fetched from. */
export const watchlistCompaniesTable = pgTable(
  "tracker_watchlist_companies",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    /** "greenhouse" | "lever" | "ashby" | null (null = nothing to fetch) */
    source: text("source"),
    boardToken: text("board_token"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** "ok" | "error" | null (never checked) */
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    openRoles: integer("open_roles").notNull().default(0),
    /** true = "Following" (shown in the Following tab); false = just part of the browsable catalog. */
    followed: boolean("followed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tracker_watchlist_user_name_idx").on(table.userId, table.name),
  ],
);

export const jobsTable = pgTable(
  "tracker_jobs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    companyInitials: text("company_initials").notNull().default("CO"),
    location: text("location").notNull(),
    /** Human-readable text such as "0–1 years" or "3–5 years". */
    experience: text("experience").notNull().default("Not stated"),
    /** internship | fresher | junior | mid | senior | unspecified */
    experienceLevel: text("experience_level").notNull().default("unspecified"),
    minYears: integer("min_years"),
    maxYears: integer("max_years"),
    batchYear: integer("batch_year"),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
    applicationUrl: text("application_url").notNull(),
    /** manual | demo | greenhouse | lever | ashby */
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    companyId: integer("company_id"),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the job disappeared from the company's board. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    status: text("status").notNull().default("new"),
    /** How sure we are that this is a fresher role (0 when it is not one). */
    fresherMatch: integer("fresher_match").notNull().default(0),
    isSample: boolean("is_sample").notNull().default(false),
    followUpDate: date("follow_up_date", { mode: "string" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("tracker_jobs_user_status_idx").on(table.userId, table.status),
    index("tracker_jobs_user_posted_idx").on(table.userId, table.postedAt),
    index("tracker_jobs_user_level_idx").on(table.userId, table.experienceLevel),
    uniqueIndex("tracker_jobs_user_source_ext_idx").on(table.userId, table.source, table.externalId),
  ],
);

export const alertRulesTable = pgTable(
  "tracker_alert_rules",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    locations: text("locations").array().notNull().default(sql`'{}'::text[]`),
    channels: text("channels").array().notNull().default(sql`'{}'::text[]`),
    experienceLevel: text("experience_level").notNull().default("any"),
    enabled: boolean("enabled").notNull().default(true),
    // Only jobs first seen after this moment are emailed for this rule.
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [index("tracker_alert_rules_user_idx").on(table.userId)],
);
