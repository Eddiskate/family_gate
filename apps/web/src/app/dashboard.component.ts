import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Status, UsageToday } from './api.service';
import { clearAuth } from './auth.interceptor';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="shell">
      <header class="top">
        <div>
          <p class="brand">Family Gate</p>
          <p class="sub">
            Dziś {{ status?.today || '…' }}
            @if (status?.worker?.lastError) {
              <span class="pill danger">błąd workera</span>
            } @else if (status?.worker?.running) {
              <span class="pill ok">worker OK</span>
            }
            @if (status?.mqtt?.enabled) {
              <span class="pill" [class.ok]="status?.mqtt?.connected">MQTT</span>
            }
          </p>
        </div>
        <nav>
          <a routerLink="/">Dziś</a>
          <a routerLink="/history">Archiwum</a>
          <button type="button" class="linkish" (click)="logout()">Wyloguj</button>
        </nav>
      </header>

      @if (error) {
        <p class="banner">{{ error }}</p>
      }

      <section class="grid">
        @for (group of groups; track group.clientId) {
          <article class="client">
            <h2>{{ group.clientName }}</h2>
            @for (row of group.rows; track row.serviceId) {
              <div class="service" [class.blocked]="row.blocked" [class.active]="row.activeSession">
                <div class="service-head">
                  <strong>{{ row.serviceName }}</strong>
                  <span class="status">
                    @if (row.blocked) {
                      zablokowane
                    } @else if (row.activeSession) {
                      ogląda
                    } @else {
                      OK
                    }
                  </span>
                </div>
                <div class="meter">
                  <div
                    class="fill"
                    [style.width.%]="progress(row)"
                  ></div>
                </div>
                <p class="meta">
                  {{ formatMin(row.usedSeconds) }} / {{ formatMin(row.dailyLimitSeconds) }}
                  @if (row.bonusSeconds > 0) {
                    <span class="bonus">(+{{ formatMin(row.bonusSeconds) }} bonus)</span>
                  }
                  · zostało {{ formatMin(row.remainingSeconds) }}
                </p>
                <div class="bonus-row">
                  <span class="bonus-label">Dodaj czas</span>
                  <button type="button" class="ghost" (click)="addBonus(row, 15)">+15 min</button>
                  <button type="button" class="ghost" (click)="addBonus(row, 30)">+30 min</button>
                  <button type="button" class="ghost" (click)="addBonus(row, 60)">+1 h</button>
                  <button type="button" class="ghost" (click)="addBonus(row, 120)">+2 h</button>
                </div>
                <div class="actions">
                  <label>
                    Limit dzienny (min)
                    <input
                      type="number"
                      min="0"
                      step="5"
                      [(ngModel)]="draftLimits[key(row)]"
                    />
                  </label>
                  <button type="button" (click)="saveLimit(row)">Zapisz</button>
                  @if (row.blocked) {
                    <button type="button" (click)="unblock(row)">Odblokuj</button>
                  } @else {
                    <button type="button" class="warn" (click)="block(row)">Zablokuj</button>
                  }
                  <button type="button" class="ghost" (click)="reset(row)">Reset dziś</button>
                </div>
              </div>
            }
          </article>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .shell {
        max-width: 1100px;
        margin: 0 auto;
        padding: 1.5rem 1.25rem 3rem;
      }
      .top {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: flex-start;
        margin-bottom: 1.5rem;
      }
      .brand {
        margin: 0;
        font-family: var(--font-display);
        font-size: 2rem;
        letter-spacing: -0.03em;
      }
      .sub {
        margin: 0.35rem 0 0;
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
      }
      nav {
        display: flex;
        gap: 0.85rem;
        align-items: center;
      }
      nav a {
        color: var(--text);
        text-decoration: none;
        font-weight: 600;
      }
      .linkish {
        border: 0;
        background: transparent;
        color: var(--muted);
        font: inherit;
        cursor: pointer;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--line) 70%, transparent);
        font-size: 0.75rem;
      }
      .pill.ok {
        background: color-mix(in srgb, var(--ok) 22%, transparent);
        color: var(--ok);
      }
      .pill.danger {
        background: color-mix(in srgb, var(--danger) 22%, transparent);
        color: var(--danger);
      }
      .banner {
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        color: var(--danger);
        padding: 0.75rem 1rem;
        border-radius: 10px;
      }
      .grid {
        display: grid;
        gap: 1.25rem;
      }
      .client {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 1.1rem 1.15rem;
      }
      h2 {
        margin: 0 0 0.85rem;
        font-size: 1.2rem;
      }
      .service {
        padding: 0.9rem 0;
        border-top: 1px solid var(--line);
      }
      .service:first-of-type {
        border-top: 0;
        padding-top: 0;
      }
      .service-head {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }
      .status {
        color: var(--muted);
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .service.blocked .status {
        color: var(--danger);
      }
      .service.active .status {
        color: var(--accent);
      }
      .meter {
        height: 8px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--line) 80%, transparent);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        background: var(--accent);
        border-radius: inherit;
        transition: width 0.3s ease;
      }
      .service.blocked .fill {
        background: var(--danger);
      }
      .meta {
        margin: 0.45rem 0 0.75rem;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .bonus {
        color: var(--accent);
        font-weight: 600;
      }
      .bonus-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
        margin-bottom: 0.65rem;
      }
      .bonus-label {
        font-size: 0.75rem;
        color: var(--muted);
        margin-right: 0.15rem;
      }
      .bonus-row button {
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0.35rem 0.55rem;
        background: var(--bg);
        color: var(--text);
        font: inherit;
        font-size: 0.8rem;
        cursor: pointer;
      }
      .bonus-row button:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: end;
      }
      .actions label {
        display: grid;
        gap: 0.2rem;
        font-size: 0.75rem;
        color: var(--muted);
      }
      .actions input {
        width: 5.5rem;
        border: 1px solid var(--line);
        background: var(--bg);
        color: var(--text);
        border-radius: 8px;
        padding: 0.45rem 0.55rem;
        font: inherit;
      }
      .actions button {
        border: 0;
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        background: var(--accent);
        color: #fff;
        font: inherit;
        font-size: 0.85rem;
        cursor: pointer;
      }
      .actions button.warn {
        background: var(--danger);
      }
      .actions button.ghost {
        background: transparent;
        color: var(--text);
        border: 1px solid var(--line);
      }
      @media (max-width: 640px) {
        .top {
          flex-direction: column;
        }
      }
    `,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private timer: ReturnType<typeof setInterval> | null = null;

  status: Status | null = null;
  groups: Array<{ clientId: number; clientName: string; rows: UsageToday[] }> = [];
  draftLimits: Record<string, number> = {};
  error = '';

  ngOnInit(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 10000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  refresh(): void {
    this.api.status().subscribe({
      next: (s) => (this.status = s),
      error: () => (this.error = 'Nie udało się pobrać statusu.'),
    });
    this.api.usageToday().subscribe({
      next: (rows) => {
        this.error = '';
        const map = new Map<number, { clientId: number; clientName: string; rows: UsageToday[] }>();
        for (const row of rows) {
          const g = map.get(row.clientId) ?? {
            clientId: row.clientId,
            clientName: row.clientName,
            rows: [],
          };
          g.rows.push(row);
          map.set(row.clientId, g);
          const k = this.key(row);
          if (this.draftLimits[k] === undefined) {
            this.draftLimits[k] = Math.round(row.dailyLimitSeconds / 60);
          }
        }
        this.groups = [...map.values()];
      },
      error: () => (this.error = 'Nie udało się pobrać zużycia.'),
    });
  }

  key(row: UsageToday): string {
    return `${row.clientId}:${row.serviceId}`;
  }

  progress(row: UsageToday): number {
    if (row.effectiveLimitSeconds <= 0) return 100;
    return Math.min(100, (row.usedSeconds / row.effectiveLimitSeconds) * 100);
  }

  formatMin(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }

  addBonus(row: UsageToday, minutes: number): void {
    this.api.addBonus(row.clientId, row.serviceId, minutes * 60).subscribe({
      next: () => this.refresh(),
      error: () => (this.error = 'Dodanie czasu nieudane.'),
    });
  }

  saveLimit(row: UsageToday): void {
    const minutes = this.draftLimits[this.key(row)] ?? 0;
    this.api.updateLimit(row.clientId, row.serviceId, Math.max(0, minutes) * 60).subscribe({
      next: () => this.refresh(),
      error: () => (this.error = 'Zapis limitu nieudany.'),
    });
  }

  block(row: UsageToday): void {
    this.api.block(row.clientId, row.serviceId).subscribe({
      next: () => this.refresh(),
      error: () => (this.error = 'Blokada nieudana.'),
    });
  }

  unblock(row: UsageToday): void {
    this.api.unblock(row.clientId, row.serviceId).subscribe({
      next: () => this.refresh(),
      error: () => (this.error = 'Odblokowanie nieudane.'),
    });
  }

  reset(row: UsageToday): void {
    if (!confirm(`Zresetować dzisiejszy czas dla ${row.clientName} / ${row.serviceName}?`)) {
      return;
    }
    this.api.resetToday(row.clientId, row.serviceId).subscribe({
      next: () => {
        this.draftLimits[this.key(row)] = Math.round(row.dailyLimitSeconds / 60);
        this.refresh();
      },
      error: () => (this.error = 'Reset nieudany.'),
    });
  }

  logout(): void {
    clearAuth();
    void this.router.navigateByUrl('/login');
  }
}
