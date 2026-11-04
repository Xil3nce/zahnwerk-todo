import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatEffort } from '../core/due';
import { Store } from '../core/store';
import { computeStats, DueFilter, dueOptions } from '../core/views';

@Component({
  selector: 'app-stats',
  imports: [FormsModule],
  template: `
    <h1>Statistik</h1>
    <label class="card">Fälligkeit
      <select [ngModel]="due()" (ngModelChange)="due.set($event)">
        @for (option of dueOptions; track option.id) { <option [value]="option.id">{{ option.label }}</option> }
      </select>
    </label>
    <div class="card">
      <table class="stats">
        <thead>
          <tr><th scope="col">Zuständig</th><th scope="col">Offen</th><th scope="col">Aufwand</th><th scope="col">Erledigt</th></tr>
        </thead>
        <tbody>
          @for (row of stats(); track row.label) {
            <tr>
              <th scope="row">{{ row.label }}</th>
              <td>{{ row.openCount }}</td>
              <td>{{ effort(row.openMinutes) || '–' }}</td>
              <td>{{ row.doneCount ?? '–' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <p class="meta">Der Aufwand zählt nur offene Aufgaben mit Zeitangabe. „Beide“ wird separat geführt, damit nichts doppelt zählt. Der Fälligkeitsfilter gilt auch für die erledigten Aufgaben.</p>
  `,
})
export class Stats {
  private readonly store = inject(Store);
  protected readonly dueOptions = dueOptions('all');
  protected readonly due = signal<DueFilter>('any');
  protected readonly stats = computed(() =>
    computeStats(this.store.todos(), this.store.profiles(), this.due(), this.store.today()),
  );
  protected readonly effort = formatEffort;
}
