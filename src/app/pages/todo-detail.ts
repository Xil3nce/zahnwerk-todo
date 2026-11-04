import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { formatDate, formatEffort, relativeDue } from '../core/due';
import { Store } from '../core/store';

@Component({
  selector: 'app-todo-detail',
  imports: [DatePipe, FormsModule, RouterLink],
  template: `
    @if (todo(); as t) {
      <a routerLink="/">← Zurück</a>
      <h1>{{ t.title }}</h1>

      <section class="card stack">
        @if (t.description) { <p class="pre">{{ t.description }}</p> }
        <dl class="facts">
          <dt>Fällig</dt>
          <dd>{{ due() }}@if (t.due_date) { <span class="meta"> ({{ format(t.due_date) }})</span> }</dd>
          <dt>Zuständig</dt><dd>{{ name(t.assignee_id) ?? 'Beide' }}</dd>
          <dt>Kategorie</dt><dd>@if (store.categoryColor(t.category_id); as color) { <span class="swatch small" aria-hidden="true" [style.background]="color"></span> }{{ store.categoryName(t.category_id) }}</dd>
          <dt>Zeitaufwand</dt><dd>{{ effort(t.effort_minutes) || 'Keine Angabe' }}</dd>
          <dt>Status</dt>
          <dd>
            @if (t.status === 'done') {
              Erledigt von {{ name(t.done_by) ?? '?' }}, {{ t.done_at | date: 'dd.MM.yyyy, HH:mm' : tz }} Uhr
            } @else { Offen }
          </dd>
        </dl>
        <div class="row between">
          <button class="primary" type="button" (click)="store.toggleDone(t)">
            {{ t.status === 'done' ? 'Wieder öffnen' : 'Erledigt' }}
          </button>
          <a class="button" [routerLink]="['/aufgabe', t.id, 'bearbeiten']">Bearbeiten</a>
        </div>
      </section>

      <section>
        <h2>Unteraufgaben</h2>
        <ul class="plain">
          @for (s of subtasks(); track s.id) {
            <li class="row between">
              <label class="check" [class.done]="s.is_done">
                <input type="checkbox" class="gear-check" [checked]="s.is_done" (change)="store.toggleSubtask(s)" />
                {{ s.title }}
              </label>
              <button type="button" [attr.aria-label]="s.title + ' löschen'" (click)="store.deleteSubtask(s)">×</button>
            </li>
          }
        </ul>
        <form class="row" (ngSubmit)="addSubtask()">
          <input class="grow" name="sub" aria-label="Neue Unteraufgabe" placeholder="Neue Unteraufgabe" maxlength="200" [(ngModel)]="newSubtask" />
          <button type="submit" [disabled]="!newSubtask().trim()">Hinzufügen</button>
        </form>
      </section>

      <section>
        <h2>Kommentare</h2>
        <ul class="plain">
          @for (c of comments(); track c.id) {
            <li class="card">
              <p class="meta">{{ name(c.author_id) ?? '?' }}, {{ c.created_at | date: 'dd.MM.yyyy, HH:mm' : tz }} Uhr</p>
              <p class="pre">{{ c.body }}</p>
              @if (c.author_id === store.me()?.id) {
                <button type="button" (click)="store.deleteComment(c)">Löschen</button>
              }
            </li>
          }
        </ul>
        <form class="stack" (ngSubmit)="addComment()">
          <textarea name="comment" rows="2" aria-label="Neuer Kommentar" placeholder="Kommentar schreiben" maxlength="4000" [(ngModel)]="newComment"></textarea>
          <button type="submit" [disabled]="!newComment().trim()">Kommentieren</button>
        </form>
      </section>

      <button class="danger" type="button" (click)="remove(t.id)">Aufgabe löschen</button>
    } @else {
      <p>Diese Aufgabe gibt es nicht mehr.</p>
      <a routerLink="/">Zur Übersicht</a>
    }
  `,
})
export class TodoDetail {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);

  /** Kommt aus der Route: aufgabe/:id */
  readonly id = input.required<string>();

  protected readonly tz = 'Europe/Berlin';
  protected readonly format = formatDate;
  protected readonly effort = formatEffort;
  protected readonly newSubtask = signal('');
  protected readonly newComment = signal('');

  protected readonly todo = computed(() => {
    const todo = this.store.todos().find((t) => t.id === this.id());
    return todo && !todo.deleted_at ? todo : null;
  });
  protected readonly subtasks = computed(() => this.store.subtasksOf(this.id()));
  protected readonly comments = computed(() => this.store.commentsOf(this.id()));
  protected readonly due = computed(() => relativeDue(this.todo()?.due_date ?? null, this.store.today()));

  protected name(profileId: string | null): string | null {
    return this.store.profiles().find((p) => p.id === profileId)?.display_name ?? null;
  }

  protected async addSubtask(): Promise<void> {
    const title = this.newSubtask().trim();
    if (!title) return;
    this.newSubtask.set('');
    await this.store.addSubtask(this.id(), title);
  }

  protected async addComment(): Promise<void> {
    const body = this.newComment().trim();
    if (!body) return;
    this.newComment.set('');
    await this.store.addComment(this.id(), body);
  }

  protected async remove(id: string): Promise<void> {
    if (!confirm('Diese Aufgabe wirklich löschen?')) return;
    await this.store.deleteTodo(id);
    await this.router.navigate(['/']);
  }
}
