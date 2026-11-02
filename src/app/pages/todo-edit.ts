import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DUE_PRESETS, DuePreset, formatDate, resolvePreset } from '../core/due';
import { TodoPatch } from '../core/models';
import { Store } from '../core/store';

const EFFORT_OPTIONS = [
  { minutes: 5, label: '5 Min.' },
  { minutes: 10, label: '10 Min.' },
  { minutes: 15, label: '15 Min.' },
  { minutes: 30, label: '30 Min.' },
  { minutes: 45, label: '45 Min.' },
  { minutes: 60, label: '1 Std.' },
  { minutes: 120, label: '2 Std.' },
  { minutes: 180, label: '3 Std.' },
];

@Component({
  selector: 'app-todo-edit',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>{{ id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe' }}</h1>
    <form class="stack" (ngSubmit)="save()">
      <label>Titel
        <input name="title" required maxlength="200" [(ngModel)]="title" />
      </label>
      <label>Beschreibung
        <textarea name="description" rows="3" [(ngModel)]="description"></textarea>
      </label>
      <label>Kategorie
        <select name="category" [(ngModel)]="categoryId">
          <option [ngValue]="null">Ohne Kategorie</option>
          @for (c of store.categories(); track c.id) { <option [ngValue]="c.id">{{ c.name }}</option> }
        </select>
      </label>
      <label>Zuständig
        <select name="assignee" [(ngModel)]="assigneeId">
          <option [ngValue]="null">Beide</option>
          @for (p of store.profiles(); track p.id) { <option [ngValue]="p.id">{{ p.display_name }}</option> }
        </select>
      </label>

      <fieldset>
        <legend>Fällig bis</legend>
        <div class="chips">
          @for (p of presets; track p.id) {
            <button type="button" class="chip" [class.active]="dueDate() === date(p.id)" (click)="dueDate.set(date(p.id))">{{ p.label }}</button>
          }
          <button type="button" class="chip" [class.active]="!dueDate()" (click)="dueDate.set(null)">Ohne Datum</button>
        </div>
        <label>Stichtag
          <input type="date" name="due" [ngModel]="dueDate()" (ngModelChange)="dueDate.set($event || null)" />
        </label>
        @if (dueDate(); as d) { <p class="meta">{{ format(d) }}</p> }
      </fieldset>

      <fieldset>
        <legend>Zeitaufwand</legend>
        <div class="chips">
          @for (e of efforts; track e.minutes) {
            <button type="button" class="chip" [class.active]="effortMinutes() === e.minutes" (click)="pickEffort(e.minutes)">{{ e.label }}</button>
          }
          <button type="button" class="chip" [class.active]="!effortMinutes()" (click)="pickEffort(null)">Keine Angabe</button>
        </div>
        <div class="row">
          <label class="grow">Frei
            <input type="number" name="customEffort" min="1" inputmode="numeric" [ngModel]="customAmount()" (ngModelChange)="customAmount.set($event)" />
          </label>
          <label>Einheit
            <select name="customUnit" [ngModel]="customUnit()" (ngModelChange)="customUnit.set($event)">
              <option value="min">Min.</option>
              <option value="h">Std.</option>
            </select>
          </label>
        </div>
      </fieldset>

      <div class="row between">
        <a class="button" [routerLink]="id ? ['/aufgabe', id] : ['/']">Abbrechen</a>
        <button class="primary" type="submit" [disabled]="!title().trim()">Speichern</button>
      </div>
    </form>
  `,
})
export class TodoEdit implements OnInit {
  protected readonly store = inject(Store);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly presets = DUE_PRESETS;
  protected readonly efforts = EFFORT_OPTIONS;
  protected readonly format = formatDate;
  protected id: string | null = null;

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly categoryId = signal<string | null>(null);
  protected readonly assigneeId = signal<string | null>(null);
  protected readonly dueDate = signal<string | null>(null);
  private readonly pickedEffort = signal<number | null>(null);
  protected readonly customAmount = signal<number | null>(null);
  protected readonly customUnit = signal<'min' | 'h'>('min');

  protected readonly effortMinutes = computed(() => {
    const amount = Number(this.customAmount());
    if (amount > 0) return Math.round(this.customUnit() === 'h' ? amount * 60 : amount);
    return this.pickedEffort();
  });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    const todo = this.id ? this.store.todo(this.id) : undefined;
    if (todo) {
      this.title.set(todo.title);
      this.description.set(todo.description);
      this.categoryId.set(todo.category_id);
      this.assigneeId.set(todo.assignee_id);
      this.dueDate.set(todo.due_date);
      this.pickedEffort.set(todo.effort_minutes);
    }
  }

  protected date(preset: DuePreset): string {
    return resolvePreset(preset, this.store.today());
  }

  protected pickEffort(minutes: number | null): void {
    this.customAmount.set(null);
    this.pickedEffort.set(minutes);
  }

  protected async save(): Promise<void> {
    const values: TodoPatch & { title: string } = {
      title: this.title().trim(),
      description: this.description(),
      category_id: this.categoryId(),
      assignee_id: this.assigneeId(),
      due_date: this.dueDate(),
      effort_minutes: this.effortMinutes(),
    };
    if (!values.title) return;

    const existing = this.id ? this.store.todo(this.id) : undefined;
    if (this.id && existing) {
      const patch = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => existing[key as keyof typeof existing] !== value),
      );
      await this.store.updateTodo(this.id, patch);
      await this.router.navigate(['/aufgabe', this.id]);
    } else {
      await this.store.createTodo(values);
      await this.router.navigate(['/']);
    }
  }
}
