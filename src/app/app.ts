import { Component, effect, inject, OnInit, untracked } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Push } from './core/push';
import { Store } from './core/store';
import { Theme } from './core/theme';
import { Updates } from './core/updates';
import { Login } from './pages/login';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Login],
  template: `
    @if (store.ready()) {
      @if (store.session()) {
        @if (updates.banner(); as release) {
          <aside class="update-banner row between" role="status">
            <span>Update verfügbar: Version {{ release.version }}</span>
            <span class="row">
              <button class="primary" type="button" [disabled]="updates.phase() === 'downloading' || updates.phase() === 'installing'"
                (click)="updates.install()">{{ installLabel() }}</button>
              <button type="button" (click)="updates.dismiss()">Später</button>
            </span>
            @if (updates.phase() === 'permission') {
              <span class="update-note">Zahnwerk darf noch keine Updates installieren.
                <button type="button" (click)="updates.allowInstall()">Erlauben</button></span>
            }
            @if (updates.installError(); as message) { <span class="error update-note" role="alert">{{ message }}</span> }
          </aside>
        }
        <main class="page"><router-outlet /></main>
        <nav class="tabbar" aria-label="Hauptnavigation">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Aufgaben</a>
          <a routerLink="/ideen" routerLinkActive="active">Ideen</a>
          <a routerLink="/statistik" routerLinkActive="active">Statistik</a>
          <a routerLink="/kategorien" routerLinkActive="active">Kategorien</a>
          <a routerLink="/einstellungen" routerLinkActive="active">Einstellungen</a>
        </nav>
      } @else {
        <app-login />
      }
    }
  `,
})
export class App implements OnInit {
  protected readonly store = inject(Store);
  private readonly push = inject(Push);
  private readonly router = inject(Router);
  private readonly theme = inject(Theme);
  protected readonly updates = inject(Updates);

  /** Text des Update-Knopfs je nach Stand. */
  protected installLabel(): string {
    const progress = this.updates.progress();
    if (this.updates.phase() === 'installing') return 'Wird installiert…';
    if (this.updates.phase() === 'downloading') return progress !== null && progress >= 0 ? `Lade… ${Math.round(progress * 100)} %` : 'Lade…';
    return 'Installieren';
  }

  constructor() {
    // Beim Anmelden und bei jedem Start: Geraet registrieren und synchronisieren.
    effect(() => {
      if (this.store.session()?.user.id) {
        untracked(() => {
          void this.store.sync();
          void this.push.start();
          void this.updates.check();
        });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.store.init();
    if (Capacitor.isNativePlatform()) {
      await CapApp.addListener('resume', () => {
        void this.store.sync();
        void this.updates.check();
        void this.updates.resume();
      });
      await CapApp.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack && this.router.url !== '/') history.back();
        else void CapApp.minimizeApp();
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.store.sync();
    });
  }
}
