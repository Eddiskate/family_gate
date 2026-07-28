import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { clearAuth, setAuthPassword } from './auth.interceptor';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <main class="login">
      <section class="login-card">
        <p class="brand">Family Gate</p>
        <h1>Panel rodzica</h1>
        <p class="hint">Hasło z zmiennej PARENT_PASSWORD</p>
        <label>
          Hasło
          <input
            type="password"
            [(ngModel)]="password"
            (keydown.enter)="submit()"
            autocomplete="current-password"
          />
        </label>
        @if (error) {
          <p class="error">{{ error }}</p>
        }
        <button type="button" (click)="submit()" [disabled]="loading">
          {{ loading ? 'Logowanie…' : 'Wejdź' }}
        </button>
      </section>
    </main>
  `,
  styles: [
    `
      .login {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1.5rem;
      }
      .login-card {
        width: min(100%, 380px);
        display: grid;
        gap: 0.85rem;
      }
      .brand {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.75rem;
        letter-spacing: -0.03em;
      }
      h1 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
      }
      .hint {
        margin: 0;
        color: var(--muted);
        font-size: 0.9rem;
      }
      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        color: var(--muted);
      }
      input {
        border: 1px solid var(--line);
        background: var(--surface);
        color: var(--text);
        border-radius: 10px;
        padding: 0.75rem 0.9rem;
        font: inherit;
      }
      button {
        margin-top: 0.25rem;
        border: 0;
        border-radius: 10px;
        padding: 0.8rem 1rem;
        background: var(--accent);
        color: #fff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .error {
        margin: 0;
        color: var(--danger);
        font-size: 0.9rem;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  password = '';
  error = '';
  loading = false;

  submit(): void {
    this.error = '';
    this.loading = true;
    setAuthPassword(this.password);
    this.api.status().subscribe({
      next: () => {
        this.loading = false;
        void this.router.navigateByUrl('/');
      },
      error: () => {
        this.loading = false;
        clearAuth();
        this.error = 'Nieprawidłowe hasło lub API niedostępne.';
      },
    });
  }
}
