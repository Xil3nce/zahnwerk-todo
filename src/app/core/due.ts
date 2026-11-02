// Faelligkeit ist ein reines Kalenderdatum (YYYY-MM-DD) nach Europe/Berlin.
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

export function formatEffort(minutes: number | null): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}
