import { addDays, endOfWeek } from './due';
import { Category, Profile, Todo } from './models';

export type View = 'today' | 'week' | 'all';
export type SortBy = 'due' | 'category' | 'effort';
export type DueFilter = 'any' | 'overdue' | 'today' | 'this_week' | 'next_week' | 'none';
export type StatusFilter = 'open' | 'done' | 'any';

export interface Filters {
  /** Profil-ID, "both" oder "any". Eine Person sieht auch die Aufgaben fuer "Beide". */
  person: string;
  category: string;
  due: DueFilter;
  status: StatusFilter;
}

export const DEFAULT_FILTERS: Filters = { person: 'any', category: 'any', due: 'any', status: 'open' };

/** Faelligkeits-Optionen je Ansicht: Heute und Woche grenzen schon selbst ein, "any" heisst dort "alles in der Ansicht". */
export function dueOptions(view: View): { id: DueFilter; label: string }[] {
  switch (view) {
    case 'today':
      return [
        { id: 'any', label: 'Heute und überfällig' },
        { id: 'today', label: 'Nur heute' },
        { id: 'overdue', label: 'Nur überfällig' },
      ];
    case 'week':
      return [
        { id: 'any', label: 'Ganze Woche und überfällig' },
        { id: 'this_week', label: 'Ab heute bis Sonntag' },
        { id: 'today', label: 'Nur heute' },
        { id: 'overdue', label: 'Nur überfällig' },
      ];
    case 'all':
      return [
        { id: 'any', label: 'Alle' },
        { id: 'overdue', label: 'Überfällig' },
        { id: 'today', label: 'Heute' },
        { id: 'this_week', label: 'Diese Woche' },
        { id: 'next_week', label: 'Nächste Woche' },
        { id: 'none', label: 'Ohne Datum' },
      ];
  }
}

export function matchesView(todo: Todo, view: View, today: string): boolean {
  if (view === 'all') return true;
  if (todo.status !== 'open' || !todo.due_date) return false;
  return todo.due_date <= (view === 'today' ? today : endOfWeek(today));
}

function matchesDue(todo: Todo, due: DueFilter, today: string): boolean {
  const date = todo.due_date;
  const week = endOfWeek(today);
  switch (due) {
    case 'any':
      return true;
    case 'none':
      return !date;
    case 'overdue':
      return !!date && date < today;
    case 'today':
      return date === today;
    case 'this_week':
      return !!date && date >= today && date <= week;
    case 'next_week':
      return !!date && date > week && date <= addDays(week, 7);
  }
}

export function selectTodos(
  todos: Todo[], view: View, filters: Filters, sort: SortBy, today: string, categories: Category[],
): Todo[] {
  const categoryName = (id: string | null) => categories.find((c) => c.id === id && !c.deleted_at)?.name ?? '￿';
  // In den Ansichten Heute und Woche sind immer nur offene Aufgaben relevant.
  const status = view === 'all' ? filters.status : 'open';
  const visible = todos.filter(
    (t) =>
      !t.deleted_at &&
      matchesView(t, view, today) &&
      (status === 'any' || t.status === status) &&
      (filters.person === 'any' ||
        (filters.person === 'both' ? t.assignee_id === null : t.assignee_id === null || t.assignee_id === filters.person)) &&
      (filters.category === 'any' ||
        (filters.category === 'none' ? categoryName(t.category_id) === '￿' : t.category_id === filters.category)) &&
      matchesDue(t, filters.due, today),
  );
  const byDue = (a: Todo, b: Todo) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');
  const compare: Record<SortBy, (a: Todo, b: Todo) => number> = {
    due: byDue,
    category: (a, b) => categoryName(a.category_id).localeCompare(categoryName(b.category_id), 'de') || byDue(a, b),
    effort: (a, b) => (a.effort_minutes ?? Infinity) - (b.effort_minutes ?? Infinity) || byDue(a, b),
  };
  return [...visible].sort((a, b) => compare[sort](a, b) || a.title.localeCompare(b.title, 'de'));
}

export interface PersonStats {
  label: string;
  openCount: number;
  openMinutes: number;
  doneCount: number | null;
}

export function computeStats(todos: Todo[], profiles: Profile[]): PersonStats[] {
  const live = todos.filter((t) => !t.deleted_at);
  const open = live.filter((t) => t.status === 'open');
  const sum = (list: Todo[]) => list.reduce((total, t) => total + (t.effort_minutes ?? 0), 0);
  const people = profiles.map((p) => {
    const mine = open.filter((t) => t.assignee_id === p.id);
    return {
      label: p.display_name,
      openCount: mine.length,
      openMinutes: sum(mine),
      doneCount: live.filter((t) => t.status === 'done' && t.done_by === p.id).length,
    };
  });
  const both = open.filter((t) => t.assignee_id === null);
  return [...people, { label: 'Beide', openCount: both.length, openMinutes: sum(both), doneCount: null }];
}
