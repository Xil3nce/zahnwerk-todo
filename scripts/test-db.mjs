// Testet Migrationen, RLS, Sync und Benachrichtigungen in einem eingebetteten Postgres (PGlite),
// ohne Docker. Supabase-Bausteine (auth, vault, cron, net) sind minimal nachgebildet.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../supabase/migrations/', import.meta.url);
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema vault; create schema cron; create schema net;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
  create view vault.decrypted_secrets as select 'x'::text as name, 'x'::text as decrypted_secret;
  create table net.calls (url text);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ insert into net.calls values (url); select 1::bigint $$;
  create table cron.jobs (name text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.jobs values (a, b, c); select 1::bigint $$;
`);
for (const file of readdirSync(dir).sort()) {
  const sql = readFileSync(new URL(file, dir), 'utf8').replace(/create extension[^;]*;/g, '');
  await db.exec(sql);
}

const F = '00000000-0000-4000-8000-00000000000f';
const M = '00000000-0000-4000-8000-00000000000a';
const X = '00000000-0000-4000-8000-00000000000b';
await db.exec(`insert into auth.users values ('${F}', 'freddy@x.test'), ('${M}', 'melina@x.test'), ('${X}', 'fremd@x.test');`);
await db.query(`select private.bootstrap_household('Haushalt', 'freddy@x.test', 'Freddy', 'melina@x.test', 'Melina')`);
await db.exec(`
  insert into public.households (id, name) values ('00000000-0000-4000-8000-0000000000bb', 'Fremd');
  insert into public.profiles (user_id, household_id, display_name) values ('${X}', '00000000-0000-4000-8000-0000000000bb', 'Fremd');
`);

/** Fuehrt fn als angemeldeter Nutzer aus, wie PostgREST es tut. */
async function as(uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; set test.uid = '';`);
  }
}
const uuid = () => crypto.randomUUID();
let clock = Date.parse('2026-01-01T00:00:00Z');
const op = (entity, id, fields, changed_at) => ({
  op_id: uuid(), entity, id, fields, changed_at: changed_at ?? new Date((clock += 1000)).toISOString(),
});
const push = async (uid, ...ops) =>
  (await as(uid, () => db.query('select public.sync_push($1::jsonb) r', [JSON.stringify(ops)]))).rows[0].r;
const pull = async (uid, cursor = 0) =>
  (await as(uid, () => db.query('select public.sync_pull($1) r', [cursor]))).rows[0].r;
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const log = (todo) => rows(`select l.kind, p.display_name n, l.body from public.notification_log l
  join public.profiles p on p.id = l.recipient_id where l.todo_id = $1 order by l.id`, [todo]);
const profile = async (name) => (await rows('select id from public.profiles where display_name = $1', [name]))[0].id;
const freddy = await profile('Freddy');
const melina = await profile('Melina');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

await test('Bootstrap legt die drei Kategorien an', async () => {
  const { categories } = await pull(F);
  assert.deepEqual(categories.map((c) => c.name).sort(), ['Garten', 'Handwerkliches', 'Haushaltstätigkeit']);
});

await test('RLS: Fremder Haushalt sieht nichts', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Geheim' }));
  const foreign = await pull(X);
  assert.equal(foreign.todos.length, 0);
  assert.equal(foreign.categories.length, 0);
  assert.deepEqual(foreign.profiles.map((p) => p.display_name), ['Fremd']);
  const direct = await as(X, () => db.query('select * from public.todos'));
  assert.equal(direct.rows.length, 0);
});

await test('RLS: Clients duerfen Tabellen nicht direkt schreiben', async () => {
  await as(F, () =>
    assert.rejects(db.query(`update public.todos set title = 'x'`), /permission denied/));
  await as(F, () =>
    assert.rejects(db.query('select * from public.notification_log'), /permission denied/));
  await as(F, () =>
    assert.rejects(db.query('select * from public.device_tokens'), /permission denied/));
});

await test('RLS: Profil nur selbst und nur erlaubte Spalten aendern', async () => {
  await as(F, () => db.query(`update public.profiles set notify_done = true where id = $1`, [melina]));
  assert.equal((await rows('select count(*)::int c from public.profiles where id = $1 and server_seq > 99999', [melina]))[0].c, 0);
  await as(F, () => assert.rejects(db.query(`update public.profiles set household_id = null`), /permission denied/));
  await as(F, () => db.query(`update public.profiles set reminder_time = '07:15' where id = $1`, [freddy]));
  const [{ t }] = await rows(`select reminder_time::text t from public.profiles where id = $1`, [freddy]);
  assert.equal(t, '07:15:00');
  await as(F, () => assert.rejects(db.query(`update public.profiles set reminder_time = '07:10' where id = $1`, [freddy])));
});

