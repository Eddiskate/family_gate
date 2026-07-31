export type ServiceId = "youtube" | "netflix" | "disneyplus" | "tiktok" | "twitch";

export interface ClientDto {
  id: number;
  name: string;
  adguardName: string;
  ips: string[];
  active: boolean;
}

export interface ServiceDto {
  id: ServiceId | string;
  name: string;
  domainPatterns: string[];
}

export interface LimitDto {
  clientId: number;
  serviceId: string;
  dailyLimitSeconds: number;
  enabled: boolean;
  forceBlocked: boolean;
}

export interface UsageTodayDto {
  clientId: number;
  clientName: string;
  serviceId: string;
  serviceName: string;
  usedSeconds: number;
  dailyLimitSeconds: number;
  bonusSeconds: number;
  effectiveLimitSeconds: number;
  remainingSeconds: number;
  blocked: boolean;
  forceBlocked: boolean;
  activeSession: boolean;
  enabled: boolean;
}

export interface UsageHistoryDto {
  date: string;
  clientId: number;
  clientName: string;
  serviceId: string;
  serviceName: string;
  usedSeconds: number;
  dailyLimitSeconds: number;
  bonusSeconds: number;
  blockedAt: string | null;
}

export interface StatusDto {
  ok: boolean;
  timezone: string;
  today: string;
  worker: {
    running: boolean;
    lastPollAt: string | null;
    lastError: string | null;
    pollIntervalSec: number;
    idleTimeoutSec: number;
  };
  adguard: {
    configured: boolean;
    url: string;
  };
  mqtt: {
    enabled: boolean;
    connected: boolean;
  };
}

export interface UpdateLimitBody {
  dailyLimitSeconds: number;
  enabled?: boolean;
}

export interface AddBonusBody {
  seconds: number;
}
