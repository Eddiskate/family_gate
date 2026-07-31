import {
  getQueryLog,
  matchService,
  setClientBlockedService,
  type QueryLogItem,
} from "./adguard.js";
import { env, isAdguardConfigured } from "./config.js";
import {
  getDb,
  parseIps,
  parsePatterns,
  type ClientRow,
  type ServiceRow,
} from "./db.js";
import { buildSnapshots, publishUsageStates } from "./mqtt.js";
import { isoNow, todayInTimezone } from "./time.js";

export type WorkerState = {
  running: boolean;
  lastPollAt: string | null;
  lastError: string | null;
  pollIntervalSec: number;
  idleTimeoutSec: number;
};

const state: WorkerState = {
  running: false,
  lastPollAt: null,
  lastError: null,
  pollIntervalSec: env.pollIntervalSec,
  idleTimeoutSec: env.idleTimeoutSec,
};

let timer: NodeJS.Timeout | null = null;
let ticking = false;
/** Per client IP: last seen query timestamp processed (ISO from AdGuard). */
const lastSeenQueryTime = new Map<string, string>();

export function getWorkerState(): WorkerState {
  return { ...state };
}

export function startWorker(): void {
  if (timer) return;
  state.running = true;
  state.pollIntervalSec = env.pollIntervalSec;
  state.idleTimeoutSec = env.idleTimeoutSec;
  console.log(
    `[worker] starting poll=${env.pollIntervalSec}s idle=${env.idleTimeoutSec}s`,
  );
  void tick();
  timer = setInterval(() => void tick(), env.pollIntervalSec * 1000);
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state.running = false;
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await ensureDailyReset();
    if (isAdguardConfigured()) {
      await pollActivity();
    }
    accrueOpenSessions();
    await closeIdleSessions();
    await syncBlocks();
    publishUsageStates(buildSnapshots());
    state.lastPollAt = isoNow();
    state.lastError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.lastError = message;
    console.error("[worker] tick failed", message);
  } finally {
    ticking = false;
  }
}

function loadPatterns(): Map<string, string[]> {
  const services = getDb().prepare("SELECT * FROM services").all() as ServiceRow[];
  const map = new Map<string, string[]>();
  for (const s of services) {
    map.set(s.id, parsePatterns(s.domain_patterns));
  }
  return map;
}

async function pollActivity(): Promise<void> {
  const db = getDb();
  const clients = db
    .prepare("SELECT * FROM clients WHERE active = 1")
    .all() as ClientRow[];
  const patterns = loadPatterns();
  const nowIso = isoNow();
  const date = todayInTimezone();

  for (const client of clients) {
    const ips = parseIps(client.ips);
    for (const ip of ips) {
      const log = await getQueryLog({ search: ip, limit: 200 });
      const items = (log.data ?? []).filter((item) => item.client === ip);
      // AdGuard returns newest first
      const ordered = [...items].reverse();
      if (ordered.length === 0) continue;

      const lastProcessed = lastSeenQueryTime.get(ip);
      // First poll for this IP: only mark watermark, do not backfill historical time
      if (!lastProcessed) {
        lastSeenQueryTime.set(ip, ordered[ordered.length - 1]!.time);
        continue;
      }

      for (const item of ordered) {
        if (item.time <= lastProcessed) continue;
        const domain = item.question?.name;
        if (!domain) continue;
        const serviceId = matchService(domain, patterns);
        if (!serviceId) continue;

        const limit = db
          .prepare(
            "SELECT enabled FROM limits WHERE client_id = ? AND service_id = ?",
          )
          .get(client.id, serviceId) as { enabled: number } | undefined;
        if (!limit || limit.enabled !== 1) continue;

        touchSession(client.id, serviceId, item, nowIso, date);
      }

      lastSeenQueryTime.set(ip, ordered[ordered.length - 1]!.time);
    }
  }
}

