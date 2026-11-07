// Faelligkeit ist ein reines Kalenderdatum (YYYY-MM-DD) nach Europe/Berlin.
import { Recurrence } from './models';
const TIME_ZONE = 'Europe/Berlin';

export type DuePreset = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month';

export const DUE_PRESETS: { id: DuePreset; label: string }[] = [
  { id: 'today', label: 'Heute' },
  { id: 'tomorrow', label: 'Morgen' },
  { id: 'this_week', label: 'Diese Woche' },
  { id: 'next_week', label: 'Nächste Woche' },
  { id: 'this_month', label: 'Diesen Monat' },
];

export function berlinToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Rechnet in UTC, weil es nur um Kalendertage geht: Zeitumstellungen spielen so keine Rolle.
const toUtc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Sonntag der Woche (Montag bis Sonntag), in der das Datum liegt. */
export function endOfWeek(date: string): string {
  const weekday = toUtc(date).getUTCDay();
  return addDays(date, weekday === 0 ? 0 : 7 - weekday);
}

export function endOfMonth(date: string): string {
  const d = toUtc(date);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function resolvePreset(preset: DuePreset, today: string): string {
  switch (preset) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'this_week':
      return endOfWeek(today);
    case 'next_week':
      return addDays(endOfWeek(today), 7);
    case 'this_month':
      return endOfMonth(today);
  }
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function formatDate(date: string): string {
  const d = toUtc(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]}, ${day}.${month}.${d.getUTCFullYear()}`;
}

/** Relative Anzeige; wird bei jedem Rendern aus dem heutigen Datum berechnet. */
export function relativeDue(due: string | null, today: string): string {
  if (!due) return 'Ohne Datum';
  const days = diffDays(today, due);
  if (days < -1) return `Seit ${-days} Tagen überfällig`;
  if (days === -1) return 'Seit gestern überfällig';
  if (days === 0) return 'Heute';
  if (days === 1) return 'Morgen';
  if (due <= endOfWeek(today)) return `Diese Woche (${WEEKDAYS[toUtc(due).getUTCDay()]})`;
  if (due <= addDays(endOfWeek(today), 7)) return `Nächste Woche (${WEEKDAYS[toUtc(due).getUTCDay()]})`;
  return formatDate(due);
}

/** Wie Postgres "date + n months": Tag auf das Monatsende gekappt. */
export function addMonths(date: string, months: number): string {
  const d = toUtc(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return fromUtc(target);
}

/**
 * Naechster Termin einer Wiederholung; Spiegel von private.next_due in der Datenbank,
 * die die Folgeaufgabe tatsaechlich anlegt. Hier nur fuer die Vorschau.
 */
export function nextDue(r: Recurrence, due: string | null, done: string): string {
  const step = (k: number, from: string) =>
    r.unit === 'month' ? addMonths(from, k * r.every) : addDays(from, k * r.every * (r.unit === 'week' ? 7 : 1));
  if (r.mode === 'completion' || !due) return step(1, done);
  if (r.unit === 'month') {
    let k = 1;
    while (step(k, due) <= done) k++;
    return step(k, due);
  }
  const days = r.every * (r.unit === 'week' ? 7 : 1);
  return step(Math.max(1, Math.floor(diffDays(due, done) / days) + 1), due);
}

export function describeRecurrence(r: Recurrence): string {
  const names = {
    day: ['Täglich', 'Tage'],
    week: ['Wöchentlich', 'Wochen'],
    month: ['Monatlich', 'Monate'],
  } as const;
  const [single, plural] = names[r.unit];
  const base = r.every === 1 ? single : `Alle ${r.every} ${plural}`;
  return r.mode === 'completion' ? `${base}, ab Erledigung` : base;
}

export function formatEffort(minutes: number | null): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}
