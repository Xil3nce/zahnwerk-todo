import { describe, expect, it } from 'vitest';
import { Category, Profile, Todo } from './models';
import { computeStats, DEFAULT_FILTERS, dueOptions, selectTodos } from './views';

const today = '2026-11-04'; // Mittwoch
const todo = (id: string, patch: Partial<Todo> = {}): Todo => ({
  id, title: id, description: '', category_id: null, due_date: null, assignee_id: null,
  effort_minutes: null, status: 'open', done_at: null, done_by: null, created_by: 'f',
  created_at: '', deleted_at: null, ...patch,
});
const ids = (list: Todo[]) => list.map((t) => t.id);
const cats: Category[] = [
  { id: 'g', name: 'Garten', sort_order: 1, deleted_at: null },
  { id: 'x', name: 'Weg', sort_order: 2, deleted_at: '2026-01-01' },
];

describe('selectTodos', () => {
  const todos = [
    todo('over', { due_date: '2026-11-01' }),
    todo('now', { due_date: today }),
    todo('sun', { due_date: '2026-11-08' }),
    todo('next', { due_date: '2026-11-09' }),
    todo('nodate'),
    todo('done', { due_date: today, status: 'done' }),
    todo('gone', { due_date: today, deleted_at: '2026-11-01' }),
  ];

  it('Heute zeigt offene bis heute inklusive Ueberfaelliger', () => {
    expect(ids(selectTodos(todos, 'today', DEFAULT_FILTERS, 'due', today, []))).toEqual(['over', 'now']);
  });
  it('Woche reicht bis Sonntag', () => {
    expect(ids(selectTodos(todos, 'week', DEFAULT_FILTERS, 'due', today, []))).toEqual(['over', 'now', 'sun']);
  });
  it('Alle zeigt offene, Datumslose zuletzt, Geloeschte nie', () => {
    expect(ids(selectTodos(todos, 'all', DEFAULT_FILTERS, 'due', today, []))).toEqual(['over', 'now', 'sun', 'next', 'nodate']);
  });
  it('Statusfilter zeigt Erledigte', () => {
    expect(ids(selectTodos(todos, 'all', { ...DEFAULT_FILTERS, status: 'done' }, 'due', today, []))).toEqual(['done']);
  });
  it('Faelligkeitsfilter grenzt die Wochen sauber ab', () => {
    const run = (due: typeof DEFAULT_FILTERS.due) => ids(selectTodos(todos, 'all', { ...DEFAULT_FILTERS, due }, 'due', today, []));
    expect(run('overdue')).toEqual(['over']);
    expect(run('this_week')).toEqual(['now', 'sun']);
    expect(run('next_week')).toEqual(['next']);
    expect(run('none')).toEqual(['nodate']);
  });
  it('Heute und Woche bieten nur Faelligkeiten an, die dort etwas zeigen koennen', () => {
    const run = (view: 'today' | 'week', due: typeof DEFAULT_FILTERS.due) =>
      ids(selectTodos(todos, view, { ...DEFAULT_FILTERS, due }, 'due', today, []));
    expect(dueOptions('today').map((o) => o.id)).toEqual(['any', 'today', 'overdue']);
    expect(run('today', 'today')).toEqual(['now']);
    expect(run('today', 'overdue')).toEqual(['over']);
    expect(dueOptions('week').map((o) => o.id)).toEqual(['any', 'this_week', 'today', 'overdue']);
    expect(run('week', 'this_week')).toEqual(['now', 'sun']);
  });
  it('Personenfilter schliesst Beide ein, Melina sieht keine reine Freddy-Aufgabe', () => {
    const list = [todo('f', { assignee_id: 'freddy' }), todo('m', { assignee_id: 'melina' }), todo('b')];
    expect(ids(selectTodos(list, 'all', { ...DEFAULT_FILTERS, person: 'melina' }, 'due', today, []))).toEqual(['b', 'm']);
    expect(ids(selectTodos(list, 'all', { ...DEFAULT_FILTERS, person: 'both' }, 'due', today, []))).toEqual(['b']);
  });
  it('geloeschte Kategorie zaehlt als ohne Kategorie', () => {
    const list = [todo('a', { category_id: 'g' }), todo('b', { category_id: 'x' }), todo('c')];
    expect(ids(selectTodos(list, 'all', { ...DEFAULT_FILTERS, category: 'none' }, 'due', today, cats))).toEqual(['b', 'c']);
  });
  it('sortiert nach Aufwand mit Leeren zuletzt', () => {
    const list = [todo('leer'), todo('lang', { effort_minutes: 60 }), todo('kurz', { effort_minutes: 5 })];
    expect(ids(selectTodos(list, 'all', DEFAULT_FILTERS, 'effort', today, []))).toEqual(['kurz', 'lang', 'leer']);
  });
});

describe('computeStats', () => {
  it('zaehlt Beide separat und nicht doppelt', () => {
    const profiles = [{ id: 'f', display_name: 'Freddy' }, { id: 'm', display_name: 'Melina' }] as Profile[];
    const stats = computeStats([
      todo('1', { assignee_id: 'f', effort_minutes: 30 }),
      todo('2', { effort_minutes: 15 }),
      todo('3', { status: 'done', done_by: 'm', effort_minutes: 99 }),
      todo('4', { deleted_at: 'x', assignee_id: 'f', effort_minutes: 99 }),
    ], profiles, 'any', today);
    expect(stats).toEqual([
      { label: 'Freddy', openCount: 1, openMinutes: 30, doneCount: 0 },
      { label: 'Melina', openCount: 0, openMinutes: 0, doneCount: 1 },
      { label: 'Beide', openCount: 1, openMinutes: 15, doneCount: null },
    ]);
  });
  it('Faelligkeitsfilter zaehlt nur passende Aufgaben, auch bei Erledigten', () => {
    const profiles = [{ id: 'f', display_name: 'Freddy' }] as Profile[];
    const stats = computeStats([
      todo('1', { assignee_id: 'f', due_date: today, effort_minutes: 30 }),
      todo('2', { assignee_id: 'f', due_date: '2026-11-09', effort_minutes: 15 }),
      todo('3', { assignee_id: 'f', status: 'done', done_by: 'f', due_date: today }),
      todo('4', { assignee_id: 'f', status: 'done', done_by: 'f' }),
    ], profiles, 'today', today);
    expect(stats[0]).toEqual({ label: 'Freddy', openCount: 1, openMinutes: 30, doneCount: 1 });
  });
});
