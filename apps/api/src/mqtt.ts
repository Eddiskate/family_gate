import type { MqttClient } from "mqtt";
import mqtt from "mqtt";
import { completeTask, listDueTasks, listGroupsWithTasks, type TaskDto } from "./chores.js";
import { env, isMqttEnabled } from "./config.js";
import { getDb, type ClientRow } from "./db.js";
import { slugify, todayInTimezone } from "./time.js";

export type UsageSnapshot = {
  clientId: number;
  clientName: string;
  clientSlug: string;
  serviceId: string;
  serviceName: string;
  usedSeconds: number;
  dailyLimitSeconds: number;
  bonusSeconds: number;
  effectiveLimitSeconds: number;
  remainingSeconds: number;
  blocked: boolean;
  forceBlocked: boolean;
  enabled: boolean;
  activeSession: boolean;
};

type HaCallbacks = {
  setForceBlocked: (
    clientId: number,
    serviceId: string,
    forceBlocked: boolean,
  ) => Promise<void>;
  setLimitMinutes: (
    clientId: number,
    serviceId: string,
    minutes: number,
  ) => Promise<void>;
  addBonusMinutes: (
    clientId: number,
    serviceId: string,
    minutes: number,
  ) => Promise<void>;
};

let client: MqttClient | null = null;
let connected = false;
let callbacks: HaCallbacks | null = null;
const discovered = new Set<string>();

export function isMqttConnected(): boolean {
  return connected;
}

export async function startMqtt(cbs: HaCallbacks): Promise<void> {
  callbacks = cbs;
  if (!isMqttEnabled()) {
    console.log("[mqtt] disabled (MQTT_URL empty)");
    return;
  }

  client = mqtt.connect(env.mqtt.url, {
    username: env.mqtt.user || undefined,
    password: env.mqtt.password || undefined,
    reconnectPeriod: 5000,
    clientId: `family_gate_${Math.random().toString(16).slice(2, 8)}`,
  });

  client.on("connect", () => {
    connected = true;
    discovered.clear();
    console.log("[mqtt] connected");
    void publishDiscoveryAll();
    publishUsageStates(buildSnapshots());
    publishChoreStates();
    client?.subscribe(`${env.mqtt.baseTopic}/+/+/set/#`);
    client?.subscribe(`${env.mqtt.baseTopic}/chores/+/set/#`);
  });

  client.on("reconnect", () => {
    console.log("[mqtt] reconnecting…");
  });

  client.on("close", () => {
    connected = false;
  });

  client.on("error", (err) => {
    console.error("[mqtt] error", err.message);
  });

  client.on("message", (topic, payload) => {
    void handleCommand(topic, payload.toString());
  });
}

export async function stopMqtt(): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve) => {
    client?.end(false, {}, () => resolve());
  });
  client = null;
  connected = false;
}

function deviceId(clientSlug: string): string {
  return `family_gate_${clientSlug}`;
}

function entityBase(clientSlug: string, serviceId: string): string {
  return `${clientSlug}_${serviceId}`;
}

function choresDevice() {
  return {
    identifiers: ["family_gate_chores"],
    name: "Family Gate Zadania",
    manufacturer: "Family Gate",
    model: "Household chores",
  };
}