await test('Sync: fremde Aufgabe laesst sich weder aendern noch referenzieren', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Meins' }));
  const a = await push(X, op('todo', id, { title: 'Gekapert' }));
  assert.equal(a.rejected.length, 1);
  const b = await push(X, op('subtask', uuid(), { todo_id: id, title: 'x' }));
  assert.equal(b.rejected.length, 1);
  const c = await push(X, op('comment', uuid(), { todo_id: id, body: 'x' }));
  assert.equal(c.rejected.length, 1);
  assert.equal((await rows('select title from public.todos where id = $1', [id]))[0].title, 'Meins');
});

await test('Sync: Zuweisung an fremde Person wird abgelehnt', async () => {
  const [{ id: other }] = await rows(`select id from public.profiles where display_name = 'Fremd'`);
  const r = await push(F, op('todo', uuid(), { title: 'x', assignee_id: other }));
  assert.equal(r.rejected.length, 1);
});

await test('Sync: Wiederholung derselben op_id wirkt nur einmal', async () => {
  const id = uuid();
  const first = op('todo', id, { title: 'A' });
  await push(F, first);
  await push(F, op('todo', id, { title: 'B' }));
  const again = await push(F, first);
  assert.deepEqual(again.applied, [first.op_id]);
  assert.equal((await rows('select title from public.todos where id = $1', [id]))[0].title, 'B');
});

await test('Sync: fehlerhafte Operation blockiert die folgenden nicht', async () => {
  const good = uuid();
  const r = await push(F, op('todo', uuid(), { title: '' }), op('todo', good, { title: 'Gut' }));
  assert.equal(r.rejected.length, 1);
  assert.equal(r.applied.length, 1);
  assert.equal((await rows('select count(*)::int c from public.todos where id = $1', [good]))[0].c, 1);
});

await test('Konflikt: Last-write-wins pro Feld behaelt beide Aenderungen', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Start' }, '2026-02-01T10:00:00Z'));
  // Melina aendert spaeter die Faelligkeit, Freddy synchronisiert danach seinen Titel.
  await push(M, op('todo', id, { due_date: '2026-03-01' }, '2026-02-01T12:00:00Z'));
  await push(F, op('todo', id, { title: 'Neuer Titel' }, '2026-02-01T11:00:00Z'));
  const [t] = await rows('select title, due_date::text d from public.todos where id = $1', [id]);
  assert.deepEqual(t, { title: 'Neuer Titel', d: '2026-03-01' });
});

await test('Konflikt: aelterer Stand desselben Felds verliert', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Neu' }, '2026-02-02T12:00:00Z'));
  await push(M, op('todo', id, { title: 'Alt' }, '2026-02-02T11:00:00Z'));
  assert.equal((await rows('select title from public.todos where id = $1', [id]))[0].title, 'Neu');
});

await test('Konflikt: Zeitstempel aus der Zukunft werden gekappt', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Zukunft' }, '2099-01-01T00:00:00Z'));
  await push(M, op('todo', id, { title: 'Jetzt' }, new Date(Date.now() + 5000).toISOString()));
  assert.equal((await rows('select title from public.todos where id = $1', [id]))[0].title, 'Jetzt');
});

await test('Erledigt: erledigt_von kommt vom Server, Payload wird ignoriert', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'T' }));
  await push(M, op('todo', id, { status: 'done', done_by: freddy }));
  const [t] = await rows('select status, done_by, done_at is not null a from public.todos where id = $1', [id]);
  assert.deepEqual(t, { status: 'done', done_by: melina, a: true });
  await push(F, op('todo', id, { status: 'open' }));
  const [r] = await rows('select status, done_by, done_at from public.todos where id = $1', [id]);
  assert.deepEqual(r, { status: 'open', done_by: null, done_at: null });
});

await test('Pull: Cursor liefert nur Neues und auch Geloeschtes', async () => {
  const before = (await pull(F)).cursor;
  const id = uuid();
  await push(F, op('todo', id, { title: 'Neu' }));
  const a = await pull(M, before);
  assert.deepEqual(a.todos.map((t) => t.id), [id]);
  await push(F, op('todo', id, { deleted_at: new Date().toISOString() }));
  const b = await pull(M, a.cursor);
  assert.equal(b.todos[0].id, id);
  assert.ok(b.todos[0].deleted_at);
  assert.equal(b.todos[0].field_versions, undefined);
});

