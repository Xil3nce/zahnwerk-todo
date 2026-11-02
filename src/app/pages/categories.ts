import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Category } from '../core/models';
import { Store } from '../core/store';

@Component({
  selector: 'app-categories',
  imports: [FormsModule],
  template: `
    <h1>Kategorien</h1>
    <ul class="plain">
      @for (c of store.categories(); track c.id) {
        <li class="card row">
          <input class="grow" [attr.aria-label]="'Name von ' + c.name" maxlength="80" [ngModel]="c.name" [ngModelOptions]="{ standalone: true, updateOn: 'blur' }"
            (ngModelChange)="rename(c, $event)" />
          <button type="button" [attr.aria-label]="c.name + ' löschen'" (click)="remove(c)">Löschen</button>
        </li>
      }
    </ul>
    <form class="row" (ngSubmit)="add()">
      <input class="grow" name="name" aria-label="Neue Kategorie" placeholder="Neue Kategorie" maxlength="80" [(ngModel)]="name" />
      <button type="submit" [disabled]="!name().trim()">Hinzufügen</button>
    </form>
  `,
})
export class Categories {
  protected readonly store = inject(Store);
  protected readonly name = signal('');

  protected async add(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    this.name.set('');
    await this.store.addCategory(name);
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
