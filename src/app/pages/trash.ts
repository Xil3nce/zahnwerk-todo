import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Store } from '../core/store';
import { TRASH_DAYS, trashTodos } from '../core/views';

/** Geloeschte Aufgaben bleiben 30 Tage wiederherstellbar; danach entfernt sie der naechtliche Cleanup. */
@Component({
  selector: 'app-trash',
  imports: [DatePipe, RouterLink],
  template: `
    <a routerLink="/">← Zurück</a>
    <h1>Papierkorb</h1>
    <p class="meta">Gelöschte Aufgaben lassen sich {{ days }} Tage lang wiederherstellen, danach werden sie endgültig entfernt.</p>

    <ul class="todo-list">
      @for (entry of entries(); track entry.todo.id) {
        <li class="card stack">
          <strong>{{ entry.todo.title }}</strong>
          <span class="meta">
            Gelöscht am {{ entry.todo.deleted_at | date: 'dd.MM.yyyy, HH:mm' : tz }} Uhr ·
            {{ entry.daysLeft === 1 ? 'noch 1 Tag' : 'noch ' + entry.daysLeft + ' Tage' }}
          </span>
          <button type="button" (click)="restore(entry.todo.id)">Wiederherstellen</button>
        </li>
      } @empty {
        <li class="empty">Der Papierkorb ist leer.</li>
      }
    </ul>
  `,
})
export class Trash {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);
  protected readonly days = TRASH_DAYS;
  protected readonly tz = 'Europe/Berlin';
  /** Neu berechnet bei jedem Oeffnen; die Tage zaehlen ab dem Loeschzeitpunkt. */
  private readonly now = signal(new Date());
  protected readonly entries = computed(() => trashTodos(this.store.todos(), this.now()));

  protected async restore(id: string): Promise<void> {
    await this.store.restoreTodo(id);
    await this.router.navigate(['/aufgabe', id]);
  }
}
