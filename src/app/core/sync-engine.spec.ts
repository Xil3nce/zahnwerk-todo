import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ZahnwerkDb } from './db';
import { OutboxOp, Template, Todo } from './models';
import { PullResult, runSync, SyncBackend } from './sync-engine';

const todo = (id: string, patch: Partial<Todo> = {}): Todo => ({
  id, title: id, description: '', category_id: null, due_date: null, assignee_id: null,
  effort_minutes: null, status: 'open', done_at: null, done_by: null, created_by: 'p',
  created_at: '2026-11-02T00:00:00Z', deleted_at: null, ...patch,
});
const emptyPull = (cursor: number): PullResult => ({ cursor, todos: [], subtasks: [], comments: [], categories: [], profiles: [] });
const op = (id: string, fields: Record<string, unknown>): OutboxOp => ({
  op_id: `op-${id}-${Object.keys(fields).join()}`, entity: 'todo', id, fields, changed_at: '2026-11-02T10:00:00Z',
});

describe('runSync', () => {
  let db: ZahnwerkDb;
  beforeEach(async () => {
    db = new ZahnwerkDb(`test-${crypto.randomUUID()}`);
    await db.open();
  });

  it('leert die Outbox nach bestaetigtem Push und merkt sich den Cursor', async () => {
    await db.outbox.add(op('a', { title: 'A' }));
    const pushed: OutboxOp[][] = [];
    const backend: SyncBackend = {
      push: async (ops) => { pushed.push(ops); return { applied: ops.map((o) => o.op_id), rejected: [] }; },
      pull: async () => ({ ...emptyPull(7), todos: [todo('a', { title: 'A' })] }),
    };
    await runSync(db, backend);
    expect(pushed[0][0].op_id).toBe('op-a-title');
    expect(await db.outbox.count()).toBe(0);
    expect((await db.todos.get('a'))?.title).toBe('A');
    expect((await db.meta.get('cursor'))?.value).toBe(7);
  });

  it('behaelt die Outbox, wenn das Netz beim Push ausfaellt', async () => {
    await db.outbox.add(op('a', { title: 'A' }));
    const backend: SyncBackend = {
      push: async () => { throw new Error('offline'); },
      pull: async () => emptyPull(0),
    };
    await expect(runSync(db, backend)).rejects.toThrow('offline');
    expect(await db.outbox.count()).toBe(1);
  });

  it('entfernt abgelehnte Operationen und meldet sie', async () => {
    await db.outbox.add(op('a', { title: '' }));
    const backend: SyncBackend = {
      push: async (ops) => ({ applied: [], rejected: [{ op_id: ops[0].op_id, error: 'kaputt' }] }),
      pull: async () => emptyPull(0),
    };
    expect(await runSync(db, backend)).toEqual([{ op_id: 'op-a-title', error: 'kaputt' }]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('ueberschreibt waehrend des Syncs entstandene lokale Aenderungen nicht', async () => {
    await db.todos.put(todo('a', { title: 'alt' }));
    const backend: SyncBackend = {
      push: async () => ({ applied: [], rejected: [] }),
      pull: async () => {
        // Nutzer aendert offline, waehrend die Antwort unterwegs ist.
        await db.outbox.add(op('a', { title: 'lokal neu' }));
        return { ...emptyPull(3), todos: [todo('a', { title: 'vom Server', description: 'neu' })] };
      },
    };
    await runSync(db, backend);
    const row = await db.todos.get('a');
    expect(row?.title).toBe('lokal neu');
    expect(row?.description).toBe('neu');
    expect(await db.outbox.count()).toBe(1);
  });

  it('bricht ab statt endlos zu senden, wenn nichts bestaetigt wird', async () => {
    await db.outbox.add(op('a', { title: 'A' }));
    const backend: SyncBackend = {
      push: async () => ({ applied: [], rejected: [] }),
      pull: async () => emptyPull(0),
    };
    await expect(runSync(db, backend)).rejects.toThrow('bestätigt');
    expect(await db.outbox.count()).toBe(1);
  });

  it('sendet mit dem Cursor des letzten Laufs', async () => {
    await db.meta.put({ key: 'cursor', value: 42 });
    let seen = -1;
    await runSync(db, { push: async () => ({ applied: [], rejected: [] }), pull: async (c) => { seen = c; return emptyPull(50); } });
    expect(seen).toBe(42);
    expect((await db.meta.get('cursor'))?.value).toBe(50);
  });
});

describe('Vorlagen im Sync', () => {
  const tpl = (id: string, patch: Partial<Template> = {}): Template => ({
    id, title: id, description: '', category_id: null, effort_minutes: null, important: false, items: [], deleted_at: null, ...patch,
  });

  it('speichert gezogene Vorlagen und vertraegt Server ohne Vorlagen', async () => {
    const db = new ZahnwerkDb(`test-${crypto.randomUUID()}`);
    await db.open();
    const base = { todos: [], subtasks: [], comments: [], categories: [], profiles: [] };
    await runSync(db, { push: async () => ({ applied: [], rejected: [] }), pull: async () => ({ cursor: 3, ...base }) });
    expect(await db.templates.count()).toBe(0);
    await runSync(db, {
      push: async () => ({ applied: [], rejected: [] }),
      pull: async () => ({ cursor: 4, ...base, templates: [tpl('urlaub', { items: ['Pass', 'Ladekabel'] })] as never[] }),
    });
    expect((await db.templates.get('urlaub'))?.items).toEqual(['Pass', 'Ladekabel']);
  });

  it('lokale Aenderung waehrend des Syncs wird vom Pull nicht ueberschrieben', async () => {
    const db = new ZahnwerkDb(`test-${crypto.randomUUID()}`);
    await db.open();
    await db.templates.put(tpl('putzen', { title: 'Alt' }));
    await runSync(db, {
      push: async () => ({ applied: [], rejected: [] }),
      pull: async () => {
        await db.outbox.add({ op_id: 'x', entity: 'template', id: 'putzen', fields: { title: 'Neu' }, changed_at: '' });
        return { cursor: 5, todos: [], subtasks: [], comments: [], categories: [], profiles: [], templates: [tpl('putzen', { title: 'Server' })] as never[] };
      },
    });
    expect((await db.templates.get('putzen'))?.title).toBe('Neu');
  });
});
