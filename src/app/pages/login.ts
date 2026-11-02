import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../core/store';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <main class="page login">
      <img src="zahnrad.svg" alt="" width="96" height="96" class="login-gear" />
      <h1>Zahnwerk</h1>
      <form class="card stack" (ngSubmit)="submit()">
        <label>E-Mail
          <input type="email" name="email" autocomplete="username" required [(ngModel)]="email" />
        </label>
        <label>Passwort
          <input type="password" name="password" autocomplete="current-password" required [(ngModel)]="password" />
        </label>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Anmeldung läuft…' : 'Anmelden' }}</button>
      </form>
    </main>
  `,
})
export class Login {
  private readonly store = inject(Store);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(await this.store.signIn(this.email().trim(), this.password()));
    this.busy.set(false);
  }
}
