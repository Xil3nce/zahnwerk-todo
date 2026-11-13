import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatEffort } from '../core/due';
import { Template } from '../core/models';
import { Store } from '../core/store';

/** Vorlagen: wiederkehrende Ablaeufe mit Checkliste, z. B. "Urlaub packen" oder "Wohnung putzen". */
@Component({
  selector: 'app-templates',
  imports: [RouterLink],
  template: `
    <a routerLink="/">← Zurück</a>
    <h1>Vorlagen</h1>
    <p class="meta">Abläufe, die immer wieder vorkommen. „Starten“ legt eine neue Aufgabe mit der Checkliste als Unteraufgaben an.</p>

    <ul class="plain">
      @for (t of store.templates(); track t.id) {
        <li class="card todo" [class.tinted]="store.categoryColor(t.category_id)" [style.--category-color]="store.categoryColor(t.category_id)">
          <a [routerLink]="['/vorlagen', t.id]">
            <strong>@if (t.important) { <span class="star" aria-label="Wichtig">★</span> }{{ t.title }}</strong>
            <span class="meta">{{ summary(t) }}</span>
          </a>
          <button class="primary" type="button" [attr.aria-label]="t.title + ' starten'" (click)="start(t)">Starten</button>
        </li>
      } @empty {
        <li class="empty">Noch keine Vorlagen. Lege eine an oder speichere eine Aufgabe über „Als Vorlage speichern“.</li>
      }
    </ul>

    <a class="fab" routerLink="/vorlagen/neu" aria-label="Neue Vorlage">+</a>
  `,
})
export class Templates {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);

  protected summary(t: Template): string {
    const parts = [t.items.length === 1 ? '1 Punkt' : `${t.items.length} Punkte`];
    if (t.category_id && this.store.categories().some((c) => c.id === t.category_id)) parts.push(this.store.categoryName(t.category_id));
    if (t.effort_minutes) parts.push(formatEffort(t.effort_minutes));
    return parts.join(' · ');
  }

  /** Neue Aufgabe anlegen und gleich zum Bearbeiten, um Fälligkeit und Zuständigkeit festzulegen. */
  protected async start(t: Template): Promise<void> {
    const id = await this.store.startTemplate(t);
    await this.router.navigate(['/aufgabe', id, 'bearbeiten']);
  }
}
