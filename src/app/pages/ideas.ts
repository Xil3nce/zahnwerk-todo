import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Store } from '../core/store';
import { openIdeas } from '../core/views';
import { appendSpoken, Voice } from '../core/voice';

/** Ideen-Parkplatz: "Wollen wir mal machen" – Ausfluege, Restaurants, Filme. Ohne Faelligkeit, ohne Druck. */
@Component({
  selector: 'app-ideas',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Ideen</h1>
    <p class="meta">Wollen wir mal machen: Ausflüge, Restaurants, Filme … ohne Fälligkeit und ohne Druck.</p>

    <form class="row" (ngSubmit)="add()">
      <input class="grow" name="idea" aria-label="Neue Idee" placeholder="Neue Idee" maxlength="200" [(ngModel)]="title" />
      @if (voice.supported) {
        <button type="button" class="mic" aria-label="Idee sprechen" [class.active]="voice.listening() === 'idea'"
          [disabled]="!!voice.listening()" (click)="dictate()">🎤</button>
      }
      <button type="submit" [disabled]="!title().trim()">Parken</button>
    </form>
    @if (voice.error(); as message) { <p class="error" role="alert">{{ message }}</p> }

    <ul class="todo-list">
      @for (idea of ideas(); track idea.id) {
        <li class="card todo" [class.tinted]="store.categoryColor(idea.category_id)" [style.--category-color]="store.categoryColor(idea.category_id)">
          <input type="checkbox" class="gear-check" [checked]="false" [attr.aria-label]="idea.title + ' gemacht'" (change)="store.toggleDone(idea)" />
          <a [routerLink]="['/aufgabe', idea.id]">
            <strong>@if (idea.important) { <span class="star" aria-label="Wichtig">★</span> }{{ idea.title }}</strong>
            @if (idea.description) { <span class="meta">{{ idea.description }}</span> }
            <span class="meta">Geparkt von {{ name(idea.created_by) }}@if (idea.category_id) { · {{ store.categoryName(idea.category_id) }} }</span>
          </a>
        </li>
      } @empty {
        <li class="empty">Noch keine Ideen geparkt.</li>
      }
    </ul>
    <p class="meta">Gemachtes landet unter Aufgaben → Erledigt.</p>

    <a class="fab" routerLink="/neu" [queryParams]="{ ablage: 'idee' }" aria-label="Neue Idee mit Details">+</a>
  `,
})
export class Ideas {
  protected readonly store = inject(Store);
  protected readonly voice = inject(Voice);
  protected readonly title = signal('');
  protected readonly ideas = computed(() => openIdeas(this.store.todos()));

  protected name(profileId: string): string {
    return this.store.profiles().find((p) => p.id === profileId)?.display_name ?? '?';
  }

  protected async add(): Promise<void> {
    const title = this.title().trim();
    if (!title) return;
    this.title.set('');
    await this.store.createTodo({ title, bucket: 'idea' });
  }

  protected async dictate(): Promise<void> {
    const spoken = await this.voice.listen('idea');
    if (spoken) this.title.set(appendSpoken(this.title(), spoken));
  }
}
