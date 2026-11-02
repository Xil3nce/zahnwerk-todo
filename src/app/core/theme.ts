import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = 'zahnwerk-theme';

@Injectable({ providedIn: 'root' })
export class Theme {
  readonly mode = signal<ThemeMode>(this.load());

  constructor() {
    this.apply(this.mode());
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Ohne Speicher gilt die Auswahl nur bis zum Neustart.
    }
    this.apply(mode);
  }

  private load(): ThemeMode {
    try {
      return (localStorage.getItem(KEY) as ThemeMode) || 'system';
    } catch {
      return 'system';
    }
  }

  private apply(mode: ThemeMode): void {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
  }
}
