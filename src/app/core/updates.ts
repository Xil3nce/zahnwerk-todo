import { Injectable, signal } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { UPDATE_REPO } from './config';

export interface ReleaseInfo {
  version: string;
  /** Direkter APK-Download, sonst die Release-Seite. */
  url: string;
  notes: string;
}

const CHECK_EVERY_MS = 6 * 3_600_000;
const LAST_CHECK_KEY = 'zahnwerk.updateCheckedAt';
const DISMISSED_KEY = 'zahnwerk.updateDismissed';

/** "v1.2.3" oder "1.2" -> [1, 2, 3] bzw. [1, 2, 0]; null bei allem anderen. */
export function parseVersion(text: string | null | undefined): number[] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec((text ?? '').trim());
  return match ? [1, 2, 3].map((i) => Number(match[i] ?? 0)) : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Antwort von GET /repos/{repo}/releases/latest; Entwuerfe und Vorabversionen zaehlen nicht. */
export function pickRelease(json: unknown): ReleaseInfo | null {
  const r = json as {
    tag_name?: string; html_url?: string; body?: string | null; draft?: boolean; prerelease?: boolean;
    assets?: { name?: string; browser_download_url?: string }[];
  } | null;
  if (!r || r.draft || r.prerelease || !parseVersion(r.tag_name)) return null;
  const apk = r.assets?.find((a) => a.name?.toLowerCase().endsWith('.apk') && a.browser_download_url);
  const url = apk?.browser_download_url ?? r.html_url;
  if (!url) return null;
  return { version: r.tag_name!.replace(/^v/, ''), url, notes: (r.body ?? '').trim() };
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ohne Speicher wird eben haeufiger nachgesehen.
  }
}

/**
 * Selbst-Update-Hinweis: fragt hoechstens alle 6 Stunden das neueste GitHub-Release ab
 * und meldet es, wenn es neuer ist als die installierte Version.
 */
@Injectable({ providedIn: 'root' })
export class Updates {
  readonly current = signal<string | null>(null);
  readonly latest = signal<ReleaseInfo | null>(null);
  /** Hinweisleiste; "Später" blendet sie fuer diese Version aus, die Einstellungen zeigen sie weiter. */
  readonly banner = signal<ReleaseInfo | null>(null);
  readonly checking = signal(false);
  readonly lastError = signal<string | null>(null);

  async check(force = false): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.checking()) return;
    const last = Number(storageGet(LAST_CHECK_KEY) ?? 0);
    if (!force && Date.now() - last < CHECK_EVERY_MS && this.current()) return;

    this.checking.set(true);
    this.lastError.set(null);
    try {
      this.current.set((await CapApp.getInfo()).version);
      const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (response.status === 404) {
        this.latest.set(null);
      } else if (!response.ok) {
        throw new Error(`GitHub ${response.status}`);
      } else {
        const release = pickRelease(await response.json());
        this.latest.set(release && isNewer(release.version, this.current()!) ? release : null);
      }
      storageSet(LAST_CHECK_KEY, String(Date.now()));
      const found = this.latest();
      this.banner.set(found && storageGet(DISMISSED_KEY) !== found.version ? found : null);
    } catch (error) {
      console.warn('update check failed', error);
      this.lastError.set('Konnte nicht nach Updates suchen. Besteht eine Verbindung?');
    } finally {
      this.checking.set(false);
    }
  }

  dismiss(): void {
    const found = this.banner();
    if (found) storageSet(DISMISSED_KEY, found.version);
    this.banner.set(null);
  }
}
