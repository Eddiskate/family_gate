import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AddBonusBody, UpdateLimitBody } from "@family-gate/shared";
import { env, isAdguardConfigured, isMqttEnabled, isSmtpConfigured } from "./config.js";
import {
  completeTask,
  createGroup,
  createTask,
  deleteGroup,
  deleteTask,
  listDueTasks,
  listGroupsWithTasks,
  updateGroup,
  updateTask,
  type RecurrenceType,
} from "./chores.js";
import { getDb, parseIps, type ClientRow } from "./db.js";
import { isMqttConnected, buildSnapshots, publishChoreStates } from "./mqtt.js";
import { todayInTimezone } from "./time.js";
import {
  addBonusSeconds,
  getWorkerState,
  manualBlock,
  manualUnblock,
  resetTodayUsage,
  setLimitSeconds,
} from "./worker.js";

function unauthorized(reply: FastifyReply) {
  return reply
    .header("WWW-Authenticate", 'Basic realm="Family Gate"')
    .code(401)
    .send({ error: "Unauthorized" });
}

export function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const header = request.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    unauthorized(reply);
    return;
  }
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const password = sep >= 0 ? decoded.slice(sep + 1) : decoded;
    if (password !== env.parentPassword) {
      unauthorized(reply);
      return;
    }
  } catch {
    unauthorized(reply);
    return;
  }
  done();
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", (request, reply, done) => {
    if (!request.url.startsWith("/api")) {
      done();
      return;
    }
    // status can be used for health without auth optionally — keep auth for all api
    authHook(request, reply, done);
  });

  app.get("/api/status", async () => {
    const worker = getWorkerState();
    return {
      ok: true,
      timezone: env.timezone,
      today: todayInTimezone(),
      worker: {
        running: worker.running,
        lastPollAt: worker.lastPollAt,
        lastError: worker.lastError,
        pollIntervalSec: worker.pollIntervalSec,
        idleTimeoutSec: worker.idleTimeoutSec,
      },
      adguard: {
        configured: isAdguardConfigured(),
        url: env.adguard.url,
      },
      mqtt: {
        enabled: isMqttEnabled(),
        connected: isMqttConnected(),
      },
      smtp: {
        configured: isSmtpConfigured(),
      },
      chores: {
        dueCount: listDueTasks().length,
      },
    };
  });

  app.get("/api/clients", async () => {
    const rows = getDb()
      .prepare("SELECT * FROM clients ORDER BY id")
      .all() as ClientRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      adguardName: r.adguard_name,
      ips: parseIps(r.ips),
      active: r.active === 1,
    }));
  });

  app.get("/api/services", async () => {
    const rows = getDb()
      .prepare("SELECT * FROM services ORDER BY name")
      .all() as Array<{ id: string; name: string; domain_patterns: string }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      domainPatterns: JSON.parse(r.domain_patterns) as string[],
    }));
  });

  app.get("/api/usage/today", async () => {
    return buildSnapshots().map((s) => ({
      clientId: s.clientId,
      clientName: s.clientName,
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      usedSeconds: s.usedSeconds,
      dailyLimitSeconds: s.dailyLimitSeconds,
      bonusSeconds: s.bonusSeconds,
      effectiveLimitSeconds: s.effectiveLimitSeconds,
      remainingSeconds: s.remainingSeconds,
      blocked: s.blocked,
      forceBlocked: s.forceBlocked,
      activeSession: s.activeSession,
      enabled: s.enabled,
    }));
  });

  app.get<{
    Querystring: { from?: string; to?: string };
  }>("/api/usage/history", async (request) => {
    const from = request.query.from ?? todayInTimezone();
    const to = request.query.to ?? todayInTimezone();
    const rows = getDb()
      .prepare(
        `SELECT
           u.date,
           u.client_id,
           c.name AS client_name,
           u.service_id,
           s.name AS service_name,
           u.used_seconds,
           u.daily_limit_seconds,
           COALESCE(u.bonus_seconds, 0) AS bonus_seconds,
           u.blocked_at
         FROM usage_daily u
         JOIN clients c ON c.id = u.client_id
         JOIN services s ON s.id = u.service_id
         WHERE u.date >= ? AND u.date <= ?
         ORDER BY u.date DESC, c.name, s.name`,
      )
      .all(from, to) as Array<{
      date: string;
      client_id: number;
      client_name: string;
      service_id: string;
      service_name: string;
      used_seconds: number;
      daily_limit_seconds: number;
      bonus_seconds: number;
      blocked_at: string | null;
    }>;

    return rows.map((r) => ({
      date: r.date,
      clientId: r.client_id,
      clientName: r.client_name,
      serviceId: r.service_id,
      serviceName: r.service_name,
      usedSeconds: r.used_seconds,
      dailyLimitSeconds: r.daily_limit_seconds,
      bonusSeconds: r.bonus_seconds,
      blockedAt: r.blocked_at,
    }));
  });

  app.put<{
    Params: { clientId: string; serviceId: string };
    Body: UpdateLimitBody;
  }>("/api/limits/:clientId/:serviceId", async (request, reply) => {
    const clientId = Number(request.params.clientId);
    const { serviceId } = request.params;
    const body = request.body;
    if (!body || typeof body.dailyLimitSeconds !== "number") {
      return reply.code(400).send({ error: "dailyLimitSeconds required" });
    }
    await setLimitSeconds(
      clientId,
      serviceId,
      Math.max(0, Math.floor(body.dailyLimitSeconds)),
      body.enabled,
    );
    return { ok: true };
  });

  app.post<{
    Params: { id: string; service: string };
  }>("/api/clients/:id/services/:service/block", async (request) => {
    await manualBlock(Number(request.params.id), request.params.service);
    return { ok: true };
  });

  app.post<{
    Params: { id: string; service: string };
  }>("/api/clients/:id/services/:service/unblock", async (request) => {
    await manualUnblock(Number(request.params.id), request.params.service);
    return { ok: true };
  });

  app.post<{
    Params: { id: string; service: string };
  }>("/api/clients/:id/services/:service/reset-today", async (request) => {
    await resetTodayUsage(Number(request.params.id), request.params.service);
    return { ok: true };
  });

  app.post<{
    Params: { id: string; service: string };
    Body: AddBonusBody;
  }>("/api/clients/:id/services/:service/bonus", async (request, reply) => {
    const seconds = request.body?.seconds;
    if (typeof seconds !== "number" || seconds <= 0) {
      return reply.code(400).send({ error: "seconds must be > 0" });
    }
    await addBonusSeconds(
      Number(request.params.id),
      request.params.service,
      Math.floor(seconds),
    );
    return { ok: true };
  });

  app.get("/api/chores/due", async () => listDueTasks());

  app.get("/api/chores/groups", async () => listGroupsWithTasks());

  app.post<{
    Body: { name?: string; description?: string; sortOrder?: number };
  }>("/api/chores/groups", async (request, reply) => {
    if (!request.body?.name?.trim()) {
      return reply.code(400).send({ error: "name required" });
    }
    return createGroup({
      name: request.body.name,
      description: request.body.description,
      sortOrder: request.body.sortOrder,
    });
  });

  app.put<{
    Params: { id: string };
    Body: { name?: string; description?: string; sortOrder?: number };
  }>("/api/chores/groups/:id", async (request, reply) => {
    try {
      return updateGroup(Number(request.params.id), request.body ?? {});
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/chores/groups/:id", async (request) => {
    deleteGroup(Number(request.params.id));
    return { ok: true };
  });

  app.post<{
    Body: {
      groupId?: number;
      title?: string;
      notes?: string;
      recurrenceType?: RecurrenceType;
      recurrenceInterval?: number;
      weekday?: number | null;
      nextDueDate?: string | null;
      notifyEmail?: boolean;
      enabled?: boolean;
    };
  }>("/api/chores/tasks", async (request, reply) => {
    const body = request.body;
    if (!body?.groupId || !body.title?.trim() || !body.recurrenceType) {
      return reply.code(400).send({ error: "groupId, title, recurrenceType required" });
    }
    try {
      return createTask({
        groupId: body.groupId,
        title: body.title,
        notes: body.notes,
        recurrenceType: body.recurrenceType,
        recurrenceInterval: body.recurrenceInterval,
        weekday: body.weekday,
        nextDueDate: body.nextDueDate,
        notifyEmail: body.notifyEmail,
        enabled: body.enabled,
      });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      groupId?: number;
      title?: string;
      notes?: string;
      recurrenceType?: RecurrenceType;
      recurrenceInterval?: number;
      weekday?: number | null;
      nextDueDate?: string | null;
      notifyEmail?: boolean;
      enabled?: boolean;
    };
  }>("/api/chores/tasks/:id", async (request, reply) => {
    try {
      return updateTask(Number(request.params.id), request.body ?? {});
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/chores/tasks/:id", async (request) => {
    deleteTask(Number(request.params.id));
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { nextDueDate?: string | null; notes?: string };
  }>("/api/chores/tasks/:id/complete", async (request, reply) => {
    try {
      const task = completeTask(Number(request.params.id), request.body ?? {});
      publishChoreStates();
      return task;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