function touchSession(
  clientId: number,
  serviceId: string,
  item: QueryLogItem,
  nowIso: string,
  date: string,
): void {
  const db = getDb();
  const open = db
    .prepare(
      `SELECT * FROM sessions
       WHERE client_id = ? AND service_id = ? AND ended_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(clientId, serviceId) as
    | { id: number; last_seen_at: string; started_at: string }
    | undefined;

  const seenAt = item.time || nowIso;

  if (!open) {
    db.prepare(
      `INSERT INTO sessions (client_id, service_id, started_at, last_seen_at, ended_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(clientId, serviceId, seenAt, seenAt);
    ensureUsageRow(clientId, serviceId, date);
    return;
  }

  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(
    seenAt,
    open.id,
  );
}

/** Credit poll interval for sessions that are still within idle window. */
function accrueOpenSessions(): void {
  const db = getDb();
  const date = todayInTimezone();
  const now = Date.now();
  const open = db
    .prepare("SELECT * FROM sessions WHERE ended_at IS NULL")
    .all() as Array<{
    id: number;
    client_id: number;
    service_id: string;
    last_seen_at: string;
  }>;

  for (const session of open) {
    const last = Date.parse(session.last_seen_at);
    if (!Number.isFinite(last)) continue;
    if (now - last >= env.idleTimeoutSec * 1000) continue;

    ensureUsageRow(session.client_id, session.service_id, date);
    db.prepare(
      `UPDATE usage_daily
       SET used_seconds = used_seconds + ?
       WHERE client_id = ? AND service_id = ? AND date = ?`,
    ).run(env.pollIntervalSec, session.client_id, session.service_id, date);
  }
}

function ensureUsageRow(clientId: number, serviceId: string, date: string): void {
  const db = getDb();
  const limit = db
    .prepare(
      "SELECT daily_limit_seconds FROM limits WHERE client_id = ? AND service_id = ?",
    )
    .get(clientId, serviceId) as { daily_limit_seconds: number } | undefined;

  db.prepare(
    `INSERT INTO usage_daily (client_id, service_id, date, used_seconds, daily_limit_seconds, bonus_seconds, blocked_at)
     VALUES (?, ?, ?, 0, ?, 0, NULL)
     ON CONFLICT(client_id, service_id, date) DO NOTHING`,
  ).run(clientId, serviceId, date, limit?.daily_limit_seconds ?? 0);
}

async function closeIdleSessions(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const open = db
    .prepare("SELECT * FROM sessions WHERE ended_at IS NULL")
    .all() as Array<{
    id: number;
    last_seen_at: string;
  }>;

  const endIso = isoNow();
  for (const session of open) {
    const last = Date.parse(session.last_seen_at);
    if (!Number.isFinite(last)) continue;
    if (now - last >= env.idleTimeoutSec * 1000) {
      db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(
        endIso,
        session.id,
      );
    }
  }
}

async function syncBlocks(): Promise<void> {
  if (!isAdguardConfigured()) return;

  const db = getDb();
  const date = todayInTimezone();
  const rows = db
    .prepare(
      `SELECT
         c.id AS client_id,
         c.adguard_name,
         l.service_id,
         l.daily_limit_seconds,
         l.enabled,
         l.force_blocked,
         COALESCE(u.used_seconds, 0) AS used_seconds,
         COALESCE(u.bonus_seconds, 0) AS bonus_seconds,
         u.blocked_at
       FROM clients c
       JOIN limits l ON l.client_id = c.id
       LEFT JOIN usage_daily u
         ON u.client_id = c.id AND u.service_id = l.service_id AND u.date = ?
       WHERE c.active = 1`,
    )
    .all(date) as Array<{
    client_id: number;
    adguard_name: string;
    service_id: string;
    daily_limit_seconds: number;
    enabled: number;
    force_blocked: number;
    used_seconds: number;
    bonus_seconds: number;
    blocked_at: string | null;
  }>;

  for (const row of rows) {
    const effectiveLimit = row.daily_limit_seconds + row.bonus_seconds;
    const shouldBlock =
      row.force_blocked === 1 ||
      (row.enabled === 1 && row.used_seconds >= effectiveLimit);

    try {
      await setClientBlockedService(row.adguard_name, row.service_id, shouldBlock);
      if (shouldBlock && !row.blocked_at) {
        ensureUsageRow(row.client_id, row.service_id, date);
        db.prepare(
          `UPDATE usage_daily SET blocked_at = ?
           WHERE client_id = ? AND service_id = ? AND date = ? AND blocked_at IS NULL`,
        ).run(isoNow(), row.client_id, row.service_id, date);
      }
      if (!shouldBlock && row.blocked_at) {
        db.prepare(
          `UPDATE usage_daily SET blocked_at = NULL
           WHERE client_id = ? AND service_id = ? AND date = ?`,
        ).run(row.client_id, row.service_id, date);
      }
    } catch (err) {
      console.error(
        `[worker] block sync failed ${row.adguard_name}/${row.service_id}`,
        err,
      );
    }
  }
}

async function ensureDailyReset(): Promise<void> {
  const db = getDb();
  const today = todayInTimezone();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'last_reset_date'")
    .get() as { value: string } | undefined;
  const last = row?.value ?? "";

  if (last === today) return;

  console.log(`[worker] daily reset: ${last || "(none)"} → ${today}`);

  // Close open sessions at day boundary
  db.prepare(
    "UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL",
  ).run(isoNow());

  // Ensure today's usage rows exist with current limits (archive is previous days in usage_daily)
  const limits = db
    .prepare(
      `SELECT client_id, service_id, daily_limit_seconds FROM limits WHERE enabled = 1`,
    )
    .all() as Array<{
    client_id: number;
    service_id: string;
    daily_limit_seconds: number;
  }>;

  const insert = db.prepare(
    `INSERT INTO usage_daily (client_id, service_id, date, used_seconds, daily_limit_seconds, bonus_seconds, blocked_at)
     VALUES (?, ?, ?, 0, ?, 0, NULL)
     ON CONFLICT(client_id, service_id, date) DO NOTHING`,
  );

  const tx = db.transaction(() => {
    for (const l of limits) {
      insert.run(l.client_id, l.service_id, today, l.daily_limit_seconds);
    }
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('last_reset_date', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(today);
  });
  tx();

  // Unblock services that were only blocked by daily limit (not force_blocked)
  if (isAdguardConfigured()) {
    const clients = db
      .prepare(
        `SELECT c.adguard_name, l.service_id, l.force_blocked
         FROM clients c
         JOIN limits l ON l.client_id = c.id
         WHERE c.active = 1`,
      )
      .all() as Array<{
      adguard_name: string;
      service_id: string;
      force_blocked: number;
    }>;

    for (const c of clients) {
      if (c.force_blocked === 1) continue;
      try {
        await setClientBlockedService(c.adguard_name, c.service_id, false);
      } catch (err) {
        console.error("[worker] daily unblock failed", c, err);
      }
    }
  }
}

export async function setForceBlocked(
  clientId: number,
  serviceId: string,
  forceBlocked: boolean,
): Promise<void> {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE limits SET force_blocked = ? WHERE client_id = ? AND service_id = ?`,
    )
    .run(forceBlocked ? 1 : 0, clientId, serviceId);
  if (info.changes === 0) {
    throw new Error("Limit not found");
  }
  await syncBlocks();
  publishUsageStates(buildSnapshots());
}

export async function setLimitSeconds(
  clientId: number,
  serviceId: string,
  dailyLimitSeconds: number,
  enabled?: boolean,
): Promise<void> {
  const db = getDb();
  const date = todayInTimezone();
  if (enabled === undefined) {
    db.prepare(
      `UPDATE limits SET daily_limit_seconds = ? WHERE client_id = ? AND service_id = ?`,
    ).run(dailyLimitSeconds, clientId, serviceId);
  } else {
    db.prepare(
      `UPDATE limits SET daily_limit_seconds = ?, enabled = ? WHERE client_id = ? AND service_id = ?`,
    ).run(dailyLimitSeconds, enabled ? 1 : 0, clientId, serviceId);
  }

  db.prepare(
    `UPDATE usage_daily SET daily_limit_seconds = ?
     WHERE client_id = ? AND service_id = ? AND date = ?`,
  ).run(dailyLimitSeconds, clientId, serviceId, date);

  await syncBlocks();
  publishUsageStates(buildSnapshots());
}

export async function addBonusSeconds(
  clientId: number,
  serviceId: string,
  seconds: number,
): Promise<void> {
  const amount = Math.max(0, Math.floor(seconds));
  if (amount <= 0) {
    throw new Error("seconds must be > 0");
  }

  const db = getDb();
  const date = todayInTimezone();
  ensureUsageRow(clientId, serviceId, date);

  db.prepare(
    `UPDATE usage_daily
     SET bonus_seconds = bonus_seconds + ?, blocked_at = NULL
     WHERE client_id = ? AND service_id = ? AND date = ?`,
  ).run(amount, clientId, serviceId, date);

  // clear force block so bonus can actually unlock watching
  db.prepare(
    `UPDATE limits SET force_blocked = 0 WHERE client_id = ? AND service_id = ?`,
  ).run(clientId, serviceId);

  await syncBlocks();
  publishUsageStates(buildSnapshots());
}

export async function resetTodayUsage(
  clientId: number,
  serviceId: string,
): Promise<void> {
  const db = getDb();
  const date = todayInTimezone();
  ensureUsageRow(clientId, serviceId, date);
  db.prepare(
    `UPDATE usage_daily SET used_seconds = 0, bonus_seconds = 0, blocked_at = NULL
     WHERE client_id = ? AND service_id = ? AND date = ?`,
  ).run(clientId, serviceId, date);

  // also clear force block so child can watch again
  db.prepare(
    `UPDATE limits SET force_blocked = 0 WHERE client_id = ? AND service_id = ?`,
  ).run(clientId, serviceId);

  await syncBlocks();
  publishUsageStates(buildSnapshots());
}

/** Manual block = force_blocked true */
export async function manualBlock(
  clientId: number,
  serviceId: string,
): Promise<void> {
  await setForceBlocked(clientId, serviceId, true);
}

/** Manual unblock = clear force + if under limit, sync will unblock */
export async function manualUnblock(
  clientId: number,
  serviceId: string,
): Promise<void> {
  await setForceBlocked(clientId, serviceId, false);
}
