import { getDb } from "./db.js";
import { isoNow, todayInTimezone } from "./time.js";

export type RecurrenceType = "daily" | "weekly" | "every_n_days" | "once";

export type TaskGroupRow = {
  id: number;
  name: string;
  description: string;
  sort_order: number;
};

export type TaskRow = {
  id: number;
  group_id: number;
  title: string;
  notes: string;
  recurrence_type: RecurrenceType;
  recurrence_interval: number;
  weekday: number | null;
  next_due_date: string | null;
  last_done_at: string | null;
  enabled: number;
  notify_email: number;
  last_notified_date: string | null;
};

export type TaskDto = {
  id: number;
  groupId: number;
  groupName: string;
  title: string;
  notes: string;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  weekday: number | null;
  nextDueDate: string | null;
  lastDoneAt: string | null;
  enabled: boolean;
  notifyEmail: boolean;
  status: "overdue" | "due_today" | "upcoming" | "done" | "disabled";
};

export type GroupDto = {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  tasks: TaskDto[];
};

/** Parse YYYY-MM-DD as local calendar date in app timezone (date-only). */
export function parseDateOnly(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function formatDateOnly(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDateOnly(d);
}

/** JS weekday: 0=Sun … 6=Sat */
export function weekdayOf(date: string): number {
  return parseDateOnly(date).getUTCDay();
}

export function computeNextDueDate(opts: {
  fromDate: string;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  weekday: number | null;
}): string | null {
  const { fromDate, recurrenceType, recurrenceInterval, weekday } = opts;
  if (recurrenceType === "once") return null;
  if (recurrenceType === "daily") {
    return addDays(fromDate, Math.max(1, recurrenceInterval || 1));
  }
  if (recurrenceType === "every_n_days") {
    return addDays(fromDate, Math.max(1, recurrenceInterval || 1));
  }
  if (recurrenceType === "weekly") {
    const target = weekday ?? 6; // default Saturday
    let candidate = addDays(fromDate, 1);
    for (let i = 0; i < 14; i++) {
      if (weekdayOf(candidate) === target) return candidate;
      candidate = addDays(candidate, 1);
    }
  }
  return null;
}

export function initialDueDate(opts: {
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  weekday: number | null;
  startDate?: string;
}): string | null {
  const today = opts.startDate ?? todayInTimezone();
  if (opts.recurrenceType === "once") return today;
  if (opts.recurrenceType === "weekly") {
    const target = opts.weekday ?? 6;
    if (weekdayOf(today) === target) return today;
    return computeNextDueDate({
      fromDate: today,
      recurrenceType: "weekly",
      recurrenceInterval: 1,
      weekday: target,
    });
  }
  return today;
}

function taskStatus(row: TaskRow, today: string): TaskDto["status"] {
  if (row.enabled !== 1) return "disabled";
  if (!row.next_due_date) return "done";
  if (row.next_due_date < today) return "overdue";
  if (row.next_due_date === today) return "due_today";
  return "upcoming";
}

function mapTask(row: TaskRow, groupName: string, today = todayInTimezone()): TaskDto {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName,
    title: row.title,
    notes: row.notes,
    recurrenceType: row.recurrence_type,
    recurrenceInterval: row.recurrence_interval,
    weekday: row.weekday,
    nextDueDate: row.next_due_date,
    lastDoneAt: row.last_done_at,
    enabled: row.enabled === 1,
    notifyEmail: row.notify_email === 1,
    status: taskStatus(row, today),
  };
}

export function listGroupsWithTasks(): GroupDto[] {
  const db = getDb();
  const today = todayInTimezone();
  const groups = db
    .prepare("SELECT * FROM task_groups ORDER BY sort_order, id")
    .all() as TaskGroupRow[];
  const tasks = db
    .prepare("SELECT * FROM tasks ORDER BY next_due_date IS NULL, next_due_date, id")
    .all() as TaskRow[];

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    sortOrder: g.sort_order,
    tasks: tasks.filter((t) => t.group_id === g.id).map((t) => mapTask(t, g.name, today)),
  }));
}

export function listDueTasks(): TaskDto[] {
  const groups = listGroupsWithTasks();
  return groups
    .flatMap((g) => g.tasks)
    .filter((t) => t.enabled && (t.status === "overdue" || t.status === "due_today"))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "overdue" ? -1 : 1;
      return (a.nextDueDate ?? "").localeCompare(b.nextDueDate ?? "");
    });
}

