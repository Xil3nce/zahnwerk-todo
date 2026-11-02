import { Component, computed, inject } from '@angular/core';
import { formatEffort } from '../core/due';
import { Store } from '../core/store';
import { computeStats } from '../core/views';

@Component({
  selector: 'app-stats',
  template: `
    <h1>Statistik</h1>
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
    <p class="meta">Der Aufwand zählt nur offene Aufgaben mit Zeitangabe. „Beide“ wird separat geführt, damit nichts doppelt zählt.</p>
  `,
})
export class Stats {
  private readonly store = inject(Store);
  protected readonly stats = computed(() => computeStats(this.store.todos(), this.store.profiles()));
  protected readonly effort = formatEffort;
}
