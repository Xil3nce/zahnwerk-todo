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
              <a class="button primary" [href]="release.url" target="_blank" rel="noopener">Herunterladen</a>
              <button type="button" (click)="updates.dismiss()">Später</button>
            </span>
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
