import { describe, expect, it } from 'vitest';
import { addDays, addMonths, berlinParts, berlinToday, berlinToIso, describeRecurrence, endOfMonth, endOfWeek, formatEffort, formatReminder, nextDue, relativeDue, resolvePreset } from './due';
import { Recurrence } from './models';

describe('berlinToday', () => {
  it('wechselt um Mitternacht Berliner Zeit, nicht UTC', () => {
    expect(berlinToday(new Date('2026-07-14T21:59:00Z'))).toBe('2026-07-14'); // 23:59 MESZ
    expect(berlinToday(new Date('2026-07-14T22:01:00Z'))).toBe('2026-07-15'); // 00:01 MESZ
    expect(berlinToday(new Date('2026-01-14T22:59:00Z'))).toBe('2026-01-14'); // 23:59 MEZ
    expect(berlinToday(new Date('2026-01-14T23:01:00Z'))).toBe('2026-01-15'); // 00:01 MEZ
  });

  it('stimmt an den Tagen der Zeitumstellung', () => {
    expect(berlinToday(new Date('2026-03-29T00:30:00Z'))).toBe('2026-03-29');
    expect(berlinToday(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29'); // 23:59 MESZ
    expect(berlinToday(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25'); // doppelte Stunde
    expect(berlinToday(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25'); // 23:59 MEZ
  });
});

describe('Kalenderrechnung', () => {
  it('addiert ueber die Zeitumstellung hinweg ganze Tage', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('endOfWeek liefert den Sonntag', () => {
    expect(endOfWeek('2026-11-02')).toBe('2026-11-08'); // Montag
    expect(endOfWeek('2026-11-07')).toBe('2026-11-08'); // Samstag
    expect(endOfWeek('2026-11-08')).toBe('2026-11-08'); // Sonntag
    expect(endOfWeek('2026-12-30')).toBe('2027-01-03'); // Jahreswechsel
  });

  it('endOfMonth kennt Schaltjahre', () => {
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
  });
});

describe('resolvePreset', () => {
  const monday = '2026-11-02';
  it('loest alle Vorgaben in ein konkretes Datum auf', () => {
    expect(resolvePreset('today', monday)).toBe(monday);
    expect(resolvePreset('tomorrow', monday)).toBe('2026-11-03');
    expect(resolvePreset('this_week', monday)).toBe('2026-11-08');
    expect(resolvePreset('next_week', monday)).toBe('2026-11-15');
    expect(resolvePreset('this_month', monday)).toBe('2026-11-30');
  });

  it('nimmt am Sonntag den heutigen Tag als Wochenende', () => {
    expect(resolvePreset('this_week', '2026-11-08')).toBe('2026-11-08');
    expect(resolvePreset('next_week', '2026-11-08')).toBe('2026-11-15');
  });
});

describe('relativeDue', () => {
  it('wird aus Morgen am Folgetag Heute und dann ueberfaellig', () => {
    const due = '2026-11-03';
    expect(relativeDue(due, '2026-11-02')).toBe('Morgen');
    expect(relativeDue(due, '2026-11-03')).toBe('Heute');
    expect(relativeDue(due, '2026-11-04')).toBe('Seit gestern überfällig');
    expect(relativeDue(due, '2026-11-06')).toBe('Seit 3 Tagen überfällig');
  });

  it('beschriftet Wochen und fehlende Daten', () => {
    expect(relativeDue('2026-11-06', '2026-11-02')).toBe('Diese Woche (Fr)');
    expect(relativeDue('2026-11-10', '2026-11-02')).toBe('Nächste Woche (Di)');
    expect(relativeDue('2026-12-24', '2026-11-02')).toBe('Do, 24.12.2026');
    expect(relativeDue(null, '2026-11-02')).toBe('Ohne Datum');
  });
});

describe('formatEffort', () => {
  it('zeigt Minuten und Stunden', () => {
    expect(formatEffort(45)).toBe('45 Min.');
    expect(formatEffort(60)).toBe('1 Std.');
    expect(formatEffort(90)).toBe('1 Std. 30 Min.');
    expect(formatEffort(null)).toBe('');
  });
});

// Gleiche Faelle wie in scripts/test-db.mjs fuer private.next_due: App-Vorschau und Server muessen uebereinstimmen.
describe('nextDue', () => {
  const week: Recurrence = { every: 1, unit: 'week', mode: 'schedule' };

  it('folgt im Modus "schedule" dem festen Takt, erster Termin nach dem Erledigungstag', () => {
    expect(nextDue(week, '2026-11-10', '2026-11-10')).toBe('2026-11-17');
    expect(nextDue(week, '2026-11-10', '2026-11-09')).toBe('2026-11-17');
    expect(nextDue(week, '2026-11-10', '2026-12-01')).toBe('2026-12-08');
    expect(nextDue({ every: 2, unit: 'week', mode: 'schedule' }, '2026-11-10', '2026-11-12')).toBe('2026-11-24');
  });

  it('rechnet im Modus "completion" und ohne Faelligkeit ab dem Erledigungstag', () => {
    expect(nextDue({ every: 3, unit: 'day', mode: 'completion' }, '2026-11-10', '2026-11-12')).toBe('2026-11-15');
    expect(nextDue(week, null, '2026-11-12')).toBe('2026-11-19');
  });

  it('kappt Monate wie Postgres auf das Monatsende', () => {
    expect(nextDue({ every: 1, unit: 'month', mode: 'schedule' }, '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextDue({ every: 1, unit: 'month', mode: 'schedule' }, '2026-01-31', '2026-03-05')).toBe('2026-03-31');
    expect(nextDue({ every: 1, unit: 'month', mode: 'completion' }, null, '2026-05-31')).toBe('2026-06-30');
    expect(addMonths('2028-01-30', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('describeRecurrence', () => {
  it('beschreibt Takt und Modus', () => {
    expect(describeRecurrence({ every: 1, unit: 'week', mode: 'schedule' })).toBe('Wöchentlich');
    expect(describeRecurrence({ every: 3, unit: 'day', mode: 'completion' })).toBe('Alle 3 Tage, ab Erledigung');
    expect(describeRecurrence({ every: 2, unit: 'month', mode: 'schedule' })).toBe('Alle 2 Monate');
  });
});

describe('Erinnerungszeit (Berliner Ortszeit)', () => {
  it('rechnet Winter- und Sommerzeit richtig um', () => {
    expect(berlinToIso('2026-11-07', '17:30')).toBe('2026-11-07T16:30:00.000Z'); // MEZ
    expect(berlinToIso('2026-07-14', '17:30')).toBe('2026-07-14T15:30:00.000Z'); // MESZ
    expect(berlinToIso('2026-01-01', '00:15')).toBe('2025-12-31T23:15:00.000Z'); // Jahreswechsel
  });

  it('stimmt an den Tagen der Zeitumstellung', () => {
    expect(berlinToIso('2026-03-29', '01:30')).toBe('2026-03-29T00:30:00.000Z');
    expect(berlinToIso('2026-03-29', '03:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(berlinParts(berlinToIso('2026-03-29', '02:30')).time).toBe('03:30'); // uebersprungene Stunde
    expect(berlinToIso('2026-10-25', '02:30')).toBe('2026-10-25T01:30:00.000Z'); // zweite der doppelten Stunde (MEZ)
    expect(berlinToIso('2026-10-25', '18:00')).toBe('2026-10-25T17:00:00.000Z');
  });

  it('liest Zeitpunkte zurueck und formatiert sie', () => {
    expect(berlinParts('2026-11-07T16:30:00+00:00')).toEqual({ date: '2026-11-07', time: '17:30' });
    expect(berlinParts('2026-07-14T22:05:00Z')).toEqual({ date: '2026-07-15', time: '00:05' });
    expect(formatReminder('2026-11-07T16:30:00Z')).toBe('Sa, 07.11.2026, 17:30 Uhr');
  });
});