await test('Kategorie und Unteraufgabe: aelterer Datensatz verliert', async () => {
  const c = uuid();
  await push(F, op('category', c, { name: 'Neu', sort_order: 9, deleted_at: null }, '2026-02-03T12:00:00Z'));
  await push(M, op('category', c, { name: 'Alt', sort_order: 9, deleted_at: null }, '2026-02-03T11:00:00Z'));
  assert.equal((await rows('select name from public.categories where id = $1', [c]))[0].name, 'Neu');

  const t = uuid();
  const s = uuid();
  await push(F, op('todo', t, { title: 'T' }));
  await push(F, op('subtask', s, { todo_id: t, title: 'S', is_done: true, sort_order: 1, deleted_at: null }, '2026-02-03T12:00:00Z'));
  await push(M, op('subtask', s, { todo_id: t, title: 'S', is_done: false, sort_order: 1, deleted_at: null }, '2026-02-03T11:00:00Z'));
  assert.equal((await rows('select is_done from public.subtasks where id = $1', [s]))[0].is_done, true);
});

await test('Kommentar: nur der Autor kann loeschen, der Autor kommt vom Server', async () => {
  const t = uuid();
  const c = uuid();
  await push(F, op('todo', t, { title: 'T' }));
  await push(F, op('comment', c, { todo_id: t, body: 'Hallo', author_id: melina, deleted_at: null }));
  assert.equal((await rows('select author_id from public.comments where id = $1', [c]))[0].author_id, freddy);
  await push(M, op('comment', c, { todo_id: t, body: 'Hallo', deleted_at: new Date().toISOString() }));
  assert.equal((await rows('select deleted_at from public.comments where id = $1', [c]))[0].deleted_at, null);
});

await test('Push neu: Melina nichts bei reiner Freddy-Aufgabe, ausloesende Person nie', async () => {
  const onlyFreddy = uuid();
  await push(F, op('todo', onlyFreddy, { title: 'F', assignee_id: freddy }));
  assert.deepEqual(await log(onlyFreddy), []);
  const both = uuid();
  await push(F, op('todo', both, { title: 'B' }));
  assert.deepEqual((await log(both)).map((l) => [l.kind, l.n]), [['new', 'Melina']]);
  const forFreddy = uuid();
  await push(M, op('todo', forFreddy, { title: 'FF', assignee_id: freddy }));
  assert.deepEqual((await log(forFreddy)).map((l) => [l.kind, l.n]), [['new', 'Freddy']]);
});

await test('Push erledigt: geht an alle ausser die Person selbst, egal wem zugeordnet', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'F', assignee_id: freddy }));
  await push(F, op('todo', id, { status: 'done' }));
  assert.deepEqual((await log(id)).map((l) => [l.kind, l.n]), [['done', 'Melina']]);
});

await test('Push Aenderung: nur Betroffene, Entzug wird noch gemeldet, Texte stimmen', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'T', assignee_id: freddy }));
  await push(F, op('todo', id, { title: 'T2' }));
  assert.deepEqual(await log(id), []);
  await push(F, op('todo', id, { assignee_id: melina }));
  await push(F, op('todo', id, { due_date: '2026-05-01' }));
  const entries = await log(id);
  assert.deepEqual(entries.map((l) => l.n), ['Melina', 'Melina']);
  assert.match(entries[0].body, /Zuständigkeit/);
  assert.match(entries[1].body, /Fälligkeit/);
  await push(M, op('todo', id, { assignee_id: melina, title: 'T3' }));
  assert.equal((await log(id)).filter((l) => l.n === 'Freddy').length, 0);
  // Melina gibt die Aufgabe an Freddy: Freddy wird informiert.
  await push(M, op('todo', id, { assignee_id: freddy }));
  assert.equal((await log(id)).at(-1).n, 'Freddy');
  // Freddy gibt sie an Melina zurueck: Melina erfaehrt es.
  await push(F, op('todo', id, { assignee_id: null }));
  assert.equal((await log(id)).at(-1).n, 'Melina');
});

await test('Push: Einstellungen werden beachtet', async () => {
  await db.query('update public.profiles set notify_new = false, notify_comment = false where id = $1', [melina]);
  const id = uuid();
  await push(F, op('todo', id, { title: 'Still' }));
  await push(F, op('comment', uuid(), { todo_id: id, body: 'Pst', deleted_at: null }));
  assert.deepEqual(await log(id), []);
  await db.query('update public.profiles set notify_new = true, notify_comment = true where id = $1', [melina]);
  await push(F, op('comment', uuid(), { todo_id: id, body: 'Hallo', deleted_at: null }));
  assert.deepEqual((await log(id)).map((l) => [l.kind, l.body]), [['comment', 'Freddy: Hallo']]);
});

