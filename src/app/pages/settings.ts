import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Profile } from '../core/models';
import { Push } from '../core/push';
import { Store } from '../core/store';
import { Theme, ThemeMode } from '../core/theme';
import { Updates } from '../core/updates';

type Toggle = 'notify_done' | 'notify_new' | 'notify_changed' | 'notify_due_today' | 'notify_overdue' | 'notify_comment';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink],
  template: `
    <h1>Einstellungen</h1>

    <section class="card stack">
      <h2>Darstellung</h2>
      <div class="segmented" role="group" aria-label="Farbschema">
        @for (m of modes; track m.id) {
          <button type="button" [class.active]="theme.mode() === m.id" [attr.aria-pressed]="theme.mode() === m.id" (click)="theme.set(m.id)">{{ m.label }}</button>
        }
      </div>
    </section>

    @if (store.me(); as me) {
      <section class="card stack">
        <h2>Benachrichtigungen</h2>
        @for (t of toggles; track t.key) {
          <label class="check">
            <input type="checkbox" [checked]="me[t.key]" (change)="toggle(t.key, $any($event.target).checked)" />
            {{ t.label }}
          </label>
        }
        <label class="check">
          <input type="checkbox" [checked]="me.quiet_hours ?? true" (change)="save({ quiet_hours: $any($event.target).checked })" />
          Ruhezeiten: zwischen 22 und 7 Uhr keine Pushes, was nachts anfällt, kommt morgens gesammelt
        </label>
        <label>Tägliche Erinnerung um
          <select [ngModel]="me.reminder_time.slice(0, 5)" (ngModelChange)="save({ reminder_time: $event + ':00' })">
            @for (time of times; track time) { <option [value]="time">{{ time }} Uhr</option> }
          </select>
        </label>
        @if (saveError()) { <p class="error" role="alert">Speichern braucht eine Verbindung. Bitte später erneut versuchen.</p> }
      </section>
    }

    <section class="card stack">
      <h2>App</h2>
      @if (native) {
        <p class="meta">Installierte Version: {{ updates.current() ?? '…' }}</p>
        @if (updates.latest(); as release) {
          <p class="notice">Version {{ release.version }} ist verfügbar.</p>
          <a class="button primary" [href]="release.url" target="_blank" rel="noopener">Update herunterladen</a>
        } @else if (updates.current() && !updates.checking() && !updates.lastError()) {
          <p class="meta">Zahnwerk ist auf dem neuesten Stand.</p>
        }
        @if (updates.lastError(); as message) { <p class="error" role="alert">{{ message }}</p> }
        <button type="button" (click)="updates.check(true)" [disabled]="updates.checking()">
          {{ updates.checking() ? 'Suche…' : 'Nach Updates suchen' }}
        </button>
      }
      <a routerLink="/papierkorb">Papierkorb (gelöschte Aufgaben wiederherstellen)</a>
    </section>

    <section class="card stack">
      <h2>Konto</h2>
      <p class="meta">
        Angemeldet als {{ store.me()?.display_name ?? store.session()?.user?.email }}.
        @if (lastSync(); as when) { Zuletzt synchronisiert: {{ when }} Uhr. }
      </p>
      @if (store.pendingCount() > 0) {
        <p class="notice">{{ store.pendingCount() }} Änderung(en) sind noch nicht übertragen und gingen beim Abmelden verloren.</p>
      }
      <button type="button" (click)="signOut()">Abmelden</button>
    </section>
  `,
})
export class Settings {
  protected readonly store = inject(Store);
  protected readonly theme = inject(Theme);
  private readonly push = inject(Push);
  protected readonly updates = inject(Updates);
  protected readonly native = Capacitor.isNativePlatform();

  protected readonly saveError = signal(false);
  protected readonly modes: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Hell' },
    { id: 'dark', label: 'Dunkel' },
  ];
  protected readonly toggles: { key: Toggle; label: string }[] = [
    { key: 'notify_done', label: 'Aufgabe wurde erledigt' },
    { key: 'notify_new', label: 'Neue Aufgabe, die mich betrifft' },
    { key: 'notify_changed', label: 'Änderung an einer Aufgabe, die mich betrifft' },
    { key: 'notify_comment', label: 'Neuer Kommentar an einer Aufgabe, die mich betrifft' },
    { key: 'notify_due_today', label: 'Tägliche Erinnerung: heute fällig' },
    { key: 'notify_overdue', label: 'Tägliche Erinnerung: überfällige Aufgaben nennen' },
  ];
  protected readonly times = Array.from({ length: 96 }, (_, i) =>
    `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
  );
  protected readonly lastSync = computed(() =>
    this.store.lastSync()?.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }),
  );

  protected toggle(key: Toggle, value: boolean): void {
    void this.save({ [key]: value });
  }

  protected async save(patch: Partial<Profile>): Promise<void> {
    this.saveError.set(!(await this.store.updateSettings(patch)));
  }

  protected async signOut(): Promise<void> {
    const pending = this.store.pendingCount();
    if (pending > 0 && !confirm(`${pending} Änderung(en) gehen verloren. Trotzdem abmelden?`)) return;
    await this.push.stop();
    await this.store.signOut();
  }
}
