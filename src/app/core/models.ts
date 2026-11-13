export interface Profile {
  id: string;
  user_id: string;
  household_id: string;
  display_name: string;
  reminder_time: string;
  notify_done: boolean;
  notify_new: boolean;
  notify_changed: boolean;
  notify_due_today: boolean;
  notify_overdue: boolean;
  notify_comment: boolean;
  /** Keine Pushes von 22 bis 7 Uhr, morgens gesammelt; fehlt bei Daten vor 1.0.6. */
  quiet_hours?: boolean;
  server_seq: number;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  /** #rrggbb aus CATEGORY_COLORS oder null; fehlt bei Daten aus App-Versionen vor 1.0.4. */
  color?: string | null;
  deleted_at: string | null;
}

export interface Todo {
  id: string;
  title: string;
  description: string;
  category_id: string | null;
  due_date: string | null;
  /** null bedeutet "Beide". */
  assignee_id: string | null;
  effort_minutes: number | null;
  status: 'open' | 'done';
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
  /** Fehlt bei Daten aus App-Versionen vor 1.0.5. */
  recurrence?: Recurrence | null;
  /** Folgeaufgabe bzw. Vorgaenger einer Wiederholung; setzt nur der Server. */
  spawned_id?: string | null;
  recurred_from?: string | null;
  /** Einmalige Erinnerung (ISO-Zeitpunkt); fehlt bei Daten aus App-Versionen vor 1.0.5. */
  remind_at?: string | null;
  /** Ab 1.0.6; fehlende Werte gelten als false bzw. null. */
  important?: boolean;
  /** Zeitfenster statt Stichtag; due_date ist dann das Ende des Fensters. */
  due_window?: DueWindow | null;
  /** later: Spaeter-Ablage, idea: Ideen-Parkplatz, null: normale Aufgabe. */
  bucket?: Bucket | null;
}

export type DueWindow = 'week' | 'month';
export type Bucket = 'later' | 'idea';

export type RecurrenceUnit = 'day' | 'week' | 'month';

export interface Recurrence {
  every: number;
  unit: RecurrenceUnit;
  /** schedule: fester Takt ab Faelligkeit; completion: ab dem Tag der Erledigung. */
  mode: 'schedule' | 'completion';
}

export interface Subtask {
  id: string;
  todo_id: string;
  title: string;
  is_done: boolean;
  sort_order: number;
  deleted_at: string | null;
}

export interface Comment {
  id: string;
  todo_id: string;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

/** Vorlage fuer wiederkehrende Ablaeufe ("Urlaub packen"); items werden beim Starten zu Unteraufgaben. Ab 1.0.8. */
export interface Template {
  id: string;
  title: string;
  description: string;
  category_id: string | null;
  effort_minutes: number | null;
  important: boolean;
  items: string[];
  deleted_at: string | null;
}

export type Entity = 'todo' | 'subtask' | 'comment' | 'category' | 'template';

export interface OutboxOp {
  seq?: number;
  op_id: string;
  entity: Entity;
  id: string;
  fields: Record<string, unknown>;
  changed_at: string;
}

export type TodoPatch = Partial<
  Pick<Todo, 'title' | 'description' | 'category_id' | 'due_date' | 'assignee_id' | 'effort_minutes' | 'status' | 'deleted_at' | 'recurrence' | 'remind_at' | 'important' | 'due_window' | 'bucket'>
>;
