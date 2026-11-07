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

await test('Kategorie-Farbe: wird gespeichert, alte Clients ohne Farbe loeschen sie nicht, Unsinn wird abgelehnt', async () => {
  const c = uuid();
  await push(F, op('category', c, { name: 'Bunt', sort_order: 5, color: '#cc0066', deleted_at: null }));
  // Wie App 1.0.x: vollstaendiger Datensatz, aber ohne "color".
  await push(M, op('category', c, { name: 'Bunt umbenannt', sort_order: 5, deleted_at: null }));
  const [row] = await rows('select name, color from public.categories where id = $1', [c]);
  assert.deepEqual(row, { name: 'Bunt umbenannt', color: '#cc0066' });
  const pulled = (await pull(M)).categories.find((k) => k.id === c);
  assert.equal(pulled.color, '#cc0066');

  await push(F, op('category', c, { name: 'Bunt umbenannt', sort_order: 5, color: null, deleted_at: null }));
  assert.equal((await rows('select color from public.categories where id = $1', [c]))[0].color, null);

  const bad = await push(F, op('category', c, { name: 'X', sort_order: 5, color: 'red', deleted_at: null }));
  assert.equal(bad.rejected.length, 1);
});

await test('Wiederholung: naechster Termin nach Plan, ab Erledigung und mit Monatsende', async () => {
  const next = async (r, due, done) =>
    (await rows('select private.next_due($1::jsonb, $2::date, $3::date)::text d', [JSON.stringify(r), due, done]))[0].d;
  const week = { every: 1, unit: 'week', mode: 'schedule' };
  // Dienstag faellig, Dienstag erledigt: naechster Dienstag.
  assert.equal(await next(week, '2026-11-10', '2026-11-10'), '2026-11-17');
  // Einen Tag frueher erledigt: trotzdem der naechste Dienstag, nicht der gleiche.
  assert.equal(await next(week, '2026-11-10', '2026-11-09'), '2026-11-17');
  // Drei Wochen zu spaet (an einem Dienstag): naechster Dienstag nach heute, nicht heute.
  assert.equal(await next(week, '2026-11-10', '2026-12-01'), '2026-12-08');
  assert.equal(await next({ every: 2, unit: 'week', mode: 'schedule' }, '2026-11-10', '2026-11-12'), '2026-11-24');
  assert.equal(await next({ every: 3, unit: 'day', mode: 'completion' }, '2026-11-10', '2026-11-12'), '2026-11-15');
  assert.equal(await next({ every: 1, unit: 'month', mode: 'schedule' }, '2026-01-31', '2026-01-31'), '2026-02-28');
  assert.equal(await next({ every: 1, unit: 'month', mode: 'schedule' }, '2026-01-31', '2026-03-05'), '2026-03-31');
  assert.equal(await next({ every: 1, unit: 'month', mode: 'completion' }, null, '2026-05-31'), '2026-06-30');
  // Ohne Faelligkeit zaehlt der Erledigungstag, auch im Modus "schedule".
  assert.equal(await next(week, null, '2026-11-12'), '2026-11-19');
});

