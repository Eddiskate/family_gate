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

/** Set or clear a blocked service for a client without wiping other settings. */
export async function setClientBlockedService(
  adguardName: string,
  serviceId: string,
  blocked: boolean,
): Promise<void> {
  const current = await findClientByName(adguardName);
  if (!current) {
    throw new AdguardError(`Client not found in AdGuard: ${adguardName}`, 404);
  }

  const existing = new Set(current.blocked_services ?? []);
  if (blocked) {
    existing.add(serviceId);
  } else {
    existing.delete(serviceId);
  }

  const blockedServices = [...existing];
  const next: AdguardClient = {
    ...current,
    name: current.name,
    ids: current.ids,
    use_global_blocked_services: blockedServices.length === 0,
    blocked_services: blockedServices,
  };

  await updateClient(adguardName, next);
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
