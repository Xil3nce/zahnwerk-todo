import { computed, Injectable, signal } from '@angular/core';
import { createClient, Session } from '@supabase/supabase-js';
import { liveQuery } from 'dexie';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { ZahnwerkDb } from './db';
import { berlinToday } from './due';
import { Category, Comment, Entity, Profile, Subtask, Template, Todo, TodoPatch } from './models';
import { PullResult, PushResult, runSync, SyncBackend } from './sync-engine';

@Injectable({ providedIn: 'root' })
export class Store {
  readonly supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  private readonly db = new ZahnwerkDb();

  readonly session = signal<Session | null>(null);
  readonly ready = signal(false);

  private readonly allTodos = signal<Todo[]>([]);
  private readonly allSubtasks = signal<Subtask[]>([]);
  private readonly allComments = signal<Comment[]>([]);
  private readonly allCategories = signal<Category[]>([]);
  private readonly allTemplates = signal<Template[]>([]);
  readonly profiles = signal<Profile[]>([]);
  readonly pendingCount = signal(0);

  readonly syncing = signal(false);
  readonly syncError = signal<string | null>(null);
  readonly lastSync = signal<Date | null>(null);
  /** Wird bei jedem App-Oeffnen neu gesetzt, damit relative Daten stimmen. */
  readonly today = signal(berlinToday());

  readonly todos = this.allTodos.asReadonly();
  /** Fuer die Suche; einzelne Aufgaben lesen ueber commentsOf. */
  readonly comments = this.allComments.asReadonly();
  readonly categories = computed(() =>
    this.allCategories().filter((c) => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de')),
  );
  readonly templates = computed(() =>
    this.allTemplates().filter((t) => !t.deleted_at).sort((a, b) => a.title.localeCompare(b.title, 'de')),
  );
  readonly me = computed(() => this.profiles().find((p) => p.user_id === this.session()?.user.id) ?? null);

  private readonly backend: SyncBackend = {
    push: async (ops) => {
      const { data, error } = await this.supabase.rpc('sync_push', { p_ops: ops });
      if (error) throw error;
      return data as PushResult;
    },
    pull: async (cursor) => {
      const { data, error } = await this.supabase.rpc('sync_pull', { p_cursor: cursor });
      if (error) throw error;
      return data as PullResult;
    },
  };

  constructor() {
    const watch = <T>(query: () => Promise<T>, apply: (value: T) => void) => liveQuery(query).subscribe({ next: apply });
    watch(() => this.db.todos.toArray(), (v) => this.allTodos.set(v));
    watch(() => this.db.subtasks.toArray(), (v) => this.allSubtasks.set(v));
    watch(() => this.db.comments.toArray(), (v) => this.allComments.set(v));
    watch(() => this.db.categories.toArray(), (v) => this.allCategories.set(v));
    watch(() => this.db.templates.toArray(), (v) => this.allTemplates.set(v));
    watch(() => this.db.profiles.toArray(), (v) => this.profiles.set(v));
    watch(() => this.db.outbox.count(), (v) => this.pendingCount.set(v));

    this.supabase.auth.onAuthStateChange((_event, session) => this.session.set(session));
    void navigator.storage?.persist?.();
  }

  async init(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this.session.set(data.session);
    this.ready.set(true);
  }

  async signIn(email: string, password: string): Promise<string | null> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort ist falsch.' : 'Anmeldung fehlgeschlagen. Besteht eine Verbindung?';
    await this.sync();
    return null;
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut({ scope: 'local' });
    await Promise.all(this.db.tables.map((t) => t.clear()));
  }

  async sync(): Promise<void> {
    this.today.set(berlinToday());
    if (this.syncing() || !this.session()) return;
    this.syncing.set(true);
    try {
      const rejected = await runSync(this.db, this.backend);
      this.lastSync.set(new Date());
      this.syncError.set(rejected.length ? `${rejected.length} Änderung(en) wurden vom Server abgelehnt.` : null);
      if (rejected.length) console.error('sync rejected', rejected);
    } catch (error) {
      console.warn('sync failed', error);
      this.syncError.set('Keine Verbindung. Änderungen werden später übertragen.');
    } finally {
      this.syncing.set(false);
    }
  }

  private async record(entity: Entity, id: string, fields: Record<string, unknown>): Promise<void> {
    await this.db.outbox.add({
      op_id: crypto.randomUUID(), entity, id, fields, changed_at: new Date().toISOString(),
    });
  }

  private afterChange(): void {
    void this.sync();
  }

  // ------------------------------------------------------------ Aufgaben

  todo(id: string): Todo | undefined {
    return this.allTodos().find((t) => t.id === id);
  }

