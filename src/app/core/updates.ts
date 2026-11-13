import { Injectable, signal } from '@angular/core';
import { App as CapApp } from '@capacitor/app';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { UPDATE_REPO } from './config';

export interface ReleaseInfo {
  version: string;
  /** Direkter APK-Download, sonst die Release-Seite. */
  url: string;
  notes: string;
  /** Nur wenn das Release eine APK hat: Download-Adresse, API-Adresse (Ausweichweg) und Groesse in Bytes. */
  apk: { url: string; apiUrl: string | null; size: number } | null;
}

type InstallStatus = 'pending' | 'success' | 'aborted' | 'conflict' | 'failed';

/** Natives Plugin (android/.../AppUpdaterPlugin.java): Download in den App-Cache und System-Installer. */
interface AppUpdaterPlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { url: string; apiUrl?: string; size?: number }): Promise<void>;
  addListener(event: 'progress', fn: (data: { value: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'installStatus', fn: (data: { status: InstallStatus; message?: string }) => void): Promise<PluginListenerHandle>;
}
const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

/** idle: nichts laeuft; permission: Erlaubnis fuer "Unbekannte Apps installieren" fehlt. */
export type InstallPhase = 'idle' | 'permission' | 'downloading' | 'installing';

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
    assets?: { name?: string; browser_download_url?: string; url?: string; size?: number }[];
  } | null;
  if (!r || r.draft || r.prerelease || !parseVersion(r.tag_name)) return null;
  const asset = r.assets?.find((a) => a.name?.toLowerCase().endsWith('.apk') && a.browser_download_url?.startsWith('https://'));
  const url = asset?.browser_download_url ?? r.html_url;
  if (!url) return null;
  const apk = asset
    ? {
        url: asset.browser_download_url!,
        apiUrl: asset.url?.startsWith('https://api.github.com/') ? asset.url : null,
        size: asset.size && asset.size > 0 ? asset.size : 0,
      }
    : null;
  return { version: r.tag_name!.replace(/^v/, ''), url, notes: (r.body ?? '').trim(), apk };
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
  readonly phase = signal<InstallPhase>('idle');
  /** Download-Fortschritt 0..1, -1 bei unbekannter Groesse, null wenn nichts laedt. */
  readonly progress = signal<number | null>(null);
  readonly installError = signal<string | null>(null);
  private listening = false;

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

  /**
   * Update installieren wie bei der Vorrat-App: APK in den App-Cache laden (immer dieselbe Datei,
   * nichts in "Downloads") und an den System-Installer geben. Ohne APK im Release: Release-Seite oeffnen.
   */
  async install(): Promise<void> {
    const release = this.latest();
    if (!release || this.phase() === 'downloading' || this.phase() === 'installing') return;
    this.installError.set(null);
    if (!Capacitor.isNativePlatform() || !release.apk) {
      window.open(release.url, '_blank', 'noopener');
      return;
    }
    try {
      await this.listen();
      if (!(await AppUpdater.canInstall()).allowed) {
        this.phase.set('permission');
        return;
      }
      this.phase.set('downloading');
      this.progress.set(release.apk.size > 0 ? 0 : -1);
      await AppUpdater.install({ url: release.apk.url, apiUrl: release.apk.apiUrl ?? undefined, size: release.apk.size });
      // Der Installer meldet sich ueber "installStatus"; bis dahin laeuft die Installation.
      // (Meldete der Installer schon vorher Fehler/Abbruch, ist die Phase nicht mehr 'downloading'.)
      if (this.phase() === 'downloading') this.phase.set('installing');
    } catch (error) {
      console.warn('update install failed', error);
      const code = (error as { code?: string }).code;
      this.phase.set('idle');
      this.installError.set(code === 'download'
        ? 'Download fehlgeschlagen. Besteht eine Verbindung?'
        : 'Die Installation konnte nicht gestartet werden.');
    } finally {
      this.progress.set(null);
    }
  }

  /** Fuehrt in die Systemeinstellung "Unbekannte Apps installieren". */
  async allowInstall(): Promise<void> {
    try {
      await AppUpdater.openInstallSettings();
    } catch {
      this.installError.set('Bitte in den Android-Einstellungen erlauben, dass Zahnwerk Apps installieren darf.');
    }
  }

  /** Beim Zurueckkehren in die App: wurde die Erlaubnis erteilt, gleich weitermachen. */
  async resume(): Promise<void> {
    if (this.phase() !== 'permission' || !Capacitor.isNativePlatform()) return;
    if ((await AppUpdater.canInstall()).allowed) {
      this.phase.set('idle');
      await this.install();
    }
  }

  private async listen(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    await AppUpdater.addListener('progress', ({ value }) => {
      if (this.phase() === 'downloading') this.progress.set(value);
    });
    await AppUpdater.addListener('installStatus', ({ status }) => {
      if (status === 'pending') return;
      this.phase.set('idle');
      if (status === 'conflict') this.installError.set('Das Update passt nicht zur installierten App (andere Signatur).');
      else if (status === 'failed') this.installError.set('Die Installation ist fehlgeschlagen.');
    });
  }

  dismiss(): void {
    const found = this.banner();
    if (found) storageSet(DISMISSED_KEY, found.version);
    this.banner.set(null);
  }
}
