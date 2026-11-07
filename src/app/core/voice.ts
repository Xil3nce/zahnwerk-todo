import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';

/** Haengt Gesprochenes an vorhandenen Text an; ein leeres Feld beginnt mit Grossbuchstaben. */
export function appendSpoken(existing: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return existing;
  const base = existing.replace(/\s+$/, '');
  if (!base) return text.charAt(0).toLocaleUpperCase('de-DE') + text.slice(1);
  return `${base} ${text}`;
}

interface WebRecognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
}

function webRecognition(): (new () => WebRecognition) | null {
  const w = globalThis as unknown as Record<string, unknown>;
  return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as (new () => WebRecognition) | null;
}

/**
 * Spracheingabe. In der App die Android-Spracherkennung (Systemdialog, Deutsch),
 * im Browser waehrend der Entwicklung die Web Speech API, sofern vorhanden.
 */
@Injectable({ providedIn: 'root' })
export class Voice {
  /** Schluessel des Feldes, fuer das gerade zugehoert wird. */
  readonly listening = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly supported = Capacitor.isNativePlatform() || !!webRecognition();

  /** Liefert den erkannten Text oder null (abgebrochen, nichts verstanden, keine Berechtigung). */
  async listen(field: string): Promise<string | null> {
    if (this.listening()) return null;
    this.error.set(null);
    this.listening.set(field);
    try {
      return Capacitor.isNativePlatform() ? await this.listenNative() : await this.listenWeb();
    } catch (error) {
      console.warn('speech failed', error);
      this.error.set('Spracheingabe hat nicht geklappt. Bitte noch einmal versuchen.');
      return null;
    } finally {
      this.listening.set(null);
    }
  }

  private async listenNative(): Promise<string | null> {
    const { available } = await SpeechRecognition.available();
    if (!available) {
      this.error.set('Auf diesem Gerät ist keine Spracherkennung verfügbar.');
      return null;
    }
    let { speechRecognition } = await SpeechRecognition.checkPermissions();
    if (speechRecognition !== 'granted') ({ speechRecognition } = await SpeechRecognition.requestPermissions());
    if (speechRecognition !== 'granted') {
      this.error.set('Für die Spracheingabe braucht Zahnwerk Zugriff auf das Mikrofon.');
      return null;
    }
    const { matches } = await SpeechRecognition.start({
      language: 'de-DE', maxResults: 1, partialResults: false, popup: true, prompt: 'Sprich jetzt',
    });
    return matches?.[0]?.trim() || null;
  }

  private listenWeb(): Promise<string | null> {
    const Recognition = webRecognition();
    if (!Recognition) return Promise.resolve(null);
    return new Promise((resolve) => {
      const recognition = new Recognition();
      let result: string | null = null;
      recognition.lang = 'de-DE';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => (result = event.results[0]?.[0]?.transcript?.trim() || null);
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') this.error.set('Für die Spracheingabe braucht Zahnwerk Zugriff auf das Mikrofon.');
      };
      recognition.onend = () => resolve(result);
      recognition.start();
    });
  }
}
