import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Category } from '../core/models';
import { CATEGORY_COLORS, colorName } from '../core/palette';
import { Store } from '../core/store';

@Component({
  selector: 'app-categories',
  imports: [FormsModule],
  template: `
    <h1>Kategorien</h1>
    <ul class="plain">
      @for (c of store.categories(); track c.id) {
        <li class="card">
          <div class="row">
            <button type="button" class="swatch-button" [attr.aria-expanded]="open() === c.id"
              [attr.aria-label]="'Farbe von ' + c.name + ': ' + (colorLabel(c.color) ?? 'keine') + '. Ändern'"
              (click)="open.set(open() === c.id ? null : c.id)">
              <span class="swatch" [class.no-color]="!c.color" [style.background]="c.color ?? null"></span>
            </button>
            <input class="grow" [attr.aria-label]="'Name von ' + c.name" maxlength="80" [ngModel]="c.name" [ngModelOptions]="{ standalone: true, updateOn: 'blur' }"
              (ngModelChange)="rename(c, $event)" />
            <button type="button" [attr.aria-label]="c.name + ' löschen'" (click)="remove(c)">Löschen</button>
          </div>
          @if (open() === c.id) {
            <div class="palette" role="group" [attr.aria-label]="'Farbe für ' + c.name">
              <button type="button" class="palette-none" [attr.aria-pressed]="!c.color" (click)="pick(c, null)">Keine Farbe</button>
              @for (color of colors; track color.hex) {
                <button type="button" class="palette-cell" [attr.aria-label]="color.name" [title]="color.name"
                  [attr.aria-pressed]="c.color === color.hex" (click)="pick(c, color.hex)">
                  <span class="swatch" [style.background]="color.hex"></span>
                </button>
              }
            </div>
          }
        </li>
      }
    </ul>
    <form class="row" (ngSubmit)="add()">
      <input class="grow" name="name" aria-label="Neue Kategorie" placeholder="Neue Kategorie" maxlength="80" [(ngModel)]="name" />
      <button type="submit" [disabled]="!name().trim()">Hinzufügen</button>
    </form>
    <p class="meta">Tippe auf den Farbkreis, um einer Kategorie eine Farbe zu geben.</p>
  `,
})
export class Categories {
  protected readonly store = inject(Store);
  protected readonly name = signal('');
  protected readonly open = signal<string | null>(null);
  protected readonly colors = CATEGORY_COLORS;
  protected readonly colorLabel = colorName;

  protected async add(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    this.name.set('');
    await this.store.addCategory(name);
  }

  protected async pick(category: Category, color: string | null): Promise<void> {
    this.open.set(null);
    if ((category.color ?? null) !== color) await this.store.setCategoryColor(category, color);
  }

  protected async rename(category: Category, value: string): Promise<void> {
    const name = value.trim();
    if (name && name !== category.name) await this.store.renameCategory(category, name);
  }

  protected async remove(category: Category): Promise<void> {
    if (confirm(`„${category.name}“ löschen? Die Aufgaben bleiben erhalten und stehen dann unter „Ohne Kategorie“.`)) {
      await this.store.deleteCategory(category);
    }
  }
}