await test('Wiederholung: Erledigen legt genau eine Folgeaufgabe an, mit offenen Unteraufgaben', async () => {
  const id = uuid();
  const rec = { every: 1, unit: 'week', mode: 'completion' };
  await push(F, op('todo', id, { title: 'Müll raus', due_date: '2026-11-10', recurrence: rec, assignee_id: melina }));
  await push(F, op('subtask', uuid(), { todo_id: id, title: 'Gelbe Tonne', is_done: true, sort_order: 1, deleted_at: null }));
  await push(F, op('subtask', uuid(), { todo_id: id, title: 'Weg', is_done: false, sort_order: 2, deleted_at: new Date().toISOString() }));
  await db.exec('delete from public.notification_log;');
  const before = (await pull(M)).cursor;

  await push(M, op('todo', id, { status: 'done' }));
  const [orig] = await rows('select spawned_id from public.todos where id = $1', [id]);
  assert.ok(orig.spawned_id);
  // Basis ist der Erledigungstag (Berliner Datum von done_at), nicht der Tag der Synchronisation.
  const [copy] = await rows(`select n.title, n.status, n.assignee_id, n.recurrence, n.recurred_from,
      n.due_date = (o.done_at at time zone 'Europe/Berlin')::date + 7 as d
    from public.todos n join public.todos o on o.id = n.recurred_from where n.id = $1`, [orig.spawned_id]);
  assert.deepEqual(copy,
    { title: 'Müll raus', status: 'open', assignee_id: melina, recurrence: rec, recurred_from: id, d: true });
  const subs = await rows('select title, is_done from public.subtasks where todo_id = $1 and deleted_at is null', [orig.spawned_id]);
  assert.deepEqual(subs, [{ title: 'Gelbe Tonne', is_done: false }]);

  // Freddy bekommt nur "erledigt", kein zusaetzliches "neu" fuer die Folgeaufgabe.
  const sent = await rows('select kind, todo_id from public.notification_log');
  assert.deepEqual(sent, [{ kind: 'done', todo_id: id }]);

  // Die Folgeaufgabe kommt per Pull auf beide Geraete.
  const pulled = await pull(F, before);
  assert.ok(pulled.todos.some((t) => t.id === orig.spawned_id && t.recurred_from === id));
  assert.ok(pulled.subtasks.some((s) => s.todo_id === orig.spawned_id));

  // Wieder oeffnen und erneut erledigen erzeugt keine zweite; Freddys spaetes Offline-Erledigen auch nicht.
  await push(M, op('todo', id, { status: 'open' }));
  await push(M, op('todo', id, { status: 'done' }));
  await push(F, op('todo', id, { status: 'done' }));
  assert.equal((await rows('select count(*)::int c from public.todos where recurred_from = $1', [id]))[0].c, 1);
});