  async createTodo(patch: TodoPatch & { title: string }): Promise<string> {
    const id = crypto.randomUUID();
    const row: Todo = {
      id, description: '', category_id: null, due_date: null, assignee_id: null, effort_minutes: null,
      status: 'open', done_at: null, done_by: null, created_by: this.me()?.id ?? '',
      created_at: new Date().toISOString(), deleted_at: null, ...patch,
    };
    await this.db.transaction('rw', this.db.todos, this.db.outbox, async () => {
      await this.db.todos.put(row);
      await this.record('todo', id, { ...patch });
    });
    this.afterChange();
    return id;
  }

  /** Nur die wirklich geaenderten Felder uebergeben: der Server fuehrt pro Feld zusammen. */
  async updateTodo(id: string, patch: TodoPatch): Promise<void> {
    if (!Object.keys(patch).length) return;
    await this.db.transaction('rw', this.db.todos, this.db.outbox, async () => {
      const local: Partial<Todo> = { ...patch };
      if (patch.status === 'done') {
        local.done_at = new Date().toISOString();
        local.done_by = this.me()?.id ?? null;
      } else if (patch.status === 'open') {
        local.done_at = null;
        local.done_by = null;
      }
      await this.db.todos.update(id, local);
      await this.record('todo', id, { ...patch });
    });
    this.afterChange();
  }

  toggleDone(todo: Todo): Promise<void> {
    return this.updateTodo(todo.id, { status: todo.status === 'open' ? 'done' : 'open' });
  }

  deleteTodo(id: string): Promise<void> {
    return this.updateTodo(id, { deleted_at: new Date().toISOString() });
  }

  /** Aus dem Papierkorb zurueckholen (30 Tage lang moeglich, danach entfernt der Server sie). */
  restoreTodo(id: string): Promise<void> {
    return this.updateTodo(id, { deleted_at: null });
  }

  // ------------------------------------------------------------ Unteraufgaben

