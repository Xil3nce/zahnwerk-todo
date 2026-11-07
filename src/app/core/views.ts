import { addDays, endOfWeek } from './due';
import { Category, Comment, Profile, Todo } from './models';

/** Spaeter: Ablage ohne Datum; Erledigt: abgehakte Aufgaben und Ideen. */
export type View = 'today' | 'week' | 'all' | 'later' | 'done';
export type SortBy = 'due' | 'important' | 'category' | 'effort';
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
    case 'later':
    case 'done':
      return [{ id: 'any', label: 'Alle' }];
  }
}

/** Status, den eine Ansicht erzwingt; nur "Alle" laesst den Statusfilter gelten. */
export function viewStatus(view: View, filter: StatusFilter): StatusFilter {
  if (view === 'all') return filter;
  return view === 'done' ? 'done' : 'open';
}

export function matchesView(todo: Todo, view: View, today: string): boolean {
  const bucket = todo.bucket ?? null;
  switch (view) {
    case 'done':
      return todo.status === 'done';
    case 'later':
      return bucket === 'later';
    case 'all':
      // Ablage und Ideen gehen in "Alle" nicht unter, sie haben eigene Listen.
      return bucket === null;
    default:
      if (bucket !== null || todo.status !== 'open' || !todo.due_date) return false;
      return todo.due_date <= (view === 'today' ? today : endOfWeek(today));
  }
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
  // Heute, Woche und Spaeter zeigen nur Offenes, Erledigt nur Erledigtes.
  const status = viewStatus(view, filters.status);
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
  // Erledigt: zuletzt Abgehaktes oben, unabhaengig von der Sortierung.
  if (view === 'done') {
    return [...visible].sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '') || a.title.localeCompare(b.title, 'de'));
  }
  const compare: Record<SortBy, (a: Todo, b: Todo) => number> = {
    due: byDue,
    important: (a, b) => Number(!!b.important) - Number(!!a.important) || byDue(a, b),
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

export function computeStats(todos: Todo[], profiles: Profile[], due: DueFilter, today: string): PersonStats[] {
  // Ideen sind keine Aufgaben und zaehlen nicht mit.
  const live = todos.filter((t) => !t.deleted_at && t.bucket !== 'idea' && matchesDue(t, due, today));
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

// ------------------------------------------------------------ Suche

/** Klein, ohne Akzente, "ß" als "ss": "mull" und "MÜLL" finden "Müll". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

export type SearchHit = { todo: Todo; where: 'title' | 'description' | 'comment' };

/**
 * Sucht in Titel, Beschreibung und Kommentaren aller nicht geloeschten Aufgaben und Ideen.
 * Jedes Wort muss irgendwo vorkommen. Offene vor erledigten, Titeltreffer vor den anderen.
 */
export function searchTodos(todos: Todo[], comments: Comment[], query: string): SearchHit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const commentText = new Map<string, string>();
  for (const c of comments) {
    if (!c.deleted_at) commentText.set(c.todo_id, (commentText.get(c.todo_id) ?? '') + '\n' + normalize(c.body));
  }
  const hits: SearchHit[] = [];
  for (const todo of todos) {
    if (todo.deleted_at) continue;
    const title = normalize(todo.title);
    const text = `${title}\n${normalize(todo.description ?? '')}`;
    const all = `${text}\n${commentText.get(todo.id) ?? ''}`;
    if (!words.every((w) => all.includes(w))) continue;
    const where = words.every((w) => title.includes(w)) ? 'title' : words.every((w) => text.includes(w)) ? 'description' : 'comment';
    hits.push({ todo, where });
  }
  const rank = { title: 0, description: 1, comment: 2 };
  return hits.sort((a, b) =>
    Number(a.todo.status === 'done') - Number(b.todo.status === 'done') ||
    rank[a.where] - rank[b.where] ||
    (a.todo.due_date ?? '9999').localeCompare(b.todo.due_date ?? '9999') ||
    a.todo.title.localeCompare(b.todo.title, 'de'));
}

// ------------------------------------------------------------ Papierkorb

export const TRASH_DAYS = 30;

/** Geloeschte Aufgaben der letzten 30 Tage, zuletzt Geloeschtes oben, mit verbleibenden Tagen. */
export function trashTodos(todos: Todo[], now: Date = new Date()): { todo: Todo; daysLeft: number }[] {
  return todos
    .filter((t) => !!t.deleted_at)
    .map((todo) => ({
      todo,
      daysLeft: Math.ceil(TRASH_DAYS - (now.getTime() - Date.parse(todo.deleted_at!)) / 86_400_000),
    }))
    .filter((t) => t.daysLeft > 0)
    .sort((a, b) => b.todo.deleted_at!.localeCompare(a.todo.deleted_at!));
}

/** Ideen-Parkplatz: offene Ideen, neueste oben. */
export function openIdeas(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => !t.deleted_at && t.bucket === 'idea' && t.status === 'open')
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.title.localeCompare(b.title, 'de'));
}
