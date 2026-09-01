/**
 * The control plane's database.
 *
 * Three audiences share it and they are deliberately kept apart:
 *
 * - **users** are VPN accounts, authenticated from the desktop client
 * - **admins** are you, authenticated from this panel
 * - **nodes** are the VPN servers, authenticated by a service token
 *
 * Admins are a separate table with separate sessions rather than a flag on `users`. A flag
 * means every bug in the user login path is a potential admin login path; separate tables mean
 * the user path has no way to produce an admin session at all.
 */

import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * A required timestamp that defaults to now.
 *
 * Always with a zone: a naive timestamp is a bug waiting for the clocks to change. The column
 * name is a parameter because these are not all called `created_at` — a tunnel session
 * *starts*, an audit entry simply happens — and a helper that renamed them all to `created_at`
 * would make the schema read as if it did not know what it was recording.
 */
const stamp = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Stored lowercased. Postgres compares text case-sensitively, so the application lowercases
     *  on the way in rather than relying on `citext`, which needs an extension. */
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    /**
     * IANA name, e.g. `Asia/Dhaka`. Quota periods are calendar days, weeks and months **in the
     * user's own timezone**, so this decides when their limits reset.
     *
     * Only an admin may change it. A user who could set their own could jump forward a few
     * hours near their daily limit and get an early reset.
     */
    timezone: text("timezone").notNull().default("UTC"),

    /** How many devices may be enrolled at once. One by default; raise it per user. */
    deviceLimit: integer("device_limit").notNull().default(1),

    /** `null` means unlimited. Bytes, counted in both directions together. */
    dailyLimitBytes: bigint("daily_limit_bytes", { mode: "number" }),
    weeklyLimitBytes: bigint("weekly_limit_bytes", { mode: "number" }),
    monthlyLimitBytes: bigint("monthly_limit_bytes", { mode: "number" }),

    /** Set to block. A timestamp rather than a boolean, because *when* is always the next question. */
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockedReason: text("blocked_reason"),

    createdAt: stamp("created_at"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

/**
 * A machine enrolled to an account.
 *
 * `publicKey` is the device's X25519 static key — the same identity the node already
 * authenticates cryptographically. Accounts sit *above* that rather than replacing it: the node
 * still proves it is talking to this exact device, and the control plane says whose it is.
 *
 * The private half never leaves the device and is never sent here.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Hex-encoded X25519 public key. */
    publicKey: text("public_key").notNull(),
    name: text("name").notNull().default(""),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** Set to retire a device without deleting its history. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: stamp("created_at"),
  },
  (t) => [
    // Globally unique, not per user: a key must identify exactly one device, or a node could
    // not tell whose traffic it is carrying.
    uniqueIndex("devices_public_key_key").on(t.publicKey),
    index("devices_user_id_idx").on(t.userId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A logged-in desktop client.
 *
 * Only the hash of the token is stored. A leaked database dump should not hand someone every
 * live session, and there is never a reason for this side to recover the original.
 */
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    createdAt: stamp("created_at"),
  },
  (t) => [
    uniqueIndex("user_sessions_token_hash_key").on(t.tokenHash),
    index("user_sessions_user_id_idx").on(t.userId),
  ],
);

export const admins = pgTable(
  "admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull().default(""),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: stamp("created_at"),
  },
  (t) => [uniqueIndex("admins_email_key").on(t.email)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: stamp("created_at"),
  },
  (t) => [
    uniqueIndex("admin_sessions_token_hash_key").on(t.tokenHash),
    index("admin_sessions_admin_id_idx").on(t.adminId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The VPN servers
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const nodes = pgTable(
  "nodes",
  {
    /** Short stable id, e.g. `vps-dhaka-1`. Chosen by you, not generated. */
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** `host:port` of the data plane. */
    endpoint: text("endpoint").notNull(),
    /** The node's X25519 public key, which clients pin. */
    publicKey: text("public_key").notNull(),
    /** Hashed, like every other credential here. */
    tokenHash: text("token_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: stamp("created_at"),
  },
  // Indexed so a node authenticates with a single lookup rather than a scan. Unique because
  // two nodes sharing a token would make the audit trail meaningless.
  (t) => [uniqueIndex("nodes_token_hash_key").on(t.tokenHash)],
);

/** One tunnel session, for support and abuse investigation rather than for quota. */
export const tunnelSessions = pgTable(
  "tunnel_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    nodeId: text("node_id").references(() => nodes.id, { onDelete: "set null" }),
    assignedIp: text("assigned_ip"),
    bytesUp: bigint("bytes_up", { mode: "number" }).notNull().default(0),
    bytesDown: bigint("bytes_down", { mode: "number" }).notNull().default(0),
    startedAt: stamp("started_at"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("tunnel_sessions_user_id_idx").on(t.userId),
    index("tunnel_sessions_started_at_idx").on(t.startedAt),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Usage
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One row per user per day. This is the only place consumption is stored.
 *
 * Daily, weekly and monthly totals are all derived from it — `date_trunc('week', local_day)`
 * and `date_trunc('month', local_day)` — rather than kept as three separate counters that
 * would silently disagree the first time a flush was lost. Postgres weeks are ISO weeks
 * starting Monday, which is what we want.
 *
 * `localDay` is the date **in the user's own timezone**, computed when the node's usage report
 * is written. Bucketing at write time means every period query afterwards is plain date
 * arithmetic with no timezone maths at all.
 *
 * Held as a `YYYY-MM-DD` string, not a JS `Date`. A `Date` is an instant, and treating a
 * calendar date as an instant is how a report silently shifts by a day for anyone east of
 * UTC.
 */
export const usageDaily = pgTable(
  "usage_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDay: date("local_day", { mode: "string" }).notNull(),
    bytesUp: bigint("bytes_up", { mode: "number" }).notNull().default(0),
    bytesDown: bigint("bytes_down", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A real composite primary key, so the upsert the node performs on every flush has
    // something to conflict on and one user cannot end up with two rows for one day.
    primaryKey({ columns: [t.userId, t.localDay] }),
    // The dashboard asks "everyone, this month" far more often than it asks about one user.
    index("usage_daily_local_day_idx").on(t.localDay),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Operational
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Failed sign-in attempts, for rate limiting.
 *
 * In Postgres rather than Redis: it is a handful of rows per minute at this scale, and one
 * fewer piece of infrastructure to run, secure and pay for. Swap it for Redis when the row
 * count makes that worthwhile, not before.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Email or IP — whatever is being limited. */
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    at: stamp("at"),
  },
  (t) => [index("login_attempts_key_at_idx").on(t.key, t.at)],
);

/**
 * What admins did.
 *
 * Blocking someone, raising a limit or changing a timezone are all decisions someone may need
 * to explain later — including to the user they were done to.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").references(() => admins.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    detail: jsonb("detail"),
    at: stamp("at"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);
