import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
  path.resolve(here, "../../../.env"),
  path.resolve(here, "../../../../.env"),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    loadEnv({ path: envPath, override: true });
    break;
  }
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");

export const env = {
  port: int("PORT", 3036),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir,
  dbPath: path.join(dataDir, "family_gate.db"),
  webDistDir: process.env.WEB_DIST_DIR
    ? path.resolve(process.env.WEB_DIST_DIR)
    : path.resolve(process.cwd(), "../web/dist/web/browser"),
  timezone: process.env.TIMEZONE ?? "Europe/Warsaw",
  parentPassword: process.env.PARENT_PASSWORD ?? "change-me",
  adguard: {
    url: (process.env.ADGUARD_URL ?? "http://home.blackpage.pl:3035").replace(/\/$/, ""),
    user: process.env.ADGUARD_USER ?? "",
    password: process.env.ADGUARD_PASSWORD ?? "",
  },
  pollIntervalSec: int("POLL_INTERVAL_SEC", 20),
  idleTimeoutSec: int("IDLE_TIMEOUT_SEC", 180),
  mqtt: {
    url: process.env.MQTT_URL ?? "",
    user: process.env.MQTT_USER ?? "",
    password: process.env.MQTT_PASSWORD ?? "",
    discoveryPrefix: process.env.MQTT_DISCOVERY_PREFIX ?? "homeassistant",
    baseTopic: process.env.MQTT_BASE_TOPIC ?? "family_gate",
  },
};

export function isMqttEnabled(): boolean {
  return Boolean(env.mqtt.url);
}

export function isAdguardConfigured(): boolean {
  return Boolean(env.adguard.url && env.adguard.user && env.adguard.password);
}