  subtasksOf(todoId: string): Subtask[] {
    return this.allSubtasks().filter((s) => s.todo_id === todoId && !s.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
  }

  private async putSubtask(row: Subtask): Promise<void> {
    await this.db.transaction('rw', this.db.subtasks, this.db.outbox, async () => {
      await this.db.subtasks.put(row);
      await this.record('subtask', row.id, {
        todo_id: row.todo_id, title: row.title, is_done: row.is_done, sort_order: row.sort_order, deleted_at: row.deleted_at,
      });
    });
    this.afterChange();
  }

  addSubtask(todoId: string, title: string): Promise<void> {
    const sort = Math.max(0, ...this.subtasksOf(todoId).map((s) => s.sort_order)) + 1;
    return this.putSubtask({ id: crypto.randomUUID(), todo_id: todoId, title, is_done: false, sort_order: sort, deleted_at: null });
  }

  toggleSubtask(row: Subtask): Promise<void> {
    return this.putSubtask({ ...row, is_done: !row.is_done });
  }

  deleteSubtask(row: Subtask): Promise<void> {
    return this.putSubtask({ ...row, deleted_at: new Date().toISOString() });
  }

  // ------------------------------------------------------------ Kommentare

  commentsOf(todoId: string): Comment[] {
    return this.allComments().filter((c) => c.todo_id === todoId && !c.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async addComment(todoId: string, body: string): Promise<void> {
    const row: Comment = {
      id: crypto.randomUUID(), todo_id: todoId, author_id: this.me()?.id ?? '', body,
      created_at: new Date().toISOString(), deleted_at: null,
    };
    await this.db.transaction('rw', this.db.comments, this.db.outbox, async () => {
      await this.db.comments.put(row);
      await this.record('comment', row.id, { todo_id: todoId, body, deleted_at: null });
    });
    this.afterChange();
  }

  async deleteComment(row: Comment): Promise<void> {
    const deleted_at = new Date().toISOString();
    await this.db.transaction('rw', this.db.comments, this.db.outbox, async () => {
      await this.db.comments.update(row.id, { deleted_at });
      await this.record('comment', row.id, { todo_id: row.todo_id, body: row.body, deleted_at });
    });
    this.afterChange();
  }

  // ------------------------------------------------------------ Kategorien

  categoryName(id: string | null): string {
    return this.categories().find((c) => c.id === id)?.name ?? 'Ohne Kategorie';
  }

  categoryColor(id: string | null): string | null {
    return this.categories().find((c) => c.id === id)?.color ?? null;
  }

  private async putCategory(row: Category): Promise<void> {
    await this.db.transaction('rw', this.db.categories, this.db.outbox, async () => {
      await this.db.categories.put(row);
      await this.record('category', row.id, {
        name: row.name, sort_order: row.sort_order, color: row.color ?? null, deleted_at: row.deleted_at,
      });
    });
    this.afterChange();
  }

  addCategory(name: string): Promise<void> {
    const sort = Math.max(0, ...this.categories().map((c) => c.sort_order)) + 1;
    return this.putCategory({ id: crypto.randomUUID(), name, sort_order: sort, deleted_at: null });
  }

  renameCategory(row: Category, name: string): Promise<void> {
    return this.putCategory({ ...row, name });
  }

  setCategoryColor(row: Category, color: string | null): Promise<void> {
    return this.putCategory({ ...row, color });
  }

  deleteCategory(row: Category): Promise<void> {
    return this.putCategory({ ...row, deleted_at: new Date().toISOString() });
  }

  // ------------------------------------------------------------ Vorlagen

  template(id: string): Template | undefined {
    return this.templates().find((t) => t.id === id);
  }

  /** Vorlagen gehen wie Kategorien immer als vollstaendiger Datensatz in die Outbox. */
  async saveTemplate(row: Template): Promise<void> {
    await this.db.transaction('rw', this.db.templates, this.db.outbox, async () => {
      await this.db.templates.put(row);
      await this.record('template', row.id, {
        title: row.title, description: row.description, category_id: row.category_id, effort_minutes: row.effort_minutes,
        important: row.important, items: row.items, deleted_at: row.deleted_at,
      });
    });
    // liveQuery meldet sich erst spaeter; eine gleich danach geoeffnete Seite soll die Vorlage schon finden.
    this.allTemplates.update((list) => [...list.filter((t) => t.id !== row.id), row]);
    this.afterChange();
  }

  deleteTemplate(row: Template): Promise<void> {
    return this.saveTemplate({ ...row, deleted_at: new Date().toISOString() });
  }

  /** Neue Vorlage aus einer bestehenden Aufgabe; offene und erledigte Unteraufgaben werden zur Checkliste. */
  async templateFromTodo(todo: Todo): Promise<string> {
    const id = crypto.randomUUID();
    await this.saveTemplate({
      // Grenzen wie in der Datenbank (Beschreibung 4000 Zeichen, Checkliste 100 Punkte), sonst lehnt der Server die Vorlage ab.
      id, title: todo.title, description: (todo.description ?? '').slice(0, 4000), category_id: todo.category_id,
      effort_minutes: todo.effort_minutes, important: !!todo.important,
      items: this.subtasksOf(todo.id).map((s) => s.title).slice(0, 100), deleted_at: null,
    });
    return id;
  }

  /**
   * Legt aus einer Vorlage eine normale Aufgabe mit Unteraufgaben an, alles in einer Transaktion,
   * damit die Aufgabe vor ihren Unteraufgaben beim Server ankommt.
   */
  async startTemplate(tpl: Template, extra: TodoPatch = {}): Promise<string> {
    const id = crypto.randomUUID();
    // Eine inzwischen geloeschte Kategorie wuerde die Aufgabe unsichtbar einsortieren.
    const category_id = this.categories().some((c) => c.id === tpl.category_id) ? tpl.category_id : null;
    const patch: TodoPatch & { title: string } = {
      title: tpl.title, description: tpl.description, category_id, effort_minutes: tpl.effort_minutes,
      important: tpl.important, ...extra,
    };
    const row: Todo = {
      id, description: '', category_id: null, due_date: null, assignee_id: null, effort_minutes: null,
      status: 'open', done_at: null, done_by: null, created_by: this.me()?.id ?? '',
      created_at: new Date().toISOString(), deleted_at: null, ...patch,
    };
    const subtasks: Subtask[] = tpl.items.map((title, i) => ({
      id: crypto.randomUUID(), todo_id: id, title, is_done: false, sort_order: i + 1, deleted_at: null,
    }));
    await this.db.transaction('rw', this.db.todos, this.db.subtasks, this.db.outbox, async () => {
      await this.db.todos.put(row);
      await this.record('todo', id, { ...patch });
      for (const s of subtasks) {
        await this.db.subtasks.put(s);
        await this.record('subtask', s.id, {
          todo_id: id, title: s.title, is_done: false, sort_order: s.sort_order, deleted_at: null,
        });
      }
    });
    // Siehe saveTemplate: die Bearbeitungsseite wird sofort geoeffnet und muss die Aufgabe schon finden.
    this.allTodos.update((list) => [...list, row]);
    this.allSubtasks.update((list) => [...list, ...subtasks]);
    this.afterChange();
    return id;
  }

  // ------------------------------------------------------------ Einstellungen

  /** Einstellungen gehen direkt an den Server, weil Pushes dort entschieden werden. */
  async updateSettings(patch: Partial<Profile>): Promise<boolean> {
    const me = this.me();
    if (!me) return false;
    const { error } = await this.supabase.from('profiles').update(patch).eq('id', me.id);
    if (error) return false;
    await this.db.profiles.update(me.id, patch);
    return true;
  }
}