async function publishDiscoveryAll(): Promise<void> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.*, l.service_id, l.daily_limit_seconds, l.enabled, l.force_blocked, s.name AS service_name
       FROM clients c
       JOIN limits l ON l.client_id = c.id
       JOIN services s ON s.id = l.service_id
       WHERE c.active = 1`,
    )
    .all() as Array<
    ClientRow & {
      service_id: string;
      daily_limit_seconds: number;
      enabled: number;
      force_blocked: number;
      service_name: string;
    }
  >;

  for (const row of rows) {
    await publishDiscoveryFor(
      row.name,
      slugify(row.name),
      row.service_id,
      row.service_name,
      row.id,
    );
  }

  publishChoresDiscovery();
}

function publishChoresDiscovery(): void {
  if (!client || !connected) return;
  const prefix = env.mqtt.discoveryPrefix;
  const device = choresDevice();
  const summaryTopic = `${env.mqtt.baseTopic}/chores/summary/state`;

  const summaryEntities = [
    {
      path: "sensor/family_gate_chores_due/config",
      payload: {
        name: "Zadania do zrobienia",
        object_id: "family_gate_chores_due",
        unique_id: "family_gate_chores_due",
        state_topic: summaryTopic,
        value_template: "{{ value_json.due_count }}",
        icon: "mdi:checkbox-marked-outline",
        device,
      },
    },
    {
      path: "sensor/family_gate_chores_overdue/config",
      payload: {
        name: "Zadania zaległe",
        object_id: "family_gate_chores_overdue",
        unique_id: "family_gate_chores_overdue",
        state_topic: summaryTopic,
        value_template: "{{ value_json.overdue_count }}",
        icon: "mdi:alert-circle-outline",
        device,
      },
    },
    {
      path: "binary_sensor/family_gate_chores_any_due/config",
      payload: {
        name: "Są zadania do zrobienia",
        object_id: "family_gate_chores_any_due",
        unique_id: "family_gate_chores_any_due",
        state_topic: summaryTopic,
        value_template: "{{ value_json.any_due }}",
        payload_on: "true",
        payload_off: "false",
        device_class: "problem",
        device,
      },
    },
  ];

  for (const s of summaryEntities) {
    const key = `chores:${s.path}`;
    if (discovered.has(key)) continue;
    client.publish(`${prefix}/${s.path}`, JSON.stringify(s.payload), {
      retain: true,
      qos: 1,
    });
    discovered.add(key);
  }

  const tasks = listGroupsWithTasks().flatMap((g) => g.tasks);
  for (const task of tasks) {
    publishTaskDiscovery(task);
  }
}

function publishTaskDiscovery(task: TaskDto): void {
  if (!client || !connected) return;
  const key = `chore_task_${task.id}`;
  if (discovered.has(key)) return;

  const prefix = env.mqtt.discoveryPrefix;
  const device = choresDevice();
  const stateTopic = `${env.mqtt.baseTopic}/chores/task_${task.id}/state`;
  const objectBase = `chore_${task.id}_${slugify(task.title)}`;

  const entities = [
    {
      path: `binary_sensor/${objectBase}_due/config`,
      payload: {
        name: `${task.groupName}: ${task.title}`,
        object_id: `${objectBase}_due`,
        unique_id: `family_gate_${objectBase}_due`,
        state_topic: stateTopic,
        value_template: "{{ value_json.needs_action }}",
        payload_on: "true",
        payload_off: "false",
        device_class: "problem",
        device,
      },
    },
    {
      path: `sensor/${objectBase}_next_due/config`,
      payload: {
        name: `${task.groupName}: ${task.title} termin`,
        object_id: `${objectBase}_next_due`,
        unique_id: `family_gate_${objectBase}_next_due`,
        state_topic: stateTopic,
        value_template: "{{ value_json.next_due_date }}",
        icon: "mdi:calendar",
        device,
      },
    },
    {
      path: `sensor/${objectBase}_status/config`,
      payload: {
        name: `${task.groupName}: ${task.title} status`,
        object_id: `${objectBase}_status`,
        unique_id: `family_gate_${objectBase}_status`,
        state_topic: stateTopic,
        value_template: "{{ value_json.status }}",
        icon: "mdi:list-status",
        device,
      },
    },
    {
      path: `button/${objectBase}_complete/config`,
      payload: {
        name: `${task.groupName}: ${task.title} wykonano`,
        object_id: `${objectBase}_complete`,
        unique_id: `family_gate_${objectBase}_complete`,
        command_topic: `${env.mqtt.baseTopic}/chores/task_${task.id}/set/complete`,
        payload_press: "PRESS",
        icon: "mdi:check-circle-outline",
        device,
      },
    },
  ];

  for (const s of entities) {
    client.publish(`${prefix}/${s.path}`, JSON.stringify(s.payload), {
      retain: true,
      qos: 1,
    });
  }
  discovered.add(key);
}

export function publishChoreStates(): void {
  if (!client || !connected) return;

  // ensure discovery for any new tasks
  publishChoresDiscovery();

  const groups = listGroupsWithTasks();
  const tasks = groups.flatMap((g) => g.tasks);
  const due = listDueTasks();
  const overdueCount = due.filter((t) => t.status === "overdue").length;

  client.publish(
    `${env.mqtt.baseTopic}/chores/summary/state`,
    JSON.stringify({
      due_count: due.length,
      overdue_count: overdueCount,
      any_due: due.length > 0 ? "true" : "false",
      today: todayInTimezone(),
    }),
    { retain: true, qos: 0 },
  );

  for (const task of tasks) {
    const needsAction = task.status === "overdue" || task.status === "due_today";
    client.publish(
      `${env.mqtt.baseTopic}/chores/task_${task.id}/state`,
      JSON.stringify({
        id: task.id,
        title: task.title,
        group: task.groupName,
        status: task.status,
        next_due_date: task.nextDueDate ?? "",
        needs_action: needsAction ? "true" : "false",
        enabled: task.enabled ? "true" : "false",
      }),
      { retain: true, qos: 0 },
    );
  }
}

async function publishDiscoveryFor(
  clientName: string,
  clientSlug: string,
  serviceId: string,
  serviceName: string,
  clientId: number,
): Promise<void> {
  if (!client || !connected) return;

  const base = entityBase(clientSlug, serviceId);
  const key = base;
  if (discovered.has(key)) return;

  const device = {
    identifiers: [deviceId(clientSlug)],
    name: `Family Gate ${clientName}`,
    manufacturer: "Family Gate",
    model: "TV Parental Control",
  };

  const stateTopic = `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/state`;
  const prefix = env.mqtt.discoveryPrefix;

  const sensors = [
    {
      path: `sensor/${base}_remaining/config`,
      payload: {
        name: `${clientName} ${serviceName} remaining`,
        object_id: `${base}_remaining`,
        unique_id: `family_gate_${base}_remaining`,
        state_topic: stateTopic,
        value_template: "{{ value_json.remaining_minutes }}",
        unit_of_measurement: "min",
        icon: "mdi:timer-outline",
        device,
      },
    },
    {
      path: `sensor/${base}_used/config`,
      payload: {
        name: `${clientName} ${serviceName} used`,
        object_id: `${base}_used`,
        unique_id: `family_gate_${base}_used`,
        state_topic: stateTopic,
        value_template: "{{ value_json.used_minutes }}",
        unit_of_measurement: "min",
        icon: "mdi:timer",
        device,
      },
    },
    {
      path: `binary_sensor/${base}_blocked/config`,
      payload: {
        name: `${clientName} ${serviceName} blocked`,
        object_id: `${base}_blocked`,
        unique_id: `family_gate_${base}_blocked`,
        state_topic: stateTopic,
        value_template: "{{ value_json.blocked }}",
        payload_on: "true",
        payload_off: "false",
        device_class: "problem",
        device,
      },
    },
    {
      path: `switch/${base}/config`,
      payload: {
        name: `${clientName} ${serviceName}`,
        object_id: base,
        unique_id: `family_gate_${base}_switch`,
        state_topic: stateTopic,
        value_template: "{{ value_json.allowed }}",
        command_topic: `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/set/switch`,
        payload_on: "ON",
        payload_off: "OFF",
        state_on: "true",
        state_off: "false",
        icon: "mdi:television",
        device,
      },
    },
    {
      path: `number/${base}_limit/config`,
      payload: {
        name: `${clientName} ${serviceName} limit`,
        object_id: `${base}_limit`,
        unique_id: `family_gate_${base}_limit`,
        state_topic: stateTopic,
        value_template: "{{ value_json.limit_minutes }}",
        command_topic: `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/set/limit`,
        min: 0,
        max: 480,
        step: 5,
        mode: "box",
        unit_of_measurement: "min",
        icon: "mdi:timer-cog-outline",
        device,
      },
    },
    {
      path: `sensor/${base}_bonus/config`,
      payload: {
        name: `${clientName} ${serviceName} bonus`,
        object_id: `${base}_bonus`,
        unique_id: `family_gate_${base}_bonus`,
        state_topic: stateTopic,
        value_template: "{{ value_json.bonus_minutes }}",
        unit_of_measurement: "min",
        icon: "mdi:plus-circle-outline",
        device,
      },
    },
    {
      path: `button/${base}_bonus_15/config`,
      payload: {
        name: `${clientName} ${serviceName} +15 min`,
        object_id: `${base}_bonus_15`,
        unique_id: `family_gate_${base}_bonus_15`,
        command_topic: `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/set/bonus`,
        payload_press: "15",
        icon: "mdi:timer-plus-outline",
        device,
      },
    },
    {
      path: `button/${base}_bonus_30/config`,
      payload: {
        name: `${clientName} ${serviceName} +30 min`,
        object_id: `${base}_bonus_30`,
        unique_id: `family_gate_${base}_bonus_30`,
        command_topic: `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/set/bonus`,
        payload_press: "30",
        icon: "mdi:timer-plus-outline",
        device,
      },
    },
    {
      path: `button/${base}_bonus_60/config`,
      payload: {
        name: `${clientName} ${serviceName} +1 h`,
        object_id: `${base}_bonus_60`,
        unique_id: `family_gate_${base}_bonus_60`,
        command_topic: `${env.mqtt.baseTopic}/${clientSlug}/${serviceId}/set/bonus`,
        payload_press: "60",
        icon: "mdi:timer-plus-outline",
        device,
      },
    },
  ];

  for (const s of sensors) {
    const topic = `${prefix}/${s.path}`;
    client.publish(topic, JSON.stringify(s.payload), { retain: true, qos: 1 }, (err) => {
      if (err) console.error("[mqtt] discovery publish failed", topic, err.message);
    });
  }

  // store mapping clientSlug -> clientId for commands
  client.publish(
    `${env.mqtt.baseTopic}/${clientSlug}/meta`,
    JSON.stringify({ clientId, clientName }),
    { retain: true, qos: 0 },
  );

  discovered.add(key);
}

export function publishUsageStates(snapshots: UsageSnapshot[]): void {
  if (!client || !connected) return;

  for (const snap of snapshots) {
    const topic = `${env.mqtt.baseTopic}/${snap.clientSlug}/${snap.serviceId}/state`;
    const remaining = Math.max(0, snap.remainingSeconds);
    const payload = {
      used_minutes: Math.floor(snap.usedSeconds / 60),
      remaining_minutes: Math.ceil(remaining / 60),
      limit_minutes: Math.floor(snap.dailyLimitSeconds / 60),
      bonus_minutes: Math.floor(snap.bonusSeconds / 60),
      effective_limit_minutes: Math.floor(snap.effectiveLimitSeconds / 60),
      blocked: snap.blocked ? "true" : "false",
      allowed: snap.blocked ? "false" : "true",
      force_blocked: snap.forceBlocked ? "true" : "false",
      active_session: snap.activeSession ? "true" : "false",
      enabled: snap.enabled ? "true" : "false",
    };
    client.publish(topic, JSON.stringify(payload), { retain: true, qos: 0 });
  }
}

async function handleCommand(topic: string, payload: string): Promise<void> {
  if (!callbacks) return;
  const parts = topic.split("/");
  if (parts[0] !== env.mqtt.baseTopic) return;

  // family_gate/chores/task_{id}/set/complete
  if (parts[1] === "chores" && parts[3] === "set") {
    const taskPart = parts[2] ?? "";
    const action = parts[4];
    const match = /^task_(\d+)$/.exec(taskPart);
    if (!match) return;
    const taskId = Number(match[1]);
    try {
      if (action === "complete") {
        completeTask(taskId);
        publishChoreStates();
      }
    } catch (err) {
      console.error("[mqtt] chore command failed", topic, err);
    }
    return;
  }

  // family_gate/{clientSlug}/{serviceId}/set/switch|limit|bonus
  if (parts.length < 5) return;
  const [, clientSlug, serviceId, set, action] = parts;
  if (set !== "set") return;

  const db = getDb();
  const clients = db.prepare("SELECT * FROM clients WHERE active = 1").all() as ClientRow[];
  const clientRow = clients.find((c) => slugify(c.name) === clientSlug);
  if (!clientRow) return;

  try {
    if (action === "switch") {
      const on = payload.trim().toUpperCase() === "ON";
      await callbacks.setForceBlocked(clientRow.id, serviceId, !on);
    } else if (action === "limit") {
      const minutes = Number.parseInt(payload, 10);
      if (Number.isFinite(minutes) && minutes >= 0) {
        await callbacks.setLimitMinutes(clientRow.id, serviceId, minutes);
      }
    } else if (action === "bonus") {
      const minutes = Number.parseInt(payload, 10);
      if (Number.isFinite(minutes) && minutes > 0) {
        await callbacks.addBonusMinutes(clientRow.id, serviceId, minutes);
      }
    }
  } catch (err) {
    console.error("[mqtt] command failed", topic, err);
  }
}

export function buildSnapshots(): UsageSnapshot[] {
  const db = getDb();
  const date = todayInTimezone();
  const rows = db
    .prepare(
      `SELECT
         c.id AS client_id,
         c.name AS client_name,
         s.id AS service_id,
         s.name AS service_name,
         l.daily_limit_seconds,
         l.enabled,
         l.force_blocked,
         COALESCE(u.used_seconds, 0) AS used_seconds,
         COALESCE(u.bonus_seconds, 0) AS bonus_seconds,
         CASE WHEN EXISTS (
           SELECT 1 FROM sessions sess
           WHERE sess.client_id = c.id AND sess.service_id = s.id AND sess.ended_at IS NULL
         ) THEN 1 ELSE 0 END AS active_session
       FROM clients c
       JOIN limits l ON l.client_id = c.id
       JOIN services s ON s.id = l.service_id
       LEFT JOIN usage_daily u
         ON u.client_id = c.id AND u.service_id = s.id AND u.date = ?
       WHERE c.active = 1`,
    )
    .all(date) as Array<{
    client_id: number;
    client_name: string;
    service_id: string;
    service_name: string;
    daily_limit_seconds: number;
    enabled: number;
    force_blocked: number;
    used_seconds: number;
    bonus_seconds: number;
    active_session: number;
  }>;

  return rows.map((r) => {
    const effective = r.daily_limit_seconds + r.bonus_seconds;
    const remaining = Math.max(0, effective - r.used_seconds);
    const overLimit = r.enabled === 1 && r.used_seconds >= effective;
    const blocked = r.force_blocked === 1 || overLimit;
    return {
      clientId: r.client_id,
      clientName: r.client_name,
      clientSlug: slugify(r.client_name),
      serviceId: r.service_id,
      serviceName: r.service_name,
      usedSeconds: r.used_seconds,
      dailyLimitSeconds: r.daily_limit_seconds,
      bonusSeconds: r.bonus_seconds,
      effectiveLimitSeconds: effective,
      remainingSeconds: remaining,
      blocked,
      forceBlocked: r.force_blocked === 1,
      enabled: r.enabled === 1,
      activeSession: r.active_session === 1,
    };
  });
}
