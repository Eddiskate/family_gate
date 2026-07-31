import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { env } from "./config.js";
import { initDb } from "./db.js";
import { startMqtt, stopMqtt } from "./mqtt.js";
import { registerRoutes } from "./routes.js";
import {
  addBonusSeconds,
  setForceBlocked,
  setLimitSeconds,
  startWorker,
  stopWorker,
} from "./worker.js";

async function main(): Promise<void> {
  initDb();

  const app = Fastify({
    logger: true,
  });

  await registerRoutes(app);

  const webDir = resolveWebDir();
  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
    console.log(`[api] serving Angular from ${webDir}`);
  } else {
    console.warn("[api] Angular dist not found — API only mode");
  }

  await startMqtt({
    setForceBlocked,
    setLimitMinutes: async (clientId, serviceId, minutes) => {
      await setLimitSeconds(clientId, serviceId, minutes * 60);
    },
    addBonusMinutes: async (clientId, serviceId, minutes) => {
      await addBonusSeconds(clientId, serviceId, minutes * 60);
    },
  });

  startWorker();

  await app.listen({ port: env.port, host: env.host });
  console.log(`[api] listening on http://${env.host}:${env.port}`);

  const shutdown = async () => {
    stopWorker();
    await stopMqtt();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function resolveWebDir(): string | null {
  const candidates = [
    env.webDistDir,
    path.resolve(process.cwd(), "public"),
    path.resolve(process.cwd(), "../web/dist/web/browser"),
    path.resolve(process.cwd(), "../../apps/web/dist/web/browser"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
