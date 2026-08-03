import nodemailer from "nodemailer";
import { env, isSmtpConfigured } from "./config.js";
import { listDueTasks, type TaskDto } from "./chores.js";
import { getDb } from "./db.js";
import { todayInTimezone } from "./time.js";

export async function sendDueTaskEmails(): Promise<void> {
  if (!isSmtpConfigured()) return;

  const today = todayInTimezone();
  const due = listDueTasks().filter((t) => t.notifyEmail);
  if (due.length === 0) return;

  const db = getDb();
  const toNotify: TaskDto[] = [];
  for (const task of due) {
    const row = db.prepare("SELECT last_notified_date FROM tasks WHERE id = ?").get(task.id) as
      | { last_notified_date: string | null }
      | undefined;
    if (row?.last_notified_date === today) continue;
    toNotify.push(task);
  }
  if (toNotify.length === 0) return;

  const transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth:
      env.smtp.user && env.smtp.password
        ? { user: env.smtp.user, pass: env.smtp.password }
        : undefined,
  });

  const lines = toNotify.map((t) => {
    const label = t.status === "overdue" ? "ZALEGŁE" : "DZIŚ";
    return `- [${label}] ${t.groupName}: ${t.title} (termin: ${t.nextDueDate})`;
  });

  await transporter.sendMail({
    from: env.smtp.from,
    to: env.smtp.to,
    subject: `Family Gate — ${toNotify.length} zadanie/nia do zrobienia`,
    text: `Przypomnienia na ${today} (${env.timezone}):\n\n${lines.join("\n")}\n\nPanel: http://home.blackpage.pl:3036/chores\n`,
  });

  const mark = db.prepare("UPDATE tasks SET last_notified_date = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const t of toNotify) mark.run(today, t.id);
  });
  tx();

  console.log(`[mail] sent due-task email (${toNotify.length})`);
}
