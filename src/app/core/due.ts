// Faelligkeit ist ein reines Kalenderdatum (YYYY-MM-DD) nach Europe/Berlin.
import { DueWindow, Recurrence } from './models';
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

/** Zeitfenster statt Stichtag; das Datum ist jeweils das Ende des Fensters. */
export type WindowPreset = 'this_week' | 'next_week' | 'this_month';

export const WINDOW_PRESETS: { id: WindowPreset; label: string; window: DueWindow }[] = [
  { id: 'this_week', label: 'Irgendwann diese Woche', window: 'week' },
  { id: 'next_week', label: 'Irgendwann nächste Woche', window: 'week' },
  { id: 'this_month', label: 'Bis Monatsende', window: 'month' },
];

/** Ende des Fensters, in dem das Datum liegt; Spiegel von private.snap_window. */
export function snapWindow(date: string, window: DueWindow | null | undefined): string {
  if (window === 'week') return endOfWeek(date);
  if (window === 'month') return endOfMonth(date);
  return date;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function formatDate(date: string): string {
  const d = toUtc(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]}, ${day}.${month}.${d.getUTCFullYear()}`;
}

/** Relative Anzeige; wird bei jedem Rendern aus dem heutigen Datum berechnet. */
export function relativeDue(due: string | null, today: string, window?: DueWindow | null): string {
  if (!due) return 'Ohne Datum';
  const days = diffDays(today, due);
  if (days < -1) return `Seit ${-days} Tagen überfällig`;
  if (days === -1) return 'Seit gestern überfällig';
  if (window === 'week') {
    if (days === 0) return 'Diese Woche, heute letzter Tag';
    if (due === endOfWeek(today)) return 'Irgendwann diese Woche';
    if (due === addDays(endOfWeek(today), 7)) return 'Irgendwann nächste Woche';
    return `In der Woche bis ${formatDate(due)}`;
  }
  if (window === 'month') {
    if (days === 0) return 'Bis Monatsende, heute letzter Tag';
    if (due === endOfMonth(today)) return 'Bis Monatsende';
    const d = toUtc(due);
    return `Bis Ende ${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() === toUtc(today).getUTCFullYear() ? '' : ' ' + d.getUTCFullYear()}`;
  }
  if (days === 0) return 'Heute';
  if (days === 1) return 'Morgen';
  if (due <= endOfWeek(today)) return `Diese Woche (${WEEKDAYS[toUtc(due).getUTCDay()]})`;
  if (due <= addDays(endOfWeek(today), 7)) return `Nächste Woche (${WEEKDAYS[toUtc(due).getUTCDay()]})`;
  return formatDate(due);
}

/** Datum und Uhrzeit (HH:MM) in Berliner Ortszeit fuer einen Zeitpunkt. */
export function berlinParts(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/**
 * Berliner Ortszeit als ISO-Zeitpunkt (UTC). Zweimal angenaehert, damit es auch an den Tagen
 * der Zeitumstellung stimmt. Eine Uhrzeit in der uebersprungenen Stunde (02:30 im Maerz)
 * wird um eine Stunde verschoben; in der doppelten Stunde im Oktober gilt die zweite (MEZ).
 */
export function berlinToIso(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const offset = (utc: number) => {
    const p = berlinParts(new Date(utc).toISOString());
    const [py, pm, pd] = p.date.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    return Date.UTC(py, pm - 1, pd, ph, pmin) - utc;
  };
  let utc = wall - offset(wall);
  utc = wall - offset(utc);
  return new Date(utc).toISOString();
}

export function formatReminder(iso: string): string {
  const { date, time } = berlinParts(iso);
  return `${formatDate(date)}, ${time} Uhr`;
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
export function nextDue(r: Recurrence, due: string | null, done: string, window?: DueWindow | null): string {
  return snapWindow(nextDueRaw(r, due, done), window);
}

function nextDueRaw(r: Recurrence, due: string | null, done: string): string {
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
