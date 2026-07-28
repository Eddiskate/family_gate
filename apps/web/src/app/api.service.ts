import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface UsageToday {
  clientId: number;
  clientName: string;
  serviceId: string;
  serviceName: string;
  usedSeconds: number;
  dailyLimitSeconds: number;
  remainingSeconds: number;
  blocked: boolean;
  forceBlocked: boolean;
  activeSession: boolean;
  enabled: boolean;
}

export interface UsageHistory {
  date: string;
  clientId: number;
  clientName: string;
  serviceId: string;
  serviceName: string;
  usedSeconds: number;
  dailyLimitSeconds: number;
  blockedAt: string | null;
}

export interface Status {
  ok: boolean;
  timezone: string;
  today: string;
  worker: {
    running: boolean;
    lastPollAt: string | null;
    lastError: string | null;
  };
  mqtt: { enabled: boolean; connected: boolean };
  adguard: { configured: boolean; url: string };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  status(): Observable<Status> {
    return this.http.get<Status>('/api/status');
  }

  usageToday(): Observable<UsageToday[]> {
    return this.http.get<UsageToday[]>('/api/usage/today');
  }

  usageHistory(from: string, to: string): Observable<UsageHistory[]> {
    return this.http.get<UsageHistory[]>('/api/usage/history', {
      params: { from, to },
    });
  }

  updateLimit(
    clientId: number,
    serviceId: string,
    dailyLimitSeconds: number,
    enabled?: boolean,
  ): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`/api/limits/${clientId}/${serviceId}`, {
      dailyLimitSeconds,
      enabled,
    });
  }

  block(clientId: number, serviceId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/clients/${clientId}/services/${serviceId}/block`,
      {},
    );
  }

  unblock(clientId: number, serviceId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/clients/${clientId}/services/${serviceId}/unblock`,
      {},
    );
  }

  resetToday(clientId: number, serviceId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/clients/${clientId}/services/${serviceId}/reset-today`,
      {},
    );
  }
}
