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
  bonusSeconds: number;
  effectiveLimitSeconds: number;
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
  bonusSeconds: number;
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
  smtp?: { configured: boolean };
  chores?: { dueCount: number };
}

export type RecurrenceType = 'daily' | 'weekly' | 'every_n_days' | 'once' | 'calendar';

export interface ChoreTask {
  id: number;
  groupId: number;
  groupName: string;
  title: string;
  notes: string;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  weekday: number | null;
  calendarDates?: string[];
  nextDueDate: string | null;
  lastDoneAt: string | null;
  enabled: boolean;
  notifyEmail: boolean;
  status: 'overdue' | 'due_today' | 'upcoming' | 'done' | 'disabled';
}

export interface ChoreGroup {
  id: number;
  name: string;
  description: string;
  sortOrder: number;
  tasks: ChoreTask[];
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

  addBonus(
    clientId: number,
    serviceId: string,
    seconds: number,
  ): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/clients/${clientId}/services/${serviceId}/bonus`,
      { seconds },
    );
  }

  choreGroups(): Observable<ChoreGroup[]> {
    return this.http.get<ChoreGroup[]>('/api/chores/groups');
  }

  choreDue(): Observable<ChoreTask[]> {
    return this.http.get<ChoreTask[]>('/api/chores/due');
  }

  createChoreGroup(body: {
    name: string;
    description?: string;
  }): Observable<ChoreGroup> {
    return this.http.post<ChoreGroup>('/api/chores/groups', body);
  }

  deleteChoreGroup(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/chores/groups/${id}`);
  }

  createChoreTask(body: {
    groupId: number;
    title: string;
    notes?: string;
    recurrenceType: RecurrenceType;
    recurrenceInterval?: number;
    weekday?: number | null;
    nextDueDate?: string | null;
    notifyEmail?: boolean;
  }): Observable<ChoreTask> {
    return this.http.post<ChoreTask>('/api/chores/tasks', body);
  }

  updateChoreTask(
    id: number,
    body: Partial<{
      title: string;
      notes: string;
      recurrenceType: RecurrenceType;
      recurrenceInterval: number;
      weekday: number | null;
      nextDueDate: string | null;
      notifyEmail: boolean;
      enabled: boolean;
    }>,
  ): Observable<ChoreTask> {
    return this.http.put<ChoreTask>(`/api/chores/tasks/${id}`, body);
  }

  deleteChoreTask(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/chores/tasks/${id}`);
  }

  completeChoreTask(
    id: number,
    body?: { nextDueDate?: string | null; notes?: string },
  ): Observable<ChoreTask> {
    return this.http.post<ChoreTask>(`/api/chores/tasks/${id}/complete`, body ?? {});
  }
}
