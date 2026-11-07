import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  berlinParts, berlinToIso, describeRecurrence, DuePreset, formatDate, formatReminder, nextDue, relativeDue, resolvePreset,
  WINDOW_PRESETS, WindowPreset,
} from '../core/due';
import { Bucket, DueWindow, Recurrence, RecurrenceUnit, TodoPatch } from '../core/models';
import { Store } from '../core/store';
import { appendSpoken, Voice } from '../core/voice';

/** Feste Tage; "Diese Woche" und "Diesen Monat" sind jetzt Zeitfenster. */
const FIXED_PRESETS: { id: DuePreset; label: string }[] = [
  { id: 'today', label: 'Heute' },
  { id: 'tomorrow', label: 'Morgen' },
];

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

const INSTANT = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Fehlende Felder alter Daten gelten als null; Objekte (recurrence) werden unabhaengig von der
 * Schluesselreihenfolge verglichen, Zeitpunkte (remind_at) unabhaengig vom Format.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && INSTANT.test(a) && INSTANT.test(b)) return Date.parse(a) === Date.parse(b);
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return (a ?? null) === (b ?? null);
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k] === y[k]);
}

@Component({
  selector: 'app-todo-edit',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>{{ heading() }}</h1>
    <form class="stack" (ngSubmit)="save()">
      <div class="row">
        <label class="grow">Titel
          <input name="title" required maxlength="200" [(ngModel)]="title" />
        </label>
        @if (voice.supported) {
          <button type="button" class="mic" [class.active]="voice.listening() === 'title'" aria-label="Titel sprechen"
            [disabled]="!!voice.listening()" (click)="dictate('title')">🎤</button>
        }
      </div>
      <div class="row">
        <label class="grow">Beschreibung
          <textarea name="description" rows="3" [(ngModel)]="description"></textarea>
        </label>
        @if (voice.supported) {
          <button type="button" class="mic" [class.active]="voice.listening() === 'description'" aria-label="Beschreibung sprechen"
            [disabled]="!!voice.listening()" (click)="dictate('description')">🎤</button>
        }
      </div>
      @if (voice.listening()) { <p class="meta" role="status">Höre zu…</p> }
      @if (voice.error(); as message) { <p class="error" role="alert">{{ message }}</p> }
      <label class="check">
        <input type="checkbox" name="important" [ngModel]="important()" (ngModelChange)="important.set($event)" />
        ★ Wichtig
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

      @if (bucket() === 'idea') {
        <p class="meta">Ideen haben keine Fälligkeit und keine Erinnerung – ohne Druck.</p>
        <button type="button" (click)="bucket.set(null)">Als Aufgabe einplanen</button>
      } @else {
      <fieldset>
        <legend>Fällig bis</legend>
        <div class="chips">
          @for (p of fixedPresets; track p.id) {
            <button type="button" class="chip" [class.active]="!dueWindow() && dueDate() === date(p.id)" (click)="pickDate(date(p.id))">{{ p.label }}</button>
          }
          @for (p of windowPresets; track p.id) {
            <button type="button" class="chip" [class.active]="dueWindow() === p.window && dueDate() === date(p.id)" (click)="pickWindow(p.id, p.window)">{{ p.label }}</button>
          }
          <button type="button" class="chip" [class.active]="!dueDate()" (click)="pickNoDate(null)">Ohne Datum</button>
        </div>
        <label>Stichtag
          <input type="date" name="due" [ngModel]="dueWindow() ? null : dueDate()" (ngModelChange)="pickDate($event || null)" />
        </label>
        @if (dueDate(); as d) {
          <p class="meta">@if (dueWindow()) { {{ windowText() }}, spätestens }{{ format(d) }}</p>
        }
      </fieldset>

      <fieldset>
        <legend>Wiederholen</legend>
        <div class="row">
          <label class="grow">Rhythmus
            <select name="recurUnit" [ngModel]="recurUnit()" (ngModelChange)="recurUnit.set($event)">
              <option value="">Nicht wiederholen</option>
              <option value="day">Tage</option>
              <option value="week">Wochen</option>
              <option value="month">Monate</option>
            </select>
          </label>
          @if (recurUnit()) {
            <label>Alle
              <input type="number" name="recurEvery" min="1" max="365" inputmode="numeric" [ngModel]="recurEvery()" (ngModelChange)="recurEvery.set($event)" />
            </label>
          }
        </div>
        @if (recurrence(); as r) {
          <label class="check">
            <input type="radio" name="recurMode" value="schedule" [ngModel]="recurMode()" (ngModelChange)="recurMode.set($event)" />
            Fester Plan (vom Fälligkeitsdatum aus)
          </label>
          <label class="check">
            <input type="radio" name="recurMode" value="completion" [ngModel]="recurMode()" (ngModelChange)="recurMode.set($event)" />
            Ab dem Tag der Erledigung
          </label>
          <p class="meta">{{ describe(r) }}. Beim Erledigen entsteht automatisch die nächste Aufgabe, bei Erledigung heute fällig am {{ format(preview()!) }}.</p>
          @if (!dueDate() && r.mode === 'schedule') { <p class="meta">Ohne Fälligkeit zählt der Tag der Erledigung.</p> }
        } @else if (recurUnit()) {
          <p class="error" role="alert">Bitte eine ganze Zahl von 1 bis 365 eingeben.</p>
        }
      </fieldset>

      <fieldset>
        <legend>Erinnerung</legend>
        <div class="row">
          <label class="grow">Tag
            <input type="date" name="remindDate" [ngModel]="remindDate()" (ngModelChange)="remindDate.set($event || '')" />
          </label>
          <label>Uhrzeit
            <input type="time" name="remindTime" [ngModel]="remindTime()" (ngModelChange)="remindTime.set($event || '')" />
          </label>
        </div>
        @if (remindAt(); as at) {
          <p class="meta">Erinnerung am {{ formatReminder(at) }}, auf etwa 5 Minuten genau. Sie geht an die Zuständigen, bei „Beide“ an euch beide.</p>
          @if (isPast(at)) { <p class="notice">Dieser Zeitpunkt liegt in der Vergangenheit.</p> }
          <button type="button" (click)="clearReminder()">Keine Erinnerung</button>
        } @else {
          <p class="meta">Uhrzeit wählen; ohne Tag gilt die Fälligkeit, sonst heute.</p>
        }
      </fieldset>
      }

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
        <a class="button" [routerLink]="id ? ['/aufgabe', id] : bucket() === 'idea' ? ['/ideen'] : ['/']">Abbrechen</a>
        <button class="primary" type="submit" [disabled]="!title().trim() || (!!recurUnit() && !recurrence())">Speichern</button>
      </div>
    </form>
  `,
})
export class TodoEdit implements OnInit {
  protected readonly store = inject(Store);
  protected readonly voice = inject(Voice);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly fixedPresets = FIXED_PRESETS;
  protected readonly windowPresets = WINDOW_PRESETS;
  protected readonly efforts = EFFORT_OPTIONS;
  protected readonly format = formatDate;
  protected readonly describe = describeRecurrence;
  protected id: string | null = null;

  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly categoryId = signal<string | null>(null);
  protected readonly assigneeId = signal<string | null>(null);
  protected readonly dueDate = signal<string | null>(null);
  protected readonly dueWindow = signal<DueWindow | null>(null);
  protected readonly bucket = signal<Bucket | null>(null);
  protected readonly important = signal(false);
  private readonly pickedEffort = signal<number | null>(null);
  protected readonly customAmount = signal<number | null>(null);
  protected readonly customUnit = signal<'min' | 'h'>('min');
  protected readonly recurUnit = signal<RecurrenceUnit | ''>('');
  protected readonly recurEvery = signal<number | null>(1);
  protected readonly recurMode = signal<Recurrence['mode']>('schedule');
  protected readonly remindDate = signal('');
  protected readonly remindTime = signal('');
  protected readonly formatReminder = formatReminder;

  protected readonly heading = computed(() =>
    this.bucket() === 'idea' ? (this.id ? 'Idee bearbeiten' : 'Neue Idee') : this.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe',
  );
  protected readonly windowText = computed(() => relativeDue(this.dueDate(), this.store.today(), this.dueWindow()));

  /** Zeitpunkt der Erinnerung; ohne Tag die Faelligkeit, sonst heute. */
  protected readonly remindAt = computed(() => {
    const time = this.remindTime();
    if (!time) return null;
    return berlinToIso(this.remindDate() || this.dueDate() || this.store.today(), time);
  });

  /** null, wenn nicht wiederholt wird oder die Eingabe ungueltig ist. */
  protected readonly recurrence = computed<Recurrence | null>(() => {
    const unit = this.recurUnit();
    const every = Number(this.recurEvery());
    if (!unit || !Number.isInteger(every) || every < 1 || every > 365) return null;
    return { every, unit, mode: this.recurMode() };
  });
  protected readonly preview = computed(() => {
    const r = this.recurrence();
    return r ? nextDue(r, this.dueDate(), this.store.today(), this.dueWindow()) : null;
  });

  protected readonly effortMinutes = computed(() => {
    const amount = Number(this.customAmount());
    if (amount > 0) return Math.round(this.customUnit() === 'h' ? amount * 60 : amount);
    return this.pickedEffort();
  });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    const todo = this.id ? this.store.todo(this.id) : undefined;
    const ablage = this.route.snapshot.queryParamMap.get('ablage');
    if (!todo) {
      this.bucket.set(ablage === 'idee' ? 'idea' : null);
      this.important.set(this.route.snapshot.queryParamMap.get('wichtig') === '1');
    }
    if (todo) {
      this.important.set(!!todo.important);
      this.dueWindow.set(todo.due_window ?? null);
      this.bucket.set(todo.bucket ?? null);
      this.title.set(todo.title);
      this.description.set(todo.description);
      this.categoryId.set(todo.category_id);
      this.assigneeId.set(todo.assignee_id);
      this.dueDate.set(todo.due_date);
      this.pickedEffort.set(todo.effort_minutes);
      if (todo.recurrence) {
        this.recurUnit.set(todo.recurrence.unit);
        this.recurEvery.set(todo.recurrence.every);
        this.recurMode.set(todo.recurrence.mode);
      }
      if (todo.remind_at) {
        const { date, time } = berlinParts(todo.remind_at);
        this.remindDate.set(date);
        this.remindTime.set(time);
      }
    }
  }

  protected isPast(iso: string): boolean {
    return Date.parse(iso) < Date.now();
  }

  protected clearReminder(): void {
    this.remindDate.set('');
    this.remindTime.set('');
  }

  protected date(preset: DuePreset | WindowPreset): string {
    return resolvePreset(preset, this.store.today());
  }

  /** Fester Tag; ein Datum holt die Aufgabe aus der Ablage "Spaeter". */
  protected pickDate(date: string | null): void {
    this.dueDate.set(date);
    this.dueWindow.set(null);
    if (date && this.bucket() === 'later') this.bucket.set(null);
  }

  protected pickWindow(preset: WindowPreset, window: DueWindow): void {
    this.pickDate(this.date(preset));
    this.dueWindow.set(window);
  }

  protected pickNoDate(bucket: Bucket | null): void {
    this.pickDate(null);
    this.bucket.set(bucket);
  }

  protected async dictate(field: 'title' | 'description'): Promise<void> {
    const spoken = await this.voice.listen(field);
    if (!spoken) return;
    const target = field === 'title' ? this.title : this.description;
    target.set(appendSpoken(target(), spoken));
  }

  protected pickEffort(minutes: number | null): void {
    this.customAmount.set(null);
    this.pickedEffort.set(minutes);
  }

  protected async save(): Promise<void> {
    // Ideen haben weder Faelligkeit noch Erinnerung noch Wiederholung.
    const idea = this.bucket() === 'idea';
    const values: TodoPatch & { title: string } = {
      title: this.title().trim(),
      description: this.description(),
      category_id: this.categoryId(),
      assignee_id: this.assigneeId(),
      due_date: idea ? null : this.dueDate(),
      due_window: idea || !this.dueDate() ? null : this.dueWindow(),
      bucket: this.bucket(),
      important: this.important(),
      effort_minutes: this.effortMinutes(),
      recurrence: idea ? null : this.recurrence(),
      remind_at: idea ? null : this.remindAt(),
    };
    if (!values.title) return;

    const found = this.id ? this.store.todo(this.id) : undefined;
    // Daten aus aelteren Versionen kennen "important" noch nicht; fehlend heisst false.
    const existing = found ? { ...found, important: !!found.important } : undefined;
    if (this.id && existing) {
      const patch = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => !sameValue(existing[key as keyof typeof existing], value)),
      );
      await this.store.updateTodo(this.id, patch);
      await this.router.navigate(['/aufgabe', this.id]);
    } else {
      await this.store.createTodo(values);
      await this.router.navigate([idea ? '/ideen' : '/']);
    }
  }
}
