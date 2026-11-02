import { describe, expect, it } from 'vitest';
import { addDays, berlinToday, endOfMonth, endOfWeek, formatEffort, relativeDue, resolvePreset } from './due';

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
