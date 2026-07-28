import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, UsageHistory } from './api.service';
import { clearAuth } from './auth.interceptor';
import { Router } from '@angular/router';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="shell">
      <header class="top">
        <div>
          <p class="brand">Family Gate</p>
          <p class="sub">Archiwum zużycia</p>
        </div>
        <nav>
          <a routerLink="/">Dziś</a>
          <a routerLink="/history">Archiwum</a>
          <button type="button" class="linkish" (click)="logout()">Wyloguj</button>
        </nav>
      </header>

      <div class="filters">
        <label>
          Od
          <input type="date" [(ngModel)]="from" (change)="load()" />
        </label>
        <label>
          Do
          <input type="date" [(ngModel)]="to" (change)="load()" />
        </label>
      </div>

      @if (error) {
        <p class="banner">{{ error }}</p>
      }

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>TV</th>
              <th>Usługa</th>
              <th>Zużycie</th>
              <th>Limit</th>
              <th>Blokada</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows; track track(row)) {
              <tr>
                <td>{{ row.date }}</td>
                <td>{{ row.clientName }}</td>
                <td>{{ row.serviceName }}</td>
                <td>{{ formatMin(row.usedSeconds) }}</td>
                <td>{{ formatMin(row.dailyLimitSeconds) }}</td>
                <td>{{ row.blockedAt ? 'tak' : '—' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty">Brak danych w wybranym zakresie.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
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
        margin-bottom: 1.25rem;
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
      .filters {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      label {
        display: grid;
        gap: 0.25rem;
        font-size: 0.8rem;
        color: var(--muted);
      }
      input {
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--text);
        border-radius: 8px;
        padding: 0.45rem 0.55rem;
        font: inherit;
      }
      .banner {
        background: color-mix(in srgb, var(--danger) 15%, transparent);
        color: var(--danger);
        padding: 0.75rem 1rem;
        border-radius: 10px;
      }
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.95rem;
      }
      th,
      td {
        text-align: left;
        padding: 0.75rem 0.9rem;
        border-bottom: 1px solid var(--line);
      }
      th {
        color: var(--muted);
        font-weight: 600;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      tr:last-child td {
        border-bottom: 0;
      }
      .empty {
        color: var(--muted);
        text-align: center;
      }
    `,
  ],
})
export class HistoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  from = '';
  to = '';
  rows: UsageHistory[] = [];
  error = '';

  ngOnInit(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - 14);
    this.to = this.isoDate(to);
    this.from = this.isoDate(from);
    this.load();
  }

  load(): void {
    this.api.usageHistory(this.from, this.to).subscribe({
      next: (rows) => {
        this.rows = rows;
        this.error = '';
      },
      error: () => (this.error = 'Nie udało się pobrać archiwum.'),
    });
  }

  track(row: UsageHistory): string {
    return `${row.date}:${row.clientId}:${row.serviceId}`;
  }

  formatMin(seconds: number): string {
    const m = Math.floor(seconds / 60);
    return `${m} min`;
  }

  isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  logout(): void {
    clearAuth();
    void this.router.navigateByUrl('/login');
  }
}