export function createGroup(input: {
  name: string;
  description?: string;
  sortOrder?: number;
}): GroupDto {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO task_groups (name, description, sort_order) VALUES (?, ?, ?)`,
    )
    .run(input.name.trim(), input.description?.trim() ?? "", input.sortOrder ?? 0);
  const groups = listGroupsWithTasks();
  return groups.find((g) => g.id === Number(info.lastInsertRowid))!;
}

export function updateGroup(
  id: number,
  input: { name?: string; description?: string; sortOrder?: number },
): GroupDto {
  const db = getDb();
  const current = db.prepare("SELECT * FROM task_groups WHERE id = ?").get(id) as
    | TaskGroupRow
    | undefined;
  if (!current) throw new Error("Group not found");
  db.prepare(
    `UPDATE task_groups SET name = ?, description = ?, sort_order = ? WHERE id = ?`,
  ).run(
    input.name?.trim() ?? current.name,
    input.description !== undefined ? input.description.trim() : current.description,
    input.sortOrder ?? current.sort_order,
    id,
  );
  return listGroupsWithTasks().find((g) => g.id === id)!;
}

export function deleteGroup(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM task_groups WHERE id = ?").run(id);
}

export function createTask(input: {
  groupId: number;
  title: string;
  notes?: string;
  recurrenceType: RecurrenceType;
  recurrenceInterval?: number;
  weekday?: number | null;
  nextDueDate?: string | null;
  notifyEmail?: boolean;
  enabled?: boolean;
}): TaskDto {
  const db = getDb();
  const group = db.prepare("SELECT * FROM task_groups WHERE id = ?").get(input.groupId) as
    | TaskGroupRow
    | undefined;
  if (!group) throw new Error("Group not found");

  const interval = Math.max(1, input.recurrenceInterval ?? 1);
  const weekday = input.weekday ?? null;
  const nextDue =
    input.nextDueDate !== undefined
      ? input.nextDueDate
      : initialDueDate({
          recurrenceType: input.recurrenceType,
          recurrenceInterval: interval,
          weekday,
        });

  const info = db
    .prepare(
      `INSERT INTO tasks (
         group_id, title, notes, recurrence_type, recurrence_interval, weekday,
         next_due_date, last_done_at, enabled, notify_email, last_notified_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    .run(
      input.groupId,
      input.title.trim(),
      input.notes?.trim() ?? "",
      input.recurrenceType,
      interval,
      weekday,
      nextDue,
      input.enabled === false ? 0 : 1,
      input.notifyEmail ? 1 : 0,
    );

  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(Number(info.lastInsertRowid)) as TaskRow;
  return mapTask(row, group.name);
}

export function updateTask(
  id: number,
  input: {
    title?: string;
    notes?: string;
    recurrenceType?: RecurrenceType;
    recurrenceInterval?: number;
    weekday?: number | null;
    nextDueDate?: string | null;
    notifyEmail?: boolean;
    enabled?: boolean;
    groupId?: number;
  },
): TaskDto {
  const db = getDb();
  const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!current) throw new Error("Task not found");

  const groupId = input.groupId ?? current.group_id;
  const group = db.prepare("SELECT * FROM task_groups WHERE id = ?").get(groupId) as
    | TaskGroupRow
    | undefined;
  if (!group) throw new Error("Group not found");

  db.prepare(
    `UPDATE tasks SET
       group_id = ?, title = ?, notes = ?, recurrence_type = ?, recurrence_interval = ?,
       weekday = ?, next_due_date = ?, enabled = ?, notify_email = ?
     WHERE id = ?`,
  ).run(
    groupId,
    input.title?.trim() ?? current.title,
    input.notes !== undefined ? input.notes.trim() : current.notes,
    input.recurrenceType ?? current.recurrence_type,
    input.recurrenceInterval ?? current.recurrence_interval,
    input.weekday !== undefined ? input.weekday : current.weekday,
    input.nextDueDate !== undefined ? input.nextDueDate : current.next_due_date,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    input.notifyEmail === undefined ? current.notify_email : input.notifyEmail ? 1 : 0,
    id,
  );

  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
  return mapTask(row, group.name);
}

export function deleteTask(id: number): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

export function completeTask(
  id: number,
  opts?: { nextDueDate?: string | null; notes?: string },
): TaskDto {
  const db = getDb();
  const current = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  if (!current) throw new Error("Task not found");
  const group = db.prepare("SELECT * FROM task_groups WHERE id = ?").get(current.group_id) as TaskGroupRow;

  const today = todayInTimezone();
  const doneAt = isoNow();
  let nextDue: string | null;
  if (opts?.nextDueDate !== undefined) {
    nextDue = opts.nextDueDate;
  } else {
    nextDue = computeNextDueDate({
      fromDate: today,
      recurrenceType: current.recurrence_type,
      recurrenceInterval: current.recurrence_interval,
      weekday: current.weekday,
    });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO task_completions (task_id, done_at, previous_due_date, next_due_date, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, doneAt, current.next_due_date, nextDue, opts?.notes?.trim() ?? "");

    db.prepare(
      `UPDATE tasks SET last_done_at = ?, next_due_date = ?, last_notified_date = NULL WHERE id = ?`,
    ).run(doneAt, nextDue, id);
  });
  tx();

  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow;
  return mapTask(row, group.name);
}

export function seedChoresIfEmpty(): void {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) AS c FROM task_groups").get() as { c: number };
  if (count.c > 0) return;

  const basen = createGroup({
    name: "Basen",
    description: "Codzienna i tygodniowa pielęgnacja basenu",
    sortOrder: 1,
  });
  const akwarium = createGroup({
    name: "Akwarium",
    description: "Pielęgnacja akwarium",
    sortOrder: 2,
  });

  createTask({
    groupId: basen.id,
    title: "Wyczyść filtr",
    notes: "Codzienne czyszczenie filtra",
    recurrenceType: "daily",
    notifyEmail: true,
  });
  createTask({
    groupId: basen.id,
    title: "Wlej antyglon",
    notes: "Raz w tygodniu",
    recurrenceType: "every_n_days",
    recurrenceInterval: 7,
    notifyEmail: true,
  });
  createTask({
    groupId: basen.id,
    title: "Odkurz basen",
    notes: "Sobota",
    recurrenceType: "weekly",
    weekday: 6,
    notifyEmail: true,
  });
  createTask({
    groupId: akwarium.id,
    title: "Wymiana wody",
    notes: "Raz w tygodniu",
    recurrenceType: "every_n_days",
    recurrenceInterval: 7,
    notifyEmail: true,
  });
}
