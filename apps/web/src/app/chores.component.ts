import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import {
  ApiService,
  ChoreGroup,
  ChoreTask,
  RecurrenceType,
} from './api.service';
import { clearAuth } from './auth.interceptor';

@Component({
  selector: 'app-chores',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="shell">
      <header class="top">
        <div>
          <p class="brand">Family Gate</p>
          <p class="sub">
            Zadania i przypomnienia
            @if (dueCount > 0) {
              <span class="pill danger">{{ dueCount }} do zrobienia</span>
            }
          </p>
        </div>
        <nav>
          <a routerLink="/">TV</a>
          <a routerLink="/chores">Zadania</a>
          <a routerLink="/history">Archiwum</a>
          <button type="button" class="linkish" (click)="logout()">Wyloguj</button>
        </nav>
      </header>

      @if (error) {
        <p class="banner">{{ error }}</p>
      }

      @if (due.length) {
        <section class="due-box">
          <h2>Na dziś / zaległe</h2>
          @for (task of due; track task.id) {
            <div class="due-row" [class.overdue]="task.status === 'overdue'">
              <div>
                <strong>{{ task.groupName }}</strong> — {{ task.title }}
                <span class="muted">termin {{ task.nextDueDate }}</span>
              </div>
              <button type="button" (click)="complete(task)">Wykonano</button>
            </div>
          }
        </section>
      }

      <section class="toolbar">
        <button type="button" (click)="showNewGroup = !showNewGroup">+ Grupa</button>
        <button type="button" class="ghost" (click)="showNewTask = !showNewTask">+ Zadanie</button>
        <label class="import-btn">
          Import JSON
          <input type="file" accept="application/json,.json" (change)="onImportFile($event)" hidden />
        </label>
      </section>

      @if (importMsg) {
        <p class="ok-banner">{{ importMsg }}</p>
      }

      @if (showNewGroup) {
        <form class="form" (submit)="$event.preventDefault(); createGroup()">
          <h3>Nowa grupa</h3>
          <label>Nazwa <input [(ngModel)]="newGroup.name" name="gname" required /></label>
          <label>Opis <input [(ngModel)]="newGroup.description" name="gdesc" /></label>
          <button type="submit">Dodaj grupę</button>
        </form>
      }

      @if (showNewTask) {
        <form class="form" (submit)="$event.preventDefault(); createTask()">
          <h3>Nowe zadanie</h3>
          <label>
            Grupa
            <select [(ngModel)]="newTask.groupId" name="tgroup" required>
              @for (g of groups; track g.id) {
                <option [ngValue]="g.id">{{ g.name }}</option>
              }
            </select>
          </label>
          <label>Tytuł <input [(ngModel)]="newTask.title" name="ttitle" required /></label>
          <label>Notatki <input [(ngModel)]="newTask.notes" name="tnotes" /></label>
          <label>
            Cykl
            <select [(ngModel)]="newTask.recurrenceType" name="trecur">
              <option value="daily">Codziennie</option>
              <option value="every_n_days">Co N dni</option>
              <option value="weekly">Co tydzień (dzień)</option>
              <option value="once">Jednorazowo</option>
            </select>
          </label>
          @if (newTask.recurrenceType === 'every_n_days' || newTask.recurrenceType === 'daily') {
            <label>
              Co ile dni
              <input type="number" min="1" [(ngModel)]="newTask.recurrenceInterval" name="tint" />
            </label>
          }
          @if (newTask.recurrenceType === 'weekly') {
            <label>
              Dzień tygodnia
              <select [(ngModel)]="newTask.weekday" name="tweek">
                <option [ngValue]="1">Poniedziałek</option>
                <option [ngValue]="2">Wtorek</option>
                <option [ngValue]="3">Środa</option>
                <option [ngValue]="4">Czwartek</option>
                <option [ngValue]="5">Piątek</option>
                <option [ngValue]="6">Sobota</option>
                <option [ngValue]="0">Niedziela</option>
              </select>
            </label>
          }
          <label>
            Następny termin
            <input type="date" [(ngModel)]="newTask.nextDueDate" name="tdue" />
          </label>
          <label class="check">
            <input type="checkbox" [(ngModel)]="newTask.notifyEmail" name="tmail" />
            Powiadom e-mailem
          </label>
          <button type="submit">Dodaj zadanie</button>
        </form>
      }

      <section class="grid">
        @for (group of groups; track group.id) {
          <article class="group">
            <div class="group-head">
              <div>
                <h2>{{ group.name }}</h2>
                @if (group.description) {
                  <p class="muted">{{ group.description }}</p>
                }
              </div>
              <button type="button" class="ghost danger-text" (click)="removeGroup(group)">Usuń</button>
            </div>

            @for (task of group.tasks; track task.id) {
              <div class="task" [class.overdue]="task.status === 'overdue'" [class.due]="task.status === 'due_today'">
                <div class="task-main">
                  <strong>{{ task.title }}</strong>
                  <span class="status">{{ statusLabel(task) }}</span>
                  <p class="muted">
                    {{ recurrenceLabel(task) }}
                    · następny: {{ task.nextDueDate || '—' }}
                    @if (task.lastDoneAt) {
                      · ostatnio: {{ task.lastDoneAt.slice(0, 10) }}
                    }
                  </p>
                  @if (task.notes) {
                    <p class="notes">{{ task.notes }}</p>
                  }
                </div>
                <div class="task-actions">
                  <label>
                    Następna data
                    <input type="date" [(ngModel)]="nextDates[task.id]" [name]="'due' + task.id" />
                  </label>
                  <button type="button" (click)="complete(task)">Wykonano</button>
                  <button type="button" class="ghost" (click)="saveNextDate(task)">Ustaw datę</button>
                  <button type="button" class="ghost danger-text" (click)="removeTask(task)">Usuń</button>
                </div>
              </div>
            } @empty {
              <p class="muted">Brak zadań w tej grupie.</p>
            }
          </article>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .shell { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
      .top { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
      .brand { margin: 0; font-family: var(--font-display); font-size: 2rem; letter-spacing: -0.03em; }
      .sub { margin: 0.35rem 0 0; color: var(--muted); display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
      nav { display: flex; gap: 0.85rem; align-items: center; }
      nav a { color: var(--text); text-decoration: none; font-weight: 600; }
      .linkish { border: 0; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
      .pill { display: inline-flex; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.75rem; background: color-mix(in srgb, var(--danger) 22%, transparent); color: var(--danger); }
      .banner { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); padding: 0.75rem 1rem; border-radius: 10px; }
      .due-box, .group, .form { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 1rem 1.1rem; margin-bottom: 1rem; }
      .due-row, .task { display: flex; justify-content: space-between; gap: 1rem; align-items: center; padding: 0.75rem 0; border-top: 1px solid var(--line); flex-wrap: wrap; }
      .due-row:first-of-type, .task:first-of-type { border-top: 0; }
      .due-row.overdue, .task.overdue { background: color-mix(in srgb, var(--danger) 8%, transparent); margin: 0 -0.5rem; padding-left: 0.5rem; padding-right: 0.5rem; border-radius: 8px; }
      .task.due { background: color-mix(in srgb, var(--accent) 8%, transparent); margin: 0 -0.5rem; padding-left: 0.5rem; padding-right: 0.5rem; border-radius: 8px; }
      .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: center; }
      .import-btn {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0.5rem 0.75rem;
        font-size: 0.85rem;
        cursor: pointer;
        color: var(--text);
      }
      .ok-banner {
        background: color-mix(in srgb, var(--ok) 15%, transparent);
        color: var(--ok);
        padding: 0.75rem 1rem;
        border-radius: 10px;
      }
      .group-head { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
      h2, h3 { margin: 0 0 0.5rem; }
      .muted { color: var(--muted); font-size: 0.9rem; margin: 0.2rem 0; }
      .notes { margin: 0.25rem 0 0; font-size: 0.9rem; }
      .status { margin-left: 0.5rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
      .task-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: end; }
      label { display: grid; gap: 0.25rem; font-size: 0.8rem; color: var(--muted); }
      label.check { display: flex; align-items: center; gap: 0.4rem; }
      input, select { border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 8px; padding: 0.45rem 0.55rem; font: inherit; }
      button { border: 0; border-radius: 8px; padding: 0.5rem 0.75rem; background: var(--accent); color: #fff; font: inherit; font-size: 0.85rem; cursor: pointer; }
      button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
      .danger-text { color: var(--danger); }
      .form { display: grid; gap: 0.65rem; }
      @media (max-width: 640px) { .top { flex-direction: column; } }
    `,
  ],
})
export class ChoresComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  groups: ChoreGroup[] = [];
  due: ChoreTask[] = [];
  dueCount = 0;
  error = '';
  importMsg = '';
  showNewGroup = false;
  showNewTask = false;
  nextDates: Record<number, string> = {};

  newGroup = { name: '', description: '' };
  newTask: {
    groupId: number | null;
    title: string;
    notes: string;
    recurrenceType: RecurrenceType;
    recurrenceInterval: number;
    weekday: number;
    nextDueDate: string;
    notifyEmail: boolean;
  } = {
    groupId: null,
    title: '',
    notes: '',
    recurrenceType: 'every_n_days',
    recurrenceInterval: 7,
    weekday: 6,
    nextDueDate: '',
    notifyEmail: true,
  };

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.choreGroups().subscribe({
      next: (groups) => {
        this.groups = groups;
        this.error = '';
        if (this.newTask.groupId == null && groups[0]) {
          this.newTask.groupId = groups[0].id;
        }
        for (const g of groups) {
          for (const t of g.tasks) {
            if (t.nextDueDate && this.nextDates[t.id] === undefined) {
              this.nextDates[t.id] = t.nextDueDate;
            }
          }
        }
      },
      error: () => (this.error = 'Nie udało się pobrać zadań.'),
    });
    this.api.choreDue().subscribe({
      next: (due) => {
        this.due = due;
        this.dueCount = due.length;
      },
    });
  }

  statusLabel(task: ChoreTask): string {
    switch (task.status) {
      case 'overdue':
        return 'zaległe';
      case 'due_today':
        return 'dziś';
      case 'upcoming':
        return 'zaplanowane';
      case 'done':
        return 'zakończone';
      default:
        return 'wyłączone';
    }
  }

  recurrenceLabel(task: ChoreTask): string {
    switch (task.recurrenceType) {
      case 'daily':
        return task.recurrenceInterval > 1 ? `co ${task.recurrenceInterval} dni` : 'codziennie';
      case 'every_n_days':
        return `co ${task.recurrenceInterval} dni`;
      case 'weekly': {
        const days = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
        return `co tydzień (${days[task.weekday ?? 6]})`;
      }
      case 'calendar':
        return `kalendarz (${task.calendarDates?.length ?? 0} dat)`;
      case 'once':
        return 'jednorazowo';
    }
  }

  createGroup(): void {
    this.api.createChoreGroup(this.newGroup).subscribe({
      next: () => {
        this.newGroup = { name: '', description: '' };
        this.showNewGroup = false;
        this.reload();
      },
      error: () => (this.error = 'Nie udało się dodać grupy.'),
    });
  }

  createTask(): void {
    if (!this.newTask.groupId || !this.newTask.title.trim()) return;
    this.api
      .createChoreTask({
        groupId: this.newTask.groupId,
        title: this.newTask.title,
        notes: this.newTask.notes,
        recurrenceType: this.newTask.recurrenceType,
        recurrenceInterval: this.newTask.recurrenceInterval,
        weekday: this.newTask.recurrenceType === 'weekly' ? this.newTask.weekday : null,
        nextDueDate: this.newTask.nextDueDate || null,
        notifyEmail: this.newTask.notifyEmail,
      })
      .subscribe({
        next: () => {
          this.newTask.title = '';
          this.newTask.notes = '';
          this.newTask.nextDueDate = '';
          this.showNewTask = false;
          this.reload();
        },
        error: () => (this.error = 'Nie udało się dodać zadania.'),
      });
  }

  complete(task: ChoreTask): void {
    const nextDueDate = this.nextDates[task.id] || undefined;
    // If user changed next date manually before complete, use it; else auto
    const body =
      nextDueDate && nextDueDate !== task.nextDueDate
        ? { nextDueDate }
        : {};
    this.api.completeChoreTask(task.id, body).subscribe({
      next: () => this.reload(),
      error: () => (this.error = 'Nie udało się oznaczyć jako wykonane.'),
    });
  }

  saveNextDate(task: ChoreTask): void {
    const nextDueDate = this.nextDates[task.id] || null;
    this.api.updateChoreTask(task.id, { nextDueDate }).subscribe({
      next: () => this.reload(),
      error: () => (this.error = 'Nie udało się ustawić daty.'),
    });
  }

  removeTask(task: ChoreTask): void {
    if (!confirm(`Usunąć zadanie „${task.title}”?`)) return;
    this.api.deleteChoreTask(task.id).subscribe({
      next: () => this.reload(),
      error: () => (this.error = 'Usuwanie zadania nieudane.'),
    });
  }

  removeGroup(group: ChoreGroup): void {
    if (!confirm(`Usunąć grupę „${group.name}” i wszystkie jej zadania?`)) return;
    this.api.deleteChoreGroup(group.id).subscribe({
      next: () => this.reload(),
      error: () => (this.error = 'Usuwanie grupy nieudane.'),
    });
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error = '';
    this.importMsg = '';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        this.api.importChores(payload).subscribe({
          next: (res) => {
            this.importMsg = `Import OK — grupy +${res.groupsCreated}/~${res.groupsUpdated}, zadania +${res.tasksCreated}/~${res.tasksUpdated}`;
            this.reload();
          },
          error: () => (this.error = 'Import JSON nieudany.'),
        });
      } catch {
        this.error = 'Niepoprawny plik JSON.';
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  logout(): void {
    clearAuth();
    void this.router.navigateByUrl('/login');
  }
}
