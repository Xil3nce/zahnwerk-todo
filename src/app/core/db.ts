import Dexie, { Table } from 'dexie';
import { Category, Comment, OutboxOp, Profile, Subtask, Todo } from './models';

export class ZahnwerkDb extends Dexie {
  todos!: Table<Todo, string>;
  subtasks!: Table<Subtask, string>;
  comments!: Table<Comment, string>;
  categories!: Table<Category, string>;
  profiles!: Table<Profile, string>;
  outbox!: Table<OutboxOp, number>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'zahnwerk') {
    super(name);
    this.version(1).stores({
      todos: 'id, due_date, status',
      subtasks: 'id, todo_id',
      comments: 'id, todo_id',
      categories: 'id',
      profiles: 'id, user_id',
      outbox: '++seq',
      meta: 'key',
    });
  }
}
