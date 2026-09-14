import { env } from "./config.js";

export type AdguardClient = {
  name: string;
  ids: string[];
  tags?: string[];
  use_global_settings?: boolean;
  filtering_enabled?: boolean;
  parental_enabled?: boolean;
  safebrowsing_enabled?: boolean;
  safesearch_enabled?: boolean;
  use_global_blocked_services?: boolean;
  blocked_services?: string[];
  /** Pause windows for blocked-services filtering (during pause, blocks do not apply). */
  blocked_services_schedule?: Record<string, unknown>;
  upstreams?: string[];
  ignore_querylog?: boolean;
  ignore_statistics?: boolean;
};

export type AdguardClientsResponse = {
  clients: AdguardClient[];
  auto_clients?: unknown[];
  supported_tags?: string[];
};

export type QueryLogItem = {
  time: string;
  client: string;
  question?: {
    name?: string;
    class?: string;
    type?: string;
  };
  answer?: unknown[];
  status?: string;
  reason?: string;
};

export type QueryLogResponse = {
  data: QueryLogItem[];
  oldest?: string;
};

export class AdguardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdguardError";
  }
}

function authHeader(): string {
  const token = Buffer.from(`${env.adguard.user}:${env.adguard.password}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${env.adguard.url}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AdguardError(
      `AdGuard ${method} ${path} failed: ${res.status} ${text}`,
      res.status,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export async function listClients(): Promise<AdguardClient[]> {
  const data = await request<AdguardClientsResponse>("GET", "/control/clients");
  return data.clients ?? [];
}

export async function findClientByName(name: string): Promise<AdguardClient | null> {
  const clients = await listClients();
  return clients.find((c) => c.name === name) ?? null;
}

/** Prefer exact name; otherwise any persistent client whose ids overlap our IPs. */
export async function findClientForDevice(
  adguardName: string,
  ips: string[] = [],
): Promise<AdguardClient | null> {
  const clients = await listClients();
  const byName = clients.find((c) => c.name === adguardName);
  if (byName) return byName;

  const ipSet = new Set(ips.map((ip) => ip.trim()).filter(Boolean));
  if (ipSet.size === 0) return null;

  return (
    clients.find((c) => (c.ids ?? []).some((id) => ipSet.has(id))) ?? null
  );
}

/** Only fields AdGuard accepts on clients/update (avoid echoing read-only junk). */
function toUpdatePayload(
  client: AdguardClient,
  patch: Partial<AdguardClient>,
): AdguardClient {
  const merged: AdguardClient = {
    name: patch.name ?? client.name,
    ids: patch.ids ?? client.ids ?? [],
    tags: patch.tags ?? client.tags ?? [],
    use_global_settings: patch.use_global_settings ?? client.use_global_settings ?? true,
    filtering_enabled: patch.filtering_enabled ?? client.filtering_enabled ?? true,
    parental_enabled: patch.parental_enabled ?? client.parental_enabled ?? false,
    safebrowsing_enabled:
      patch.safebrowsing_enabled ?? client.safebrowsing_enabled ?? false,
    safesearch_enabled: patch.safesearch_enabled ?? client.safesearch_enabled ?? false,
    use_global_blocked_services:
      patch.use_global_blocked_services ?? client.use_global_blocked_services ?? true,
    blocked_services: patch.blocked_services ?? client.blocked_services ?? [],
    upstreams: patch.upstreams ?? client.upstreams ?? [],
    ignore_querylog: patch.ignore_querylog ?? client.ignore_querylog ?? false,
    ignore_statistics: patch.ignore_statistics ?? client.ignore_statistics ?? false,
  };

  // Empty schedule = no pause windows → blocked_services always apply.
  if (patch.blocked_services_schedule !== undefined) {
    merged.blocked_services_schedule = patch.blocked_services_schedule;
  } else if (client.blocked_services_schedule) {
    merged.blocked_services_schedule = client.blocked_services_schedule;
  }

  return merged;
}

export async function updateClient(
  name: string,
  data: AdguardClient,
): Promise<void> {
  await request("POST", "/control/clients/update", { name, data });
}

export async function getQueryLog(params: {
  search?: string;
  limit?: number;
  older_than?: string;
}): Promise<QueryLogResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.older_than) qs.set("older_than", params.older_than);
  const query = qs.toString();
  return request<QueryLogResponse>(
    "GET",
    `/control/querylog${query ? `?${query}` : ""}`,
  );
}

export function isQueryBlocked(item: QueryLogItem): boolean {
  const reason = (item.reason ?? "").toLowerCase();
  const status = (item.status ?? "").toLowerCase();
  return (
    reason.includes("filtered") ||
    reason.includes("blocked") ||
    reason.includes("blacklist") ||
    status.includes("filtered") ||
    status.includes("blocked")
  );
}

/**
 * Set or clear a blocked service for a client without wiping other settings.
 * Matches by AdGuard client name or by overlapping IP, ensures our IPs stay in `ids`,
 * clears pause schedule while blocking, and verifies the result.
 */
export async function setClientBlockedService(
  adguardName: string,
  serviceId: string,
  blocked: boolean,
  ips: string[] = [],
): Promise<void> {
  const current = await findClientForDevice(adguardName, ips);
  if (!current) {
    throw new AdguardError(
      `Client not found in AdGuard: name="${adguardName}" ips=[${ips.join(", ")}]`,
      404,
    );
  }

  const existing = new Set(current.blocked_services ?? []);
  if (blocked) {
    existing.add(serviceId);
  } else {
    existing.delete(serviceId);
  }

  const blockedServices = [...existing];
  const mergedIds = [...new Set([...(current.ids ?? []), ...ips.filter(Boolean)])];

  const next = toUpdatePayload(current, {
    name: current.name,
    ids: mergedIds,
    use_global_blocked_services: blockedServices.length === 0,
    blocked_services: blockedServices,
    // While we manage blocks, do not leave a full-day "pause" schedule that
    // would silently allow YouTube despite blocked_services containing it.
    blocked_services_schedule: { time_zone: "Local" },
  });

  await updateClient(current.name, next);

  const verified = await findClientByName(current.name);
  if (!verified) {
    throw new AdguardError(
      `AdGuard client vanished after update: ${current.name}`,
      500,
    );
  }
  const has = (verified.blocked_services ?? []).includes(serviceId);
  const usingGlobal = verified.use_global_blocked_services === true;
  if (blocked && (usingGlobal || !has)) {
    throw new AdguardError(
      `AdGuard did not apply block for ${current.name}/${serviceId} ` +
        `(use_global=${usingGlobal}, services=${JSON.stringify(verified.blocked_services)})`,
      500,
    );
  }
  if (!blocked && has) {
    throw new AdguardError(
      `AdGuard still has ${serviceId} blocked for ${current.name}`,
      500,
    );
  }

  console.log(
    `[adguard] ${blocked ? "block" : "unblock"} ${current.name}/${serviceId} ` +
      `ids=${JSON.stringify(verified.ids)} services=${JSON.stringify(verified.blocked_services)}`,
  );
}

const MANAGED_BEGIN = "! family_gate:managed:begin";
const MANAGED_END = "! family_gate:managed:end";

export type ClientDomainBlock = {
  ips: string[];
  domains: string[];
};

function stripManagedRules(rules: string[]): string[] {
  const out: string[] = [];
  let inManaged = false;
  for (const line of rules) {
    if (line.trim() === MANAGED_BEGIN) {
      inManaged = true;
      continue;
    }
    if (line.trim() === MANAGED_END) {
      inManaged = false;
      continue;
    }
    if (!inManaged) out.push(line);
  }
  return out;
}

/**
 * Mirror active blocks into AdGuard Custom filtering rules with $client=IP.
 * Covers CDN domains (nflxvideo, googlevideo, …) more reliably than blocked_services alone.
 * Preserves all non-managed user rules.
 */
export async function syncManagedClientBlockRules(
  blocks: ClientDomainBlock[],
): Promise<void> {
  const status = await request<{ user_rules?: string[] }>(
    "GET",
    "/control/filtering/status",
  );
  const existing = status.user_rules ?? [];
  const preserved = stripManagedRules(existing);

  const managed: string[] = [MANAGED_BEGIN];
  for (const block of blocks) {
    for (const ip of block.ips) {
      if (!ip) continue;
      for (const domain of block.domains) {
        const d = domain.toLowerCase().replace(/^\.+/, "").trim();
        if (!d) continue;
        managed.push(`||${d}^$client=${ip}`);
      }
    }
  }
  managed.push(MANAGED_END);

  const rules =
    blocks.length === 0 || managed.length <= 2
      ? preserved
      : [...preserved, ...managed];

  await request("POST", "/control/filtering/set_rules", { rules });
  console.log(
    `[adguard] synced ${Math.max(0, managed.length - 2)} managed client block rules`,
  );
}

export function matchService(
  domain: string,
  patternsByService: Map<string, string[]>,
): string | null {
  const host = domain.toLowerCase().replace(/\.$/, "");
  for (const [serviceId, patterns] of patternsByService) {
    for (const pattern of patterns) {
      const p = pattern.toLowerCase();
      if (host === p || host.endsWith(`.${p}`)) {
        return serviceId;
      }
    }
  }
  return null;
}
