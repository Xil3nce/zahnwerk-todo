// Tests fuer Version 1.0.8: "Ich hab X Minuten". Vorlagen im Sync stehen in sync-engine.spec.ts.
import { describe, expect, it } from 'vitest';
import { Todo } from './models';
import { suggestForTime, timeRank } from './views';

const today = '2026-11-04'; // Mittwoch, Woche endet 2026-11-08
const todo = (id: string, patch: Partial<Todo> = {}): Todo => ({
  id, title: id, description: '', category_id: null, due_date: null, assignee_id: null,
  effort_minutes: null, status: 'open', done_at: null, done_by: null, created_by: 'f',
  created_at: '2026-11-01T10:00:00Z', deleted_at: null, ...patch,
});
const ids = (list: Todo[]) => list.map((t) => t.id);

describe('Ich hab Zeit', () => {
  it('rangiert ueberfaellig, heute, wichtig, Woche, spaeter, ohne Datum', () => {
    expect([
      todo('a', { due_date: '2026-11-01' }),
      todo('b', { due_date: today }),
      todo('c', { important: true, due_date: '2026-12-01' }),
      todo('d', { due_date: '2026-11-08' }),
      todo('e', { due_date: '2026-11-09' }),
      todo('f'),
    ].map((t) => timeRank(t, today))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('fuellt die Zeit mit Dringendem zuerst und listet Passendes einzeln', () => {
    const todos = [
      todo('spaeter', { effort_minutes: 10 }),
      todo('ueberfaellig', { effort_minutes: 20, due_date: '2026-11-02' }),
      todo('heute', { effort_minutes: 15, due_date: today }),
      todo('zu-lang', { effort_minutes: 60 }),
      todo('ohne-zeit', { due_date: today }),
    ];
    const r = suggestForTime(todos, 30, 'any', today);
    // 'heute' (15) passt nach 20 nicht mehr, 'spaeter' (10) schon.
    expect(ids(r.plan)).toEqual(['ueberfaellig', 'spaeter']);
    expect(r.planMinutes).toBe(30);
    expect(ids(r.others)).toEqual(['heute']);
    expect(ids(suggestForTime(todos, 45, 'any', today).plan)).toEqual(['ueberfaellig', 'heute', 'spaeter']);
    expect(ids([...r.plan, ...r.others])).not.toContain('zu-lang');
    expect(r.withoutEffort).toBe(1);
  });

  it('beachtet Person, Erledigtes, Ideen und Papierkorb', () => {
    const todos = [
      todo('meins', { effort_minutes: 5, assignee_id: 'f' }),
      todo('beide', { effort_minutes: 5 }),
      todo('ihrs', { effort_minutes: 5, assignee_id: 'm' }),
      todo('erledigt', { effort_minutes: 5, status: 'done' }),
      todo('idee', { effort_minutes: 5, bucket: 'idea' }),
      todo('weg', { effort_minutes: 5, deleted_at: '2026-11-03T00:00:00Z' }),
    ];
    expect(ids(suggestForTime(todos, 60, 'f', today).plan).sort()).toEqual(['beide', 'meins']);
    expect(ids(suggestForTime(todos, 60, 'any', today).plan).sort()).toEqual(['beide', 'ihrs', 'meins']);
  });

  it('nichts Passendes ergibt leere Listen', () => {
    const r = suggestForTime([todo('gross', { effort_minutes: 120 })], 10, 'any', today);
    expect(r).toEqual({ plan: [], planMinutes: 0, others: [], withoutEffort: 0 });
  });
});

