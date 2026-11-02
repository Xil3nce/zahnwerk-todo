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
  server_seq: number;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
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

export type Entity = 'todo' | 'subtask' | 'comment' | 'category';

export interface OutboxOp {
  seq?: number;
  op_id: string;
  entity: Entity;
  id: string;
  fields: Record<string, unknown>;
  changed_at: string;
}

export type TodoPatch = Partial<
  Pick<Todo, 'title' | 'description' | 'category_id' | 'due_date' | 'assignee_id' | 'effort_minutes' | 'status' | 'deleted_at'>
>;
