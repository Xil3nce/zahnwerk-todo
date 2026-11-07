// Tests fuer Version 1.0.6: Zeitfenster, Spaeter, Erledigt, Wichtig, Suche, Papierkorb, Ideen,
// Spracheingabe (Textlogik) und Update-Hinweis (Versionsvergleich).
import { describe, expect, it } from 'vitest';
import { nextDue, relativeDue, snapWindow, WINDOW_PRESETS, resolvePreset } from './due';
import { Comment, Profile, Todo } from './models';
import { isNewer, parseVersion, pickRelease } from './updates';
import { computeStats, DEFAULT_FILTERS, dueOptions, normalize, openIdeas, searchTodos, selectTodos, trashTodos } from './views';
import { appendSpoken } from './voice';

const today = '2026-11-04'; // Mittwoch
const todo = (id: string, patch: Partial<Todo> = {}): Todo => ({
  id, title: id, description: '', category_id: null, due_date: null, assignee_id: null,
  effort_minutes: null, status: 'open', done_at: null, done_by: null, created_by: 'f',
  created_at: '2026-11-01T10:00:00Z', deleted_at: null, ...patch,
});
const ids = (list: Todo[]) => list.map((t) => t.id);
const comment = (todo_id: string, body: string, deleted_at: string | null = null): Comment => ({
  id: body, todo_id, author_id: 'f', body, created_at: '', deleted_at,
});

describe('Zeitfenster', () => {
  it('rastet auf Sonntag bzw. Monatsende ein', () => {
    expect(snapWindow('2026-11-02', 'week')).toBe('2026-11-08');
    expect(snapWindow('2026-11-08', 'week')).toBe('2026-11-08');
    expect(snapWindow('2026-02-10', 'month')).toBe('2026-02-28');
    expect(snapWindow('2028-02-10', 'month')).toBe('2028-02-29');
    expect(snapWindow('2026-02-10', null)).toBe('2026-02-10');
  });
  it('Vorlagen ergeben das Ende des Fensters', () => {
    expect(WINDOW_PRESETS.map((p) => [p.window, resolvePreset(p.id, today)])).toEqual([
      ['week', '2026-11-08'], ['week', '2026-11-15'], ['month', '2026-11-30'],
    ]);
  });
  it('zeigt Fenster statt Wochentag', () => {
    expect(relativeDue('2026-11-08', today, 'week')).toBe('Irgendwann diese Woche');
    expect(relativeDue('2026-11-15', today, 'week')).toBe('Irgendwann nächste Woche');
    expect(relativeDue('2026-11-04', today, 'week')).toBe('Diese Woche, heute letzter Tag');
    expect(relativeDue('2026-11-30', today, 'month')).toBe('Bis Monatsende');
    expect(relativeDue('2026-12-31', today, 'month')).toBe('Bis Ende Dezember');
    expect(relativeDue('2027-01-31', today, 'month')).toBe('Bis Ende Januar 2027');
    // Abgelaufen bleibt ueberfaellig wie bisher.
    expect(relativeDue('2026-11-01', today, 'week')).toBe('Seit 3 Tagen überfällig');
    // Ohne Fenster unveraendert.
    expect(relativeDue('2026-11-08', today)).toBe('Diese Woche (So)');
  });
  it('Vorschau der Folgeaufgabe rastet ein wie der Server', () => {
    const monthly = { every: 1, unit: 'month', mode: 'schedule' } as const;
    expect(nextDue(monthly, '2026-11-30', '2026-11-25', 'month')).toBe('2026-12-31');
    expect(nextDue(monthly, '2026-11-30', '2026-11-25')).toBe('2026-12-30');
    expect(nextDue({ every: 3, unit: 'day', mode: 'schedule' }, '2026-11-15', '2026-11-11', 'week')).toBe('2026-11-22');
  });
});

