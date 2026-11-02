import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatEffort, relativeDue } from '../core/due';
import { Todo } from '../core/models';
import { Store } from '../core/store';
import { DEFAULT_FILTERS, Filters, selectTodos, SortBy, View } from '../core/views';

const PULL_THRESHOLD = 70;

@Component({
  selector: 'app-todo-list',
  imports: [FormsModule, RouterLink],
  template: `
    <div (touchstart)="touchStart($event)" (touchmove)="touchMove($event)" (touchend)="touchEnd()">
      @if (pull() > 0 || store.syncing()) {
        <p class="sync-hint" role="status">
          {{ store.syncing() ? 'Wird synchronisiert…' : pull() >= threshold ? 'Loslassen zum Aktualisieren' : 'Weiter ziehen…' }}
        </p>
      }

      <header class="row between">
        <h1>Aufgaben</h1>
        <button type="button" (click)="store.sync()" [disabled]="store.syncing()">Aktualisieren</button>
      </header>

      @if (store.syncError(); as message) { <p class="notice" role="status">{{ message }}</p> }
      @if (store.pendingCount() > 0) { <p class="notice">{{ store.pendingCount() }} Änderung(en) warten auf Übertragung.</p> }

      <div class="segmented" role="group" aria-label="Ansicht">
        @for (option of views; track option.id) {
          <button type="button" [class.active]="view() === option.id" [attr.aria-pressed]="view() === option.id" (click)="view.set(option.id)">
            {{ option.label }}
          </button>
        }
      </div>

      <details class="card filters">
        <summary>Filter und Sortierung{{ filtersActive() ? ' (aktiv)' : '' }}</summary>
        <div class="stack">
          <label>Person
            <select [ngModel]="filters().person" (ngModelChange)="setFilter('person', $event)">
              <option value="any">Alle</option>
              @for (p of store.profiles(); track p.id) { <option [value]="p.id">{{ p.display_name }}</option> }
              <option value="both">Nur „Beide“</option>
            </select>
          </label>
          <label>Kategorie
            <select [ngModel]="filters().category" (ngModelChange)="setFilter('category', $event)">
              <option value="any">Alle</option>
              @for (c of store.categories(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
              <option value="none">Ohne Kategorie</option>
            </select>
          </label>
          <label>Fälligkeit
            <select [ngModel]="filters().due" (ngModelChange)="setFilter('due', $event)">
              <option value="any">Alle</option>
              <option value="overdue">Überfällig</option>
              <option value="today">Heute</option>
              <option value="this_week">Diese Woche</option>
              <option value="next_week">Nächste Woche</option>
              <option value="none">Ohne Datum</option>
            </select>
          </label>
          @if (view() === 'all') {
            <label>Status
              <select [ngModel]="filters().status" (ngModelChange)="setFilter('status', $event)">
                <option value="open">Offen</option>
                <option value="done">Erledigt</option>
                <option value="any">Alle</option>
              </select>
            </label>
          }
          <label>Sortierung
            <select [ngModel]="sort()" (ngModelChange)="sort.set($event)">
              <option value="due">Fälligkeit</option>
              <option value="category">Kategorie</option>
              <option value="effort">Aufwand</option>
            </select>
          </label>
          <button type="button" (click)="filters.set(defaults)">Filter zurücksetzen</button>
        </div>
      </details>

      <ul class="todo-list">
        @for (todo of visible(); track todo.id) {
          <li class="card todo" [class.done]="todo.status === 'done'">
            <input type="checkbox" class="gear-check" [checked]="todo.status === 'done'"
              [attr.aria-label]="todo.title + (todo.status === 'done' ? ' wieder öffnen' : ' erledigen')"
              (change)="store.toggleDone(todo)" />
            <a [routerLink]="['/aufgabe', todo.id]">
              <strong>{{ todo.title }}</strong>
              <span class="meta" [class.overdue]="isOverdue(todo)">{{ due(todo) }}</span>
              <span class="meta">
                {{ assignee(todo) }} · {{ store.categoryName(todo.category_id) }}@if (todo.effort_minutes) { · {{ effort(todo.effort_minutes) }} }
              </span>
            </a>
          </li>
        } @empty {
          <li class="empty">Hier ist alles erledigt. Das Zahnwerk ruht.</li>
        }
      </ul>

      <a class="fab" routerLink="/neu" aria-label="Neue Aufgabe">+</a>
    </div>
  `,
})
export class TodoList {
  protected readonly store = inject(Store);
  protected readonly threshold = PULL_THRESHOLD;
  protected readonly defaults = DEFAULT_FILTERS;
  protected readonly views: { id: View; label: string }[] = [
    { id: 'today', label: 'Heute' },
    { id: 'week', label: 'Diese Woche' },
    { id: 'all', label: 'Alle' },
  ];

  protected readonly view = signal<View>('today');
  protected readonly filters = signal<Filters>(DEFAULT_FILTERS);
  protected readonly sort = signal<SortBy>('due');
  protected readonly pull = signal(0);
  private touchStartY: number | null = null;

  protected readonly visible = computed(() =>
    selectTodos(this.store.todos(), this.view(), this.filters(), this.sort(), this.store.today(), this.store.categories()),
  );
  protected readonly filtersActive = computed(() => JSON.stringify(this.filters()) !== JSON.stringify(DEFAULT_FILTERS));
  protected readonly effort = formatEffort;

  protected setFilter<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this.filters.update((f) => ({ ...f, [key]: value }));
  }

  protected due(todo: Todo): string {
    return relativeDue(todo.due_date, this.store.today());
  }

  protected isOverdue(todo: Todo): boolean {
    return todo.status === 'open' && !!todo.due_date && todo.due_date < this.store.today();
  }

  protected assignee(todo: Todo): string {
    return todo.assignee_id ? (this.store.profiles().find((p) => p.id === todo.assignee_id)?.display_name ?? '?') : 'Beide';
  }

  protected touchStart(event: TouchEvent): void {
    this.touchStartY = window.scrollY === 0 ? event.touches[0].clientY : null;
  }

  protected touchMove(event: TouchEvent): void {
    if (this.touchStartY !== null) this.pull.set(Math.max(0, event.touches[0].clientY - this.touchStartY));
  }

  protected touchEnd(): void {
    if (this.pull() >= PULL_THRESHOLD) void this.store.sync();
    this.pull.set(0);
    this.touchStartY = null;
  }
}
