import { env } from "./config.js";

export function todayInTimezone(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: env.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function minutesFromSeconds(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / 60));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