await test('Erinnerung: heute faellig und ueberfaellig, kein Doppelversand, nur Betroffene', async () => {
  const today = (await rows(`select (now() at time zone 'Europe/Berlin')::date::text d`))[0].d;
  const yesterday = (await rows(`select ((now() at time zone 'Europe/Berlin')::date - 1)::text d`))[0].d;
  await db.exec(`delete from public.notification_log; update public.todos set deleted_at = now();`);
  await db.query(`update public.profiles set reminder_time = '00:00'`);
  await push(F, op('todo', uuid(), { title: 'Heute beide', due_date: today }));
  await push(F, op('todo', uuid(), { title: 'Heute für Freddy', due_date: today, assignee_id: freddy }));
  await push(F, op('todo', uuid(), { title: 'Alt Melina', due_date: yesterday, assignee_id: melina }));
  await push(F, op('todo', uuid(), { title: 'Fertig', due_date: today, status: 'done' }));
  await db.exec('delete from public.notification_log;');

  await db.query('select private.run_reminders()');
  await db.query('select private.run_reminders()');
  const due = await rows(`select p.display_name n, l.title, l.body from public.notification_log l
    join public.profiles p on p.id = l.recipient_id where l.kind = 'due' and p.display_name <> 'Fremd' order by 1`);
  assert.deepEqual(due, [
    { n: 'Freddy', title: 'Heute fällig: 2', body: 'Heute beide, Heute für Freddy' },
    { n: 'Melina', title: 'Heute fällig: 1', body: 'Heute beide (1 überfällig)' },
  ]);
});

await test('Erinnerung: nichts faellig bedeutet keine Push, auch spaeter am Tag nicht', async () => {
  await db.exec(`delete from public.notification_log; update public.todos set deleted_at = now();`);
  await db.query('select private.run_reminders()');
  const today = (await rows(`select (now() at time zone 'Europe/Berlin')::date::text d`))[0].d;
  await push(F, op('todo', uuid(), { title: 'Spaet', due_date: today }));
  await db.query('select private.run_reminders()');
  assert.equal((await rows(`select count(*)::int c from public.notification_log where kind = 'due'`))[0].c, 0);
  assert.ok((await rows(`select count(*)::int c from public.notification_log where kind = 'due_skipped'`))[0].c >= 2);
});

await test('Erinnerung: Uhrzeit noch nicht erreicht bedeutet keinen Eintrag', async () => {
  await db.exec(`delete from public.notification_log;`);
  await db.query(`update public.profiles set reminder_time = '23:45'`);
  const before = (await rows(`select (now() at time zone 'Europe/Berlin')::time < '23:45' ok`))[0].ok;
  await db.query('select private.run_reminders()');
  if (before) assert.equal((await rows(`select count(*)::int c from public.notification_log`))[0].c, 0);
});

await test('Queue: claim vergibt jeden Eintrag nur einmal, Keep-alive verraet nichts', async () => {
  await db.exec(`delete from public.notification_log;`);
  await db.query(`select private.enqueue((select household_id from public.profiles where id = $1), $1, 'done', 'k1', null, 't', 'b')`, [melina]);
  await db.exec('set role service_role;');
  const a = await rows('select * from public.claim_notifications(10)');
  const b = await rows('select * from public.claim_notifications(10)');
  await db.exec('reset role;');
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
  await db.exec('set role anon;');
  assert.deepEqual(await rows('select public.keepalive() ok'), [{ ok: true }]);
  await assert.rejects(db.query('select public.sync_pull(0)'), /permission denied/);
  await assert.rejects(db.query('select public.claim_notifications(1)'), /permission denied/);
  await assert.rejects(db.query('select * from public.todos'), /permission denied/);
  await db.exec('reset role;');
});

await test('Geraete: Token wandert zum zuletzt angemeldeten Nutzer, Abmelden entfernt nur eigene', async () => {
  await as(F, () => db.query(`select public.register_device('tok')`));
  await as(M, () => db.query(`select public.register_device('tok')`));
  assert.equal((await rows(`select profile_id from public.device_tokens where token = 'tok'`))[0].profile_id, melina);
  await as(F, () => db.query(`select public.unregister_device('tok')`));
  assert.equal((await rows(`select count(*)::int c from public.device_tokens`))[0].c, 1);
  await as(M, () => db.query(`select public.unregister_device('tok')`));
  assert.equal((await rows(`select count(*)::int c from public.device_tokens`))[0].c, 0);
});

console.log(`\n${passed} Tests bestanden`);
process.exit(0);