describe('Ansichten Wichtig und Erledigt', () => {
  const list = [
    todo('normal', { due_date: today }),
    todo('ohne'),
    todo('wichtig', { important: true }),
    todo('wichtig-fertig', { important: true, status: 'done', done_at: '2026-11-01T10:00:00Z' }),
    todo('idee-wichtig', { bucket: 'idea', important: true }),
    todo('spaeter', { bucket: 'later' }),
    todo('spaeter-fertig', { bucket: 'later', status: 'done', done_at: '2026-11-02T10:00:00Z' }),
    todo('idee', { bucket: 'idea' }),
    todo('idee-gemacht', { bucket: 'idea', status: 'done', done_at: '2026-11-03T10:00:00Z' }),
    todo('fertig', { due_date: today, status: 'done', done_at: '2026-11-04T08:00:00Z' }),
    todo('weg', { status: 'done', done_at: '2026-11-04T09:00:00Z', deleted_at: '2026-11-04T09:30:00Z' }),
  ];
  it('Alle zeigt auch fruehere Spaeter-Aufgaben, aber keine Ideen', () => {
    expect(ids(selectTodos(list, 'all', DEFAULT_FILTERS, 'due', today, []))).toEqual(['normal', 'ohne', 'spaeter', 'wichtig']);
    expect(ids(selectTodos(list, 'all', { ...DEFAULT_FILTERS, status: 'any' }, 'due', today, [])))
      .toEqual(['fertig', 'normal', 'ohne', 'spaeter', 'spaeter-fertig', 'wichtig', 'wichtig-fertig']);
  });
  it('Heute und Woche zeigen fruehere Spaeter-Aufgaben mit Datum, Ideen nicht', () => {
    const odd = [todo('a', { bucket: 'later', due_date: today }), todo('b', { due_date: today }), todo('c', { bucket: 'idea', due_date: today })];
    expect(ids(selectTodos(odd, 'today', DEFAULT_FILTERS, 'due', today, []))).toEqual(['a', 'b']);
    expect(ids(selectTodos(odd, 'week', DEFAULT_FILTERS, 'due', today, []))).toEqual(['a', 'b']);
  });
  it('Wichtig zeigt nur offene wichtige Aufgaben ohne Ideen', () => {
    expect(ids(selectTodos(list, 'important', DEFAULT_FILTERS, 'due', today, []))).toEqual(['wichtig']);
    // Ein Statusfilter aus "Alle" wirkt hier nicht.
    expect(ids(selectTodos(list, 'important', { ...DEFAULT_FILTERS, status: 'done' }, 'due', today, []))).toEqual(['wichtig']);
  });
  it('Filter "Nur wichtige" grenzt jede Ansicht ein', () => {
    const only = { ...DEFAULT_FILTERS, important: 'only' as const };
    const mixed = [todo('w', { due_date: today, important: true }), todo('n', { due_date: today })];
    expect(ids(selectTodos(list, 'all', only, 'due', today, []))).toEqual(['wichtig']);
    expect(ids(selectTodos(mixed, 'today', only, 'due', today, []))).toEqual(['w']);
  });
  it('Erledigt zeigt alles Abgehakte inkl. Ideen, zuletzt Erledigtes oben, Geloeschtes nie', () => {
    expect(ids(selectTodos(list, 'done', DEFAULT_FILTERS, 'due', today, []))).toEqual(['fertig', 'idee-gemacht', 'spaeter-fertig', 'wichtig-fertig']);
    // Ein Statusfilter aus "Alle" wirkt hier nicht.
    expect(ids(selectTodos(list, 'done', { ...DEFAULT_FILTERS, status: 'open' }, 'important', today, []))).toEqual(['fertig', 'idee-gemacht', 'spaeter-fertig', 'wichtig-fertig']);
  });
  it('Wichtig bietet die Faelligkeiten von Alle, Erledigt keine', () => {
    expect(dueOptions('important')).toEqual(dueOptions('all'));
    expect(dueOptions('done')).toEqual([{ id: 'any', label: 'Alle' }]);
  });
});

describe('Wichtig', () => {
  it('Sortierung "Wichtige zuerst", danach nach Faelligkeit', () => {
    const list = [
      todo('spaet', { due_date: '2026-11-20' }),
      todo('wichtig-spaet', { due_date: '2026-11-30', important: true }),
      todo('frueh', { due_date: '2026-11-05' }),
      todo('wichtig-ohne', { important: true }),
      todo('wichtig-frueh', { due_date: '2026-11-06', important: true }),
    ];
    expect(ids(selectTodos(list, 'all', DEFAULT_FILTERS, 'important', today, [])))
      .toEqual(['wichtig-frueh', 'wichtig-spaet', 'wichtig-ohne', 'frueh', 'spaet']);
    // Andere Sortierungen bleiben unveraendert.
    expect(ids(selectTodos(list, 'all', DEFAULT_FILTERS, 'due', today, [])))
      .toEqual(['frueh', 'wichtig-frueh', 'spaet', 'wichtig-spaet', 'wichtig-ohne']);
  });
});

