import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "rate_limited",
  "dead",
  "forbidden",
  "disabled",
])

export const accountTypeEnum = pgEnum("account_type", [
  "individual",
  "business",
  "enterprise",
])

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label"),
  githubToken: text("github_token").notNull(),
  copilotToken: text("copilot_token"),
  copilotTokenExpiresAt: timestamp("copilot_token_expires_at"),
  accountType: accountTypeEnum("account_type").notNull().default("individual"),
  githubUsername: text("github_username"),
  status: accountStatusEnum("status").notNull().default("active"),
  statusMessage: text("status_message"),
  statusUpdatedAt: timestamp("status_updated_at"),
  isPremium: boolean("is_premium").default(false),
  totalRequests: integer("total_requests").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
})

export const requestLogs = pgTable("request_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accounts.id, {
    onDelete: "cascade",
  }),
  endpoint: text("endpoint").notNull(),
  model: text("model"),
  statusCode: integer("status_code"),
  errorType: text("error_type"),
  requestedAt: timestamp("requested_at").defaultNow(),
  durationMs: integer("duration_ms"),
})

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
})
