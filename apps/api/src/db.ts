import fs from "node:fs";
import Database from "better-sqlite3";
import { env } from "./config.js";

export type ClientRow = {
  id: number;
  name: string;
  adguard_name: string;
  ips: string;
  active: number;
};

export type ServiceRow = {
  id: string;
  name: string;
  domain_patterns: string;
};

export type LimitRow = {
  client_id: number;
  service_id: string;
  daily_limit_seconds: number;
  enabled: number;
  force_blocked: number;
};

export type UsageDailyRow = {
  client_id: number;
  service_id: string;
  date: string;
  used_seconds: number;
  daily_limit_seconds: number;
  bonus_seconds: number;
  blocked_at: string | null;
};

export type SessionRow = {
  id: number;
  client_id: number;
  service_id: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
};

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

export function initDb(): Database.Database {
  fs.mkdirSync(env.dataDir, { recursive: true });
  db = new Database(env.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      adguard_name TEXT NOT NULL UNIQUE,
      ips TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain_patterns TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS limits (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      daily_limit_seconds INTEGER NOT NULL DEFAULT 3600,
      enabled INTEGER NOT NULL DEFAULT 1,
      force_blocked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, service_id)
    );

    CREATE TABLE IF NOT EXISTS usage_daily (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      used_seconds INTEGER NOT NULL DEFAULT 0,
      daily_limit_seconds INTEGER NOT NULL DEFAULT 0,
      bonus_seconds INTEGER NOT NULL DEFAULT 0,
      blocked_at TEXT,
      PRIMARY KEY (client_id, service_id, date)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES task_groups(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      recurrence_type TEXT NOT NULL,
      recurrence_interval INTEGER NOT NULL DEFAULT 1,
      weekday INTEGER,
      calendar_dates TEXT NOT NULL DEFAULT '[]',
      next_due_date TEXT,
      last_done_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      notify_email INTEGER NOT NULL DEFAULT 0,
      last_notified_date TEXT
    );

    CREATE TABLE IF NOT EXISTS task_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      done_at TEXT NOT NULL,
      previous_due_date TEXT,
      next_due_date TEXT,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_open
      ON sessions(client_id, service_id, ended_at);
    CREATE INDEX IF NOT EXISTS idx_usage_date
      ON usage_daily(date);
    CREATE INDEX IF NOT EXISTS idx_tasks_due
      ON tasks(next_due_date);
  `);

  migrateSchema();
  seedIfEmpty();
  return db;
}

function migrateSchema(): void {
  const usageCols = db.prepare("PRAGMA table_info(usage_daily)").all() as Array<{ name: string }>;
  const usageNames = new Set(usageCols.map((c) => c.name));
  if (!usageNames.has("bonus_seconds")) {
    db.exec(
      "ALTER TABLE usage_daily ADD COLUMN bonus_seconds INTEGER NOT NULL DEFAULT 0",
    );
  }

  const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
  if (taskCols.length > 0) {
    const taskNames = new Set(taskCols.map((c) => c.name));
    if (!taskNames.has("calendar_dates")) {
      db.exec(`ALTER TABLE tasks ADD COLUMN calendar_dates TEXT NOT NULL DEFAULT '[]'`);
    }
  }
}

function seedIfEmpty(): void {
  const count = db.prepare("SELECT COUNT(*) AS c FROM clients").get() as { c: number };
  if (count.c > 0) return;

  const insertService = db.prepare(
    "INSERT INTO services (id, name, domain_patterns) VALUES (?, ?, ?)",
  );
  const insertClient = db.prepare(
    "INSERT INTO clients (name, adguard_name, ips, active) VALUES (?, ?, ?, 1)",
  );
  const insertLimit = db.prepare(
    `INSERT INTO limits (client_id, service_id, daily_limit_seconds, enabled, force_blocked)
     VALUES (?, ?, ?, 1, 0)`,
  );

  const seed = db.transaction(() => {
    insertService.run(
      "youtube",
      "YouTube",
      JSON.stringify([
        "youtube.com",
        "youtu.be",
        "googlevideo.com",
        "ytimg.com",
        "yt3.ggpht.com",
        "youtube-nocookie.com",
        "youtubei.googleapis.com",
      ]),
    );
    insertService.run(
      "netflix",
      "Netflix",
      JSON.stringify([
        "netflix.com",
        "netflix.net",
        "nflxvideo.net",
        "nflximg.net",
        "nflxso.net",
        "nflxext.com",
      ]),
    );
    insertService.run(
      "disneyplus",
      "Disney+",
      JSON.stringify(["disneyplus.com", "disney-plus.net", "bamgrid.com", "dssott.com"]),
    );
    insertService.run(
      "tiktok",
      "TikTok",
      JSON.stringify(["tiktok.com", "tiktokv.com", "musical.ly", "byteoversea.com"]),
    );
    insertService.run(
      "twitch",
      "Twitch",
      JSON.stringify(["twitch.tv", "ttvnw.net", "jtvnw.net"]),
    );

    const igor = insertClient.run(
      "Tv Igor",
      "Tv igor",
      JSON.stringify(["192.168.100.41"]),
    );
    const salon = insertClient.run(
      "TV Salon",
      "TV Salon",
      JSON.stringify(["192.168.100.43"]),
    );

    const hour = 3600;
    for (const serviceId of ["youtube", "netflix"]) {
      insertLimit.run(Number(igor.lastInsertRowid), serviceId, hour);
      insertLimit.run(Number(salon.lastInsertRowid), serviceId, hour);
    }

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "last_reset_date",
      "",
    );
  });

  seed();
}

export function parseIps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parsePatterns(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