describe('Suche', () => {
  const list = [
    todo('a', { title: 'Müll rausbringen' }),
    todo('b', { title: 'Keller', description: 'Alte Müllsäcke entsorgen' }),
    todo('c', { title: 'Garage' }),
    todo('d', { title: 'Müllabfuhr anrufen', status: 'done' }),
    todo('e', { title: 'Müll Geheim', deleted_at: '2026-11-01' }),
    todo('f', { title: 'Restaurant Adria', bucket: 'idea' }),
  ];
  const comments = [comment('c', 'Wo ist der Müllbeutel?'), comment('c', 'Straße fegen'), comment('a', 'gelöscht', '2026-11-01')];

  it('findet in Titel, Beschreibung und Kommentaren, Titel vor Beschreibung vor Kommentar, Erledigtes zuletzt', () => {
    expect(searchTodos(list, comments, 'müll').map((h) => [h.todo.id, h.where]))
      .toEqual([['a', 'title'], ['b', 'description'], ['c', 'comment'], ['d', 'title']]);
  });
  it('ignoriert Gross-/Kleinschreibung, Umlaute-Akzente und ß', () => {
    expect(ids(searchTodos(list, comments, 'MULL').map((h) => h.todo))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(searchTodos(list, comments, 'strasse').map((h) => h.todo))).toEqual(['c']);
    expect(normalize('Straße Café')).toBe('strasse cafe');
  });
  it('alle Woerter muessen vorkommen, auch verteilt', () => {
    expect(ids(searchTodos(list, comments, 'garage beutel').map((h) => h.todo))).toEqual(['c']);
    expect(searchTodos(list, comments, 'garage pizza')).toEqual([]);
  });
  it('findet Ideen, aber weder Geloeschtes noch geloeschte Kommentare; leere Suche liefert nichts', () => {
    expect(ids(searchTodos(list, comments, 'adria').map((h) => h.todo))).toEqual(['f']);
    expect(searchTodos(list, comments, 'geheim')).toEqual([]);
    expect(searchTodos(list, comments, 'gelöscht')).toEqual([]);
    expect(searchTodos(list, comments, '   ')).toEqual([]);
  });
});

describe('Papierkorb', () => {
  const now = new Date('2026-11-30T12:00:00Z');
  it('zeigt 30 Tage lang mit Resttagen, neueste zuerst', () => {
    const list = [
      todo('frisch', { deleted_at: '2026-11-30T11:00:00Z' }),
      todo('alt', { deleted_at: '2026-11-01T13:00:00Z' }),
      todo('abgelaufen', { deleted_at: '2026-10-31T11:00:00Z' }),
      todo('aktiv'),
    ];
    expect(trashTodos(list, now).map((e) => [e.todo.id, e.daysLeft])).toEqual([['frisch', 30], ['alt', 2]]);
  });
});

describe('Ideen', () => {
  it('offene Ideen, neueste zuerst; zaehlen nicht in der Statistik', () => {
    const list = [
      todo('kino', { bucket: 'idea', created_at: '2026-11-02T10:00:00Z' }),
      todo('wandern', { bucket: 'idea', created_at: '2026-11-03T10:00:00Z' }),
      todo('gemacht', { bucket: 'idea', status: 'done' }),
      todo('aufgabe', { effort_minutes: 10 }),
    ];
    expect(ids(openIdeas(list))).toEqual(['wandern', 'kino']);
    const stats = computeStats(list, [] as Profile[], 'any', today);
    expect(stats).toEqual([{ label: 'Beide', openCount: 1, openMinutes: 10, doneCount: null }]);
  });
});

describe('Spracheingabe', () => {
  it('haengt Erkanntes an, ein leeres Feld beginnt gross', () => {
    expect(appendSpoken('', 'rasen mähen')).toBe('Rasen mähen');
    expect(appendSpoken('Rasen mähen', ' und Hecke ')).toBe('Rasen mähen und Hecke');
    expect(appendSpoken('Rasen  ', 'heute')).toBe('Rasen heute');
    expect(appendSpoken('Rasen', '   ')).toBe('Rasen');
    expect(appendSpoken('', 'äpfel kaufen')).toBe('Äpfel kaufen');
  });
});

describe('Update-Hinweis', () => {
  it('liest Versionen mit und ohne "v"', () => {
    expect(parseVersion('v1.0.6')).toEqual([1, 0, 6]);
    expect(parseVersion('1.1')).toEqual([1, 1, 0]);
    expect(parseVersion('1.0.6-beta')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
  it('vergleicht numerisch, nicht als Text', () => {
    expect(isNewer('1.0.10', '1.0.9')).toBe(true);
    expect(isNewer('v1.0.6', '1.0.5')).toBe(true);
    expect(isNewer('1.0.5', '1.0.5')).toBe(false);
    expect(isNewer('1.0.4', '1.0.5')).toBe(false);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('kaputt', '1.0.5')).toBe(false);
  });
  it('nimmt die APK aus dem Release, sonst die Release-Seite', () => {
    const release = {
      tag_name: 'v1.0.6', html_url: 'https://github.com/x/y/releases/tag/v1.0.6', body: ' Neu: Ideen ',
      assets: [{ name: 'notes.txt', browser_download_url: 'n' }, { name: 'zahnwerk-1.0.6.apk', browser_download_url: 'https://dl/apk' }],
    };
    expect(pickRelease(release)).toEqual({ version: '1.0.6', url: 'https://dl/apk', notes: 'Neu: Ideen' });
    expect(pickRelease({ ...release, assets: [] })?.url).toBe(release.html_url);
    expect(pickRelease({ ...release, prerelease: true })).toBeNull();
    expect(pickRelease({ ...release, draft: true })).toBeNull();
    expect(pickRelease({ ...release, tag_name: 'nightly' })).toBeNull();
    expect(pickRelease(null)).toBeNull();
  });
});
