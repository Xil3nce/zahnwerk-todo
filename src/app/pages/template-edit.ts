import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { formatEffort } from '../core/due';
import { Store } from '../core/store';

const EFFORT_OPTIONS = [5, 10, 15, 30, 45, 60, 120, 180];
const MAX_ITEMS = 100;

/** Vorlage anlegen oder bearbeiten: Titel, Beschreibung, Kategorie, Zeitaufwand, Wichtig und Checkliste. */
@Component({
  selector: 'app-template-edit',
  imports: [FormsModule, RouterLink],
  template: `
    @if (missing()) {
      <p>Diese Vorlage gibt es nicht mehr.</p>
      <a routerLink="/vorlagen">Zu den Vorlagen</a>
    } @else {
      <h1>{{ id ? 'Vorlage bearbeiten' : 'Neue Vorlage' }}</h1>
      <form class="stack" (ngSubmit)="save()">
        <label>Titel der Aufgabe
          <input name="title" required maxlength="200" [(ngModel)]="title" />
        </label>
        <label>Beschreibung
          <textarea name="description" rows="3" maxlength="4000" [(ngModel)]="description"></textarea>
        </label>
        <label class="check">
          <input type="checkbox" name="important" [(ngModel)]="important" />
          ★ Wichtig
        </label>
        <label>Kategorie
          <select name="category" [(ngModel)]="categoryId">
            <option [ngValue]="null">Ohne Kategorie</option>
            @for (c of store.categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
          </select>
        </label>
        <fieldset>
          <legend>Zeitaufwand</legend>
          <div class="chips">
            @for (m of efforts; track m) {
              <button type="button" class="chip" [class.active]="effortMinutes() === m" (click)="effortMinutes.set(m)">{{ effort(m) }}</button>
            }
            <button type="button" class="chip" [class.active]="!effortMinutes()" (click)="effortMinutes.set(null)">Keine Angabe</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Checkliste</legend>
          <ul class="plain">
            @for (item of items(); track $index; let i = $index) {
              <li class="row">
                <input class="grow" [attr.aria-label]="'Punkt ' + (i + 1)" maxlength="200" [ngModel]="item"
                  [ngModelOptions]="{ standalone: true }" (ngModelChange)="setItem(i, $event)" />
                <button type="button" [attr.aria-label]="'Punkt ' + (i + 1) + ' nach oben'" [disabled]="i === 0" (click)="move(i, -1)">↑</button>
                <button type="button" [attr.aria-label]="'Punkt ' + (i + 1) + ' entfernen'" (click)="removeItem(i)">×</button>
              </li>
            }
          </ul>
          <div class="row">
            <input class="grow" name="newItem" aria-label="Neuer Punkt" placeholder="Neuer Punkt" maxlength="200"
              [(ngModel)]="newItem" (keydown.enter)="$event.preventDefault(); addItem()" />
            <button type="button" [disabled]="!newItem().trim() || items().length >= maxItems" (click)="addItem()">Hinzufügen</button>
          </div>
        </fieldset>

        <div class="row between">
          <button class="primary" type="submit" [disabled]="!title().trim()">Speichern</button>
          <a class="button" routerLink="/vorlagen">Abbrechen</a>
        </div>
      </form>
      @if (id) {
        <button class="danger" type="button" (click)="remove()">Vorlage löschen</button>
      }
    }
  `,
})
export class TemplateEdit implements OnInit {
  protected readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly efforts = EFFORT_OPTIONS;
  protected readonly maxItems = MAX_ITEMS;
  protected readonly effort = formatEffort;

  protected id: string | null = null;
  protected readonly missing = signal(false);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly important = signal(false);
  protected readonly categoryId = signal<string | null>(null);
  protected readonly effortMinutes = signal<number | null>(null);
  protected readonly items = signal<string[]>([]);
  protected readonly newItem = signal('');

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    if (!this.id) return;
    const tpl = this.store.template(this.id);
    if (!tpl) {
      this.missing.set(true);
      return;
    }
    this.title.set(tpl.title);
    this.description.set(tpl.description);
    this.important.set(tpl.important);
    this.categoryId.set(this.store.categories().some((c) => c.id === tpl.category_id) ? tpl.category_id : null);
    this.effortMinutes.set(tpl.effort_minutes);
    this.items.set([...tpl.items]);
  }

  protected addItem(): void {
    const text = this.newItem().trim();
    if (!text || this.items().length >= MAX_ITEMS) return;
    this.items.update((list) => [...list, text]);
    this.newItem.set('');
  }

  protected setItem(index: number, text: string): void {
    this.items.update((list) => list.map((item, i) => (i === index ? text : item)));
  }

  protected removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  protected move(index: number, delta: number): void {
    this.items.update((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  protected async save(): Promise<void> {
    const title = this.title().trim();
    if (!title) return;
    // Ein noch nicht uebernommener Punkt im Eingabefeld soll nicht verloren gehen.
    this.addItem();
    const items = this.items().map((i) => i.trim()).filter(Boolean).slice(0, MAX_ITEMS);
    const existing = this.id ? this.store.template(this.id) : undefined;
    const id = this.id ?? crypto.randomUUID();
    await this.store.saveTemplate({
      id, title, description: this.description().trim(), category_id: this.categoryId(),
      effort_minutes: this.effortMinutes(), important: this.important(), items, deleted_at: existing?.deleted_at ?? null,
    });
    await this.router.navigate(['/vorlagen']);
  }

  protected async remove(): Promise<void> {
    const tpl = this.id ? this.store.template(this.id) : undefined;
    if (!tpl || !confirm(`Vorlage „${tpl.title}“ löschen? Bereits gestartete Aufgaben bleiben erhalten.`)) return;
    await this.store.deleteTemplate(tpl);
    await this.router.navigate(['/vorlagen']);
  }
}
