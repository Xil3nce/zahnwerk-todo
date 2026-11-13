import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatEffort, relativeDue } from '../core/due';
import { Todo } from '../core/models';
import { Store } from '../core/store';
import { suggestForTime } from '../core/views';

const MINUTE_OPTIONS = [10, 15, 30, 45, 60, 90, 120, 180];

/** "Ich hab X Minuten": passende Aufgaben nach Zeitaufwand vorschlagen, Dringendes zuerst. */
@Component({
  selector: 'app-time',
  imports: [FormsModule, RouterLink],
  template: `
    <a routerLink="/">← Zurück</a>
    <h1>Ich hab Zeit</h1>
    <p class="meta">Wähle, wie viel Zeit du gerade hast. Vorgeschlagen werden offene Aufgaben mit passendem Zeitaufwand, Überfälliges und Heutiges zuerst.</p>

    <fieldset>
      <legend>Verfügbare Zeit</legend>
      <div class="chips">
        @for (m of options; track m) {
          <button type="button" class="chip" [class.active]="minutes() === m" [attr.aria-pressed]="minutes() === m" (click)="minutes.set(m)">
            {{ effort(m) }}
          </button>
        }
      </div>
    </fieldset>
    <label>Für wen
      <select [ngModel]="person()" (ngModelChange)="picked.set($event)">
        @for (p of store.profiles(); track p.id) { <option [value]="p.id">{{ p.display_name }} (mit „Beide“)</option> }
        <option value="any">Alle Aufgaben</option>
      </select>
    </label>

    <h2>Vorschlag für {{ effort(minutes()) }}</h2>
    @if (result().plan.length) {
      <p class="meta" role="status">{{ result().plan.length }} Aufgabe(n), zusammen {{ effort(result().planMinutes) }}</p>
    }
    <ul class="todo-list">
      @for (todo of result().plan; track todo.id) {
        <li class="card todo" [class.tinted]="store.categoryColor(todo.category_id)" [style.--category-color]="store.categoryColor(todo.category_id)">
          <input type="checkbox" class="gear-check" [checked]="false" [attr.aria-label]="todo.title + ' erledigen'" (change)="store.toggleDone(todo)" />
          <a [routerLink]="['/aufgabe', todo.id]">
            <strong>@if (todo.important) { <span class="star" aria-label="Wichtig">★</span> }{{ todo.title }}</strong>
            <span class="meta" [class.overdue]="overdue(todo)">{{ effort(todo.effort_minutes) }} · {{ due(todo) }}</span>
          </a>
        </li>
      } @empty {
        <li class="empty">Keine offene Aufgabe passt in {{ effort(minutes()) }}.</li>
      }
    </ul>

    @if (result().others.length) {
      <h2>Passt auch einzeln</h2>
      <ul class="todo-list">
        @for (todo of result().others; track todo.id) {
          <li class="card todo" [class.tinted]="store.categoryColor(todo.category_id)" [style.--category-color]="store.categoryColor(todo.category_id)">
            <input type="checkbox" class="gear-check" [checked]="false" [attr.aria-label]="todo.title + ' erledigen'" (change)="store.toggleDone(todo)" />
            <a [routerLink]="['/aufgabe', todo.id]">
              <strong>@if (todo.important) { <span class="star" aria-label="Wichtig">★</span> }{{ todo.title }}</strong>
              <span class="meta" [class.overdue]="overdue(todo)">{{ effort(todo.effort_minutes) }} · {{ due(todo) }}</span>
            </a>
          </li>
        }
      </ul>
    }

    @if (result().withoutEffort) {
      <p class="notice">{{ result().withoutEffort }} offene Aufgabe(n) haben keinen Zeitaufwand und können nicht vorgeschlagen werden. Trag ihn beim Bearbeiten ein.</p>
    }
  `,
})
export class Time {
  protected readonly store = inject(Store);
  protected readonly options = MINUTE_OPTIONS;
  protected readonly minutes = signal(30);
  /** Startet bei der angemeldeten Person; "any" zeigt alles. */
  protected readonly picked = signal<string | null>(null);
  protected readonly person = computed(() => this.picked() ?? this.store.me()?.id ?? 'any');
  protected readonly effort = formatEffort;

  protected readonly result = computed(() =>
    suggestForTime(this.store.todos(), this.minutes(), this.person(), this.store.today()),
  );

  protected due(todo: Todo): string {
    return relativeDue(todo.due_date, this.store.today(), todo.due_window);
  }

  protected overdue(todo: Todo): boolean {
    return !!todo.due_date && todo.due_date < this.store.today();
  }
}