await test('Wiederholung: aendern, abschalten, Unsinn ablehnen; ohne Wiederholung keine Folgeaufgabe', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Gießen', recurrence: { every: 3, unit: 'day', mode: 'schedule' } }));
  await push(F, op('todo', id, { recurrence: null }));
  assert.equal((await rows('select recurrence from public.todos where id = $1', [id]))[0].recurrence, null);
  await push(F, op('todo', id, { status: 'done' }));
  assert.equal((await rows('select spawned_id from public.todos where id = $1', [id]))[0].spawned_id, null);

  for (const bad of [{ every: 0, unit: 'day', mode: 'schedule' }, { every: 1.5, unit: 'day', mode: 'schedule' },
    { every: 1, unit: 'year', mode: 'schedule' }, { every: '1', unit: 'day', mode: 'schedule' }, { every: 1, unit: 'day' }]) {
    const r = await push(F, op('todo', uuid(), { title: 'x', recurrence: bad }));
    assert.equal(r.rejected.length, 1, JSON.stringify(bad));
  }

  // Melina wird ueber eine geaenderte Wiederholung informiert.
  const t = uuid();
  await push(F, op('todo', t, { title: 'Bettwäsche' }));
  await push(F, op('todo', t, { recurrence: { every: 2, unit: 'week', mode: 'schedule' } }));
  assert.match((await log(t)).at(-1).body, /Wiederholung/);
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

await test('Push erledigt: nennt bei Wiederholung den Termin der Folgeaufgabe, beim zweiten Erledigen nicht', async () => {
  await db.exec('delete from public.notification_log;');
  const id = uuid();
  await push(M, op('todo', id, { title: 'Einkaufen', due_date: '2026-11-10', recurrence: { every: 1, unit: 'week', mode: 'schedule' } }));
  await push(M, op('todo', id, { status: 'done' }));
  const [{ d }] = await rows(`select to_char(due_date, 'DD.MM.') d from public.todos where recurred_from = $1`, [id]);
  assert.deepEqual((await log(id)).map((l) => [l.kind, l.n, l.body]),
    [['new', 'Freddy', 'Melina hat eine neue Aufgabe angelegt'], ['done', 'Freddy', `Erledigt von Melina, nächste fällig am ${d}`]]);

  await push(M, op('todo', id, { status: 'open' }));
  await push(M, op('todo', id, { status: 'done' }));
  assert.equal((await log(id)).at(-1).body, 'Erledigt von Melina');

  // Abschaltbar pro Person wie bisher.
  await db.query('update public.profiles set notify_done = false where id = $1', [freddy]);
  const t = uuid();
  await push(M, op('todo', t, { title: 'Still', recurrence: { every: 1, unit: 'day', mode: 'completion' } }));
  await push(M, op('todo', t, { status: 'done' }));
  assert.equal((await log(t)).filter((l) => l.kind === 'done').length, 0);
  await db.query('update public.profiles set notify_done = true where id = $1', [freddy]);
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

await test('Uhrzeit-Erinnerung: an die Zustaendigen, einmal, erneut nach Verschieben, nicht wenn erledigt', async () => {
  await db.exec(`delete from public.notification_log;`);
  const remind = (sql) => rows(`select (${sql})::text t`).then((r) => r[0].t);
  const past = await remind(`now() - interval '2 minutes'`);
  const both = uuid();
  const forMelina = uuid();
  const future = uuid();
  const old = uuid();
  const done = uuid();
  await push(F, op('todo', both, { title: 'Arzttermin', due_date: '2026-11-10', remind_at: past }));
  await push(F, op('todo', forMelina, { title: 'Paket', assignee_id: melina, remind_at: past }));
  await push(F, op('todo', future, { title: 'Später', remind_at: await remind(`now() + interval '1 hour'`) }));
  await push(F, op('todo', old, { title: 'Uralt', remind_at: await remind(`now() - interval '2 days'`) }));
  await push(F, op('todo', done, { title: 'Schon erledigt', remind_at: past, status: 'done' }));
  await db.exec(`delete from public.notification_log;`);

  await db.query('select private.run_todo_reminders()');
  await db.query('select private.run_todo_reminders()');
  const sent = await rows(`select p.display_name n, l.title, l.body, l.todo_id from public.notification_log l
    join public.profiles p on p.id = l.recipient_id where l.kind = 'remind' order by l.title, p.display_name`);
  assert.deepEqual(sent.map(({ n, title, body }) => [title, n, body]), [
    ['Arzttermin', 'Freddy', 'Erinnerung, fällig 10.11.'],
    ['Arzttermin', 'Melina', 'Erinnerung, fällig 10.11.'],
    ['Paket', 'Melina', 'Erinnerung'],
  ]);

  // Verschoben und wieder erreicht: kommt noch einmal. Geaenderte Erinnerung wird Melina gemeldet.
  await push(F, op('todo', forMelina, { remind_at: await remind(`now() - interval '1 minute'`) }));
  assert.match((await log(forMelina)).at(-1).body, /Erinnerung/);
  await db.query('select private.run_todo_reminders()');
  assert.equal((await rows(`select count(*)::int c from public.notification_log where kind = 'remind' and todo_id = $1`, [forMelina]))[0].c, 2);

  // Erinnerung entfernen wird gespeichert.
  await push(F, op('todo', future, { remind_at: null }));
  assert.equal((await rows('select remind_at from public.todos where id = $1', [future]))[0].remind_at, null);
});

await test('Uhrzeit-Erinnerung: Folgeaufgabe uebernimmt den Abstand zur Faelligkeit', async () => {
  const id = uuid();
  // Faellig Di 10.11., Erinnerung Mo 09.11. 18:00 Berliner Zeit (17:00 UTC).
  await push(F, op('todo', id, { title: 'Müll', due_date: '2026-11-10', remind_at: '2026-11-09T17:00:00Z',
    recurrence: { every: 1, unit: 'week', mode: 'schedule' } }));
  await push(F, op('todo', id, { status: 'done' }));
  const [n] = await rows(`select due_date::text d, (remind_at at time zone 'Europe/Berlin')::text r
    from public.todos where recurred_from = $1`, [id]);
  // Erledigt (Testuhr) im Januar 2026, also liegt der naechste Termin bereits am 17.11.
  assert.deepEqual(n, { d: '2026-11-17', r: '2026-11-16 18:00:00' });

  // Ohne Faelligkeit: gleiche Uhrzeit am neuen Termin, ueber die Zeitumstellung hinweg.
  const t = uuid();
  await push(F, op('todo', t, { title: 'Gießen', remind_at: '2026-03-20T07:30:00Z',
    recurrence: { every: 3, unit: 'day', mode: 'completion' } }));
  await push(F, op('todo', t, { status: 'done' }, '2026-03-27T10:00:00Z'));
  const [m] = await rows(`select due_date::text d, (remind_at at time zone 'Europe/Berlin')::text r
    from public.todos where recurred_from = $1`, [t]);
  assert.deepEqual(m, { d: '2026-03-30', r: '2026-03-30 08:30:00' });
});

await test('Queue: claim vergibt jeden Eintrag nur einmal, Keep-alive verraet nichts', async () => {
  await db.exec(`delete from public.notification_log;`);
  await db.query(`select private.enqueue((select household_id from public.profiles where id = $1), $1, 'done', 'k1', null, 't', 'b')`, [melina]);
  await db.exec('set role service_role;');
  // Feste Tageszeit, damit die Ruhezeiten (22 bis 7 Uhr) den Test nachts nicht scheitern lassen.
  const a = await rows(`select * from public.claim_notifications(10, '2026-06-01T10:00:00Z')`);
  const b = await rows(`select * from public.claim_notifications(10, '2026-06-01T10:00:00Z')`);
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

// ---------------------------------------------------------------- Version 1.0.6

await test('Neue Felder: Wichtig, Zeitfenster und Ablage werden pro Feld synchronisiert', async () => {
  const id = uuid();
  await push(F, op('todo', id, { title: 'Fenster putzen', due_date: '2026-11-15', due_window: 'week', important: true }, '2026-02-05T10:00:00Z'));
  await push(M, op('todo', id, { important: false }, '2026-02-05T12:00:00Z'));
  await push(F, op('todo', id, { due_window: null, due_date: null, bucket: 'later' }, '2026-02-05T11:00:00Z'));
  const [t] = (await pull(F)).todos.filter((x) => x.id === id);
  assert.deepEqual([t.important, t.due_window, t.due_date, t.bucket], [false, null, null, 'later']);
  // Ohne Angabe: nicht wichtig, keine Ablage.
  const plain = uuid();
  await push(F, op('todo', plain, { title: 'Normal' }));
  assert.deepEqual(await rows('select important, bucket, due_window from public.todos where id = $1', [plain]),
    [{ important: false, bucket: null, due_window: null }]);
  // Ungueltige Werte werden abgelehnt.
  assert.equal((await push(F, op('todo', uuid(), { title: 'x', due_window: 'year' }))).rejected.length, 1);
  assert.equal((await push(F, op('todo', uuid(), { title: 'x', bucket: 'egal' }))).rejected.length, 1);
});

await test('Zeitfenster: Fensterende und Folgeaufgaben rasten auf Sonntag bzw. Monatsende ein', async () => {
  const snap = async (d, w) => (await rows('select private.snap_window($1::date, $2)::text d', [d, w]))[0].d;
  assert.equal(await snap('2026-11-09', 'week'), '2026-11-15'); // Montag
  assert.equal(await snap('2026-11-15', 'week'), '2026-11-15'); // Sonntag bleibt
  assert.equal(await snap('2026-02-03', 'month'), '2026-02-28');
  assert.equal(await snap('2026-02-03', null), '2026-02-03');

  await db.exec('delete from public.notification_log;');
  const month = uuid();
  await push(M, op('todo', month, { title: 'Abrechnung', due_date: '2026-11-30', due_window: 'month', important: true,
    recurrence: { every: 1, unit: 'month', mode: 'schedule' } }, '2026-11-20T10:00:00Z'));
  await push(M, op('todo', month, { status: 'done' }, '2026-11-25T10:00:00Z'));
  const [n] = await rows(`select due_date::text d, due_window w, important i from public.todos where recurred_from = $1`, [month]);
  // 30.11. + 1 Monat waere der 30.12.; das Fenster "bis Monatsende" macht daraus den 31.12.
  assert.deepEqual(n, { d: '2026-12-31', w: 'month', i: true });
  assert.match((await log(month)).at(-1).body, /nächste fällig am 31\.12\./);

  const week = uuid();
  await push(F, op('todo', week, { title: 'Bad', due_date: '2026-11-15', due_window: 'week',
    recurrence: { every: 3, unit: 'day', mode: 'schedule' } }, '2026-11-10T10:00:00Z'));
  await push(F, op('todo', week, { status: 'done' }, '2026-11-11T10:00:00Z'));
  const [w] = await rows(`select due_date::text d from public.todos where recurred_from = $1`, [week]);
  assert.equal(w.d, '2026-11-22'); // 15.11. + 3 Tage = 18.11. (Mi), eingerastet auf So 22.11.
});

await test('Ablage und Ideen: eigene Push-Texte, Wechsel wird gemeldet', async () => {
  await db.exec('delete from public.notification_log;');
  const idea = uuid();
  await push(F, op('todo', idea, { title: 'Kletterwald', bucket: 'idea' }));
  assert.deepEqual((await log(idea)).map((l) => [l.n, l.body]), [['Melina', 'Freddy hat eine neue Idee geparkt']]);
  await push(F, op('todo', idea, { bucket: null, due_date: '2026-12-01' }));
  assert.match((await log(idea)).at(-1).body, /Fälligkeit, eingeplant/);
  await push(F, op('todo', idea, { bucket: 'later', due_date: null }));
  assert.match((await log(idea)).at(-1).body, /nach „Später“ verschoben/);
  await push(F, op('todo', idea, { important: true }));
  assert.match((await log(idea)).at(-1).body, /als wichtig markiert/);
});

await test('Papierkorb: Wiederherstellen meldet sich, Cleanup entfernt erst nach 30 Tagen endgueltig', async () => {
  await db.exec('delete from public.notification_log;');
  const keep = uuid();
  const gone = uuid();
  for (const id of [keep, gone]) {
    await push(F, op('todo', id, { title: 'Papierkorb ' + id.slice(0, 4) }));
    await push(F, op('subtask', uuid(), { todo_id: id, title: 'S', is_done: false, sort_order: 1, deleted_at: null }));
    await push(M, op('comment', uuid(), { todo_id: id, body: 'K', deleted_at: null }));
    await push(F, op('todo', id, { deleted_at: new Date().toISOString() }));
  }
  await push(F, op('todo', keep, { deleted_at: null }));
  assert.equal((await log(keep)).at(-1).body, 'Freddy hat die Aufgabe wiederhergestellt');
  assert.equal((await pull(M)).todos.find((t) => t.id === keep).deleted_at, null);

  await push(F, op('todo', keep, { deleted_at: new Date().toISOString() }));
  await db.query(`update public.todos set deleted_at = now() - interval '29 days' where id = $1`, [keep]);
  await db.query(`update public.todos set deleted_at = now() - interval '31 days' where id = $1`, [gone]);
  await db.query('select private.cleanup()');
  const left = async (table, col) => (await rows(`select count(*)::int c from public.${table} where ${col} = $1`, [gone]))[0].c;
  assert.deepEqual([await left('todos', 'id'), await left('subtasks', 'todo_id'), await left('comments', 'todo_id')], [0, 0, 0]);
  assert.equal(await left('notification_log', 'todo_id'), 0);
  assert.equal((await rows('select count(*)::int c from public.todos where id = $1', [keep]))[0].c, 1);
  assert.equal((await rows('select count(*)::int c from public.subtasks where todo_id = $1', [keep]))[0].c, 1);
});

await test('Ruhezeiten: nachts nichts, morgens eine Sammelmeldung, Einzelnes unveraendert, abschaltbar', async () => {
  await db.exec(`delete from public.notification_log; update public.profiles set quiet_hours = true;`);
  const hh = (await rows('select household_id h from public.profiles where id = $1', [melina]))[0].h;
  // 23:10 und 01:30 Berliner Zeit (MEZ = UTC+1) fuer Melina, 23:20 fuer Freddy.
  const add = (who, key, title, at) => db.query(`insert into public.notification_log
    (household_id, recipient_id, kind, dedupe_key, title, body, created_at) values ($1, $2, 'new', $3, $4, 'b', $5)`,
    [hh, who, key, title, at]);
  await add(melina, 'q1', 'Müll', '2026-11-09T22:10:00Z');
  await add(melina, 'q2', 'Rasen', '2026-11-10T00:30:00Z');
  await add(freddy, 'q3', 'Einkauf', '2026-11-09T22:20:00Z');
  const claim = async (at) => rows(`select kind, title, body, recipient_id from public.claim_notifications(10, $1)`, [at]);

  assert.deepEqual(await claim('2026-11-10T01:00:00Z'), []); // 02:00 Uhr
  assert.deepEqual(await claim('2026-11-10T05:59:00Z'), []); // 06:59 Uhr
  const morning = await claim('2026-11-10T06:05:00Z'); // 07:05 Uhr
  const forMelina = morning.filter((m) => m.recipient_id === melina);
  assert.deepEqual(forMelina.map((m) => [m.kind, m.title, m.body]), [['digest', 'Seit gestern Abend: 2 Neuigkeiten', 'Müll, Rasen']]);
  assert.deepEqual(morning.filter((m) => m.recipient_id === freddy).map((m) => [m.kind, m.title]), [['new', 'Einkauf']]);
  assert.equal((await rows(`select count(*)::int c from public.notification_log where digest_id is not null and sent_at is not null`))[0].c, 2);
  // Kein zweites Mal, solange der Versand laeuft (Wiedervorlage erst nach 5 Minuten ohne Bestaetigung).
  assert.deepEqual(await claim('2026-11-10T06:08:00Z'), []);

  await db.exec('update public.notification_log set sent_at = now() where sent_at is null;');
  // Tagsueber geht alles sofort raus, auch einzeln.
  await add(melina, 'q4', 'Tag', '2026-11-10T10:00:00Z');
  await add(melina, 'q5', 'Tag2', '2026-11-10T10:01:00Z');
  assert.deepEqual((await claim('2026-11-10T10:02:00Z')).map((m) => m.kind), ['new', 'new']);

  // Wer Ruhezeiten abschaltet, bekommt auch nachts sofort Bescheid (Einstellung selbst aenderbar).
  await db.exec('update public.notification_log set sent_at = now() where sent_at is null;');
  await as(M, () => db.query('update public.profiles set quiet_hours = false where id = $1', [melina]));
  await add(melina, 'q6', 'Nachts', '2026-11-10T22:00:00Z');
  assert.deepEqual((await claim('2026-11-10T22:01:00Z')).map((m) => m.title), ['Nachts']);
  await db.query('update public.profiles set quiet_hours = true');
});

console.log(`\n${passed} Tests bestanden`);
process.exit(0);
