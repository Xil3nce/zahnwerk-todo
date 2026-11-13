import { ZahnwerkDb } from './db';
import { OutboxOp, Todo } from './models';

export interface PullResult {
  cursor: number;
  todos: Todo[];
  subtasks: never[] | Record<string, unknown>[];
  comments: never[] | Record<string, unknown>[];
  categories: never[] | Record<string, unknown>[];
  profiles: never[] | Record<string, unknown>[];
  /** Fehlt bei Servern ohne Migration 20261113090000_templates. */
  templates?: never[] | Record<string, unknown>[];
}

export interface PushResult {
  applied: string[];
  rejected: { op_id: string; error: string }[];
}

export interface SyncBackend {
  push(ops: OutboxOp[]): Promise<PushResult>;
  pull(cursor: number): Promise<PullResult>;
}

const BATCH = 200;

function applyOp(row: Record<string, unknown>, op: OutboxOp): Record<string, unknown> {
  return { ...row, ...op.fields };
}

/** Sendet die Outbox und holt danach alles seit dem letzten Cursor. Liefert abgelehnte Operationen. */
export async function runSync(db: ZahnwerkDb, backend: SyncBackend): Promise<PushResult['rejected']> {
  const rejected: PushResult['rejected'] = [];

  for (;;) {
    const ops = await db.outbox.orderBy('seq').limit(BATCH).toArray();
    if (!ops.length) break;
    const result = await backend.push(ops.map(({ seq: _seq, ...op }) => op));
    rejected.push(...result.rejected);
    // Unbekannte Antwort: lieber erneut senden (idempotent per op_id) als Aenderungen verlieren.
    const done = new Set([...result.applied, ...result.rejected.map((r) => r.op_id)]);
    const seqs = ops.filter((op) => done.has(op.op_id)).map((op) => op.seq!);
    if (!seqs.length) throw new Error('Sync: Server hat keine Operation bestätigt');
    await db.outbox.bulkDelete(seqs);
  }

  const cursor = ((await db.meta.get('cursor'))?.value as number | undefined) ?? 0;
  const pulled = await backend.pull(cursor);

  await db.transaction('rw', [db.todos, db.subtasks, db.comments, db.categories, db.templates, db.profiles, db.outbox, db.meta], async () => {
    await db.todos.bulkPut(pulled.todos);
    await db.subtasks.bulkPut(pulled.subtasks as never[]);
    await db.comments.bulkPut(pulled.comments as never[]);
    await db.categories.bulkPut(pulled.categories as never[]);
    await db.profiles.bulkPut(pulled.profiles as never[]);
    await db.templates.bulkPut((pulled.templates ?? []) as never[]);

    // Waehrend des Syncs entstandene Aenderungen duerfen vom Pull nicht ueberschrieben werden.
    const pending = await db.outbox.orderBy('seq').toArray();
    for (const op of pending) {
      const table = { todo: db.todos, subtask: db.subtasks, comment: db.comments, category: db.categories, template: db.templates }[op.entity];
      const row = await (table as typeof db.todos).get(op.id);
      if (row) await (table as typeof db.todos).put(applyOp(row as never, op) as never);
    }
    await db.meta.put({ key: 'cursor', value: pulled.cursor });
  });

  return rejected;
}
