-- Zahnwerk: Schema, RLS, Sync und Benachrichtigungen.
-- Clients lesen per RLS bzw. sync_pull und schreiben Aufgaben nur ueber sync_push.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;

create sequence public.change_seq;

-- ---------------------------------------------------------------- Tabellen

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id),
  display_name text not null,
  reminder_time time not null default '08:00',
  notify_done boolean not null default true,
  notify_new boolean not null default true,
  notify_changed boolean not null default true,
  notify_due_today boolean not null default true,
  notify_overdue boolean not null default true,
  notify_comment boolean not null default true,
  server_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint reminder_quarter_hour check (
    extract(minute from reminder_time)::int % 15 = 0 and extract(second from reminder_time) = 0
  )
);

create table public.categories (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  name text not null check (length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  client_changed_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- assignee_id null bedeutet "Beide".
create table public.todos (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  category_id uuid references public.categories (id),
  due_date date,
  assignee_id uuid references public.profiles (id),
  effort_minutes integer check (effort_minutes is null or effort_minutes between 1 and 100000),
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  done_by uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  last_changed_by uuid not null references public.profiles (id),
  field_versions jsonb not null default '{}',
  server_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index todos_household_seq on public.todos (household_id, server_seq);

create table public.subtasks (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  todo_id uuid not null references public.todos (id),
  title text not null check (length(trim(title)) between 1 and 200),
  is_done boolean not null default false,
  sort_order integer not null default 0,
  client_changed_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index subtasks_household_seq on public.subtasks (household_id, server_seq);

create table public.comments (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  todo_id uuid not null references public.todos (id),
  author_id uuid not null references public.profiles (id),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index comments_household_seq on public.comments (household_id, server_seq);

create table public.device_tokens (
  token text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  household_id uuid not null references public.households (id),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Warteschlange und Idempotenz fuer Pushes zugleich.
create table public.notification_log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('done', 'new', 'changed', 'comment', 'due', 'due_skipped')),
  dedupe_key text not null unique,
  todo_id uuid references public.todos (id),
  title text not null default '',
  body text not null default '',
  attempts integer not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_log_unsent on public.notification_log (created_at) where sent_at is null;

create table public.sync_ops (
  op_id uuid primary key,
  user_id uuid not null,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Hilfsfunktionen

create function private.current_profile_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where user_id = auth.uid() and deleted_at is null
$$;

create function private.current_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.profiles where user_id = auth.uid() and deleted_at is null
$$;

-- Die Sperre pro Household sorgt dafuer, dass server_seq in Commit-Reihenfolge
-- steigt. Sonst koennte ein Pull-Cursor eine langsamere Transaktion ueberspringen.
create function private.stamp_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.household_id::text, 0));
  new.server_seq := nextval('public.change_seq');
  new.updated_at := now();
  return new;
end $$;

create trigger stamp before insert or update on public.profiles for each row execute function private.stamp_change();
create trigger stamp before insert or update on public.categories for each row execute function private.stamp_change();
create trigger stamp before insert or update on public.todos for each row execute function private.stamp_change();
create trigger stamp before insert or update on public.subtasks for each row execute function private.stamp_change();
create trigger stamp before insert or update on public.comments for each row execute function private.stamp_change();

-- ---------------------------------------------------------------- RLS

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.todos enable row level security;
alter table public.subtasks enable row level security;
alter table public.comments enable row level security;
alter table public.device_tokens enable row level security;
alter table public.notification_log enable row level security;
alter table public.sync_ops enable row level security;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.current_profile_id() to authenticated;

create policy household_read on public.households for select to authenticated
  using (id = private.current_household_id());
create policy household_read on public.profiles for select to authenticated
  using (household_id = private.current_household_id());
create policy own_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy household_read on public.categories for select to authenticated
  using (household_id = private.current_household_id());
create policy household_read on public.todos for select to authenticated
  using (household_id = private.current_household_id());
create policy household_read on public.subtasks for select to authenticated
  using (household_id = private.current_household_id());
create policy household_read on public.comments for select to authenticated
  using (household_id = private.current_household_id());
-- device_tokens, notification_log, sync_ops: keine Policy, also kein Client-Zugriff.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.households, public.profiles, public.categories, public.todos,
  public.subtasks, public.comments to authenticated;
grant update (display_name, reminder_time, notify_done, notify_new, notify_changed,
  notify_due_today, notify_overdue, notify_comment) on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
-- Der stamp-Trigger laeuft bei Profil-Updates mit den Rechten des Nutzers.
grant usage on sequence public.change_seq to authenticated;

-- ---------------------------------------------------------------- Benachrichtigungen

create function private.enqueue(
  p_household uuid, p_recipient uuid, p_kind text, p_key text,
  p_todo uuid, p_title text, p_body text
) returns void
language sql set search_path = '' as $$
  insert into public.notification_log (household_id, recipient_id, kind, dedupe_key, todo_id, title, body)
  values (p_household, p_recipient, p_kind, p_key, p_todo, p_title, p_body)
  on conflict (dedupe_key) do nothing
$$;

create function private.on_todo_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_name text;
  v_kind text;
  v_body text;
  v_changes text[] := '{}';
  r record;
begin
  select display_name into v_actor_name from public.profiles where id = new.last_changed_by;

  if tg_op = 'INSERT' then
    v_kind := 'new';
    v_body := coalesce(v_actor_name, '') || ' hat eine neue Aufgabe angelegt';
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_kind := 'changed';
    v_body := coalesce(v_actor_name, '') || ' hat die Aufgabe gelöscht';
  elsif new.deleted_at is not null then
    return null;
  elsif new.status = 'done' and old.status = 'open' then
    v_kind := 'done';
    v_body := 'Erledigt von ' || coalesce(v_actor_name, '');
  else
    if new.status = 'open' and old.status = 'done' then v_changes := array_append(v_changes, 'wieder geöffnet'); end if;
    if new.title is distinct from old.title then v_changes := array_append(v_changes, 'Titel'); end if;
    if new.description is distinct from old.description then v_changes := array_append(v_changes, 'Beschreibung'); end if;
    if new.category_id is distinct from old.category_id then v_changes := array_append(v_changes, 'Kategorie'); end if;
    if new.due_date is distinct from old.due_date then v_changes := array_append(v_changes, 'Fälligkeit'); end if;
    if new.assignee_id is distinct from old.assignee_id then v_changes := array_append(v_changes, 'Zuständigkeit'); end if;
    if new.effort_minutes is distinct from old.effort_minutes then v_changes := array_append(v_changes, 'Zeitaufwand'); end if;
    if cardinality(v_changes) = 0 then return null; end if;
    v_kind := 'changed';
    v_body := coalesce(v_actor_name, '') || ' hat geändert: ' || array_to_string(v_changes, ', ');
  end if;

  for r in
    select p.id from public.profiles p
    where p.household_id = new.household_id
      and p.deleted_at is null
      and p.id <> new.last_changed_by
      and case v_kind
        when 'done' then p.notify_done
        when 'new' then p.notify_new and (new.assignee_id is null or new.assignee_id = p.id)
        else p.notify_changed and (
          new.assignee_id is null or new.assignee_id = p.id
          -- Wem die Aufgabe gerade entzogen wurde, der erfaehrt es noch.
          or (tg_op = 'UPDATE' and (old.assignee_id is null or old.assignee_id = p.id))
        )
      end
  loop
    perform private.enqueue(new.household_id, r.id, v_kind,
      v_kind || ':' || new.id || ':' || new.server_seq || ':' || r.id,
      new.id, new.title, v_body);
  end loop;
  return null;
end $$;

create trigger notify after insert or update on public.todos
  for each row execute function private.on_todo_change();

create function private.on_comment_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_todo public.todos;
  v_author text;
  r record;
begin
  select * into v_todo from public.todos where id = new.todo_id;
  select display_name into v_author from public.profiles where id = new.author_id;
  for r in
    select p.id from public.profiles p
    where p.household_id = new.household_id
      and p.deleted_at is null
      and p.id <> new.author_id
      and p.notify_comment
      and (v_todo.assignee_id is null or v_todo.assignee_id = p.id)
  loop
    perform private.enqueue(new.household_id, r.id, 'comment',
      'comment:' || new.id || ':' || r.id, new.todo_id,
      v_todo.title, coalesce(v_author, '') || ': ' || left(new.body, 140));
  end loop;
  return null;
end $$;

create trigger notify after insert on public.comments
  for each row execute function private.on_comment_insert();

-- Ohne Vault-Eintraege (lokal, in Tests) passiert nichts; der Eintrag wartet in der Queue.
create function private.kick_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'zahnwerk_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'zahnwerk_push_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (select 1 from public.notification_log where sent_at is null and attempts < 5) then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := '{}'::jsonb
  );
end $$;

-- Laeuft alle 15 Minuten. "Erreicht und heute noch nicht geprueft" statt exaktem
-- Uhrzeit-Treffer: so faellt beim Sommerzeit-Sprung nichts aus, und der eindeutige
-- dedupe_key verhindert Doppelversand in der doppelten Stunde im Herbst.
create function private.run_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone 'Europe/Berlin';
  v_today date := v_now::date;
  v_key text;
  v_titles text[];
  v_overdue integer;
  v_body text;
  p public.profiles;
begin
  for p in
    select * from public.profiles
    where deleted_at is null and reminder_time <= v_now::time
      and (notify_due_today or notify_overdue)
  loop
    v_key := 'due:' || p.id || ':' || v_today;
    continue when exists (select 1 from public.notification_log where dedupe_key = v_key);

    v_titles := '{}';
    v_overdue := 0;
    if p.notify_due_today then
      select coalesce(array_agg(t.title order by t.title), '{}') into v_titles from public.todos t
      where t.household_id = p.household_id and t.deleted_at is null and t.status = 'open'
        and t.due_date = v_today and (t.assignee_id is null or t.assignee_id = p.id);
    end if;
    if p.notify_overdue then
      select count(*) into v_overdue from public.todos t
      where t.household_id = p.household_id and t.deleted_at is null and t.status = 'open'
        and t.due_date < v_today and (t.assignee_id is null or t.assignee_id = p.id);
    end if;

    if cardinality(v_titles) = 0 and v_overdue = 0 then
      -- Merker, damit eine spaeter angelegte Aufgabe keine verspaetete Erinnerung ausloest.
      insert into public.notification_log (household_id, recipient_id, kind, dedupe_key, sent_at)
      values (p.household_id, p.id, 'due_skipped', v_key, now())
      on conflict (dedupe_key) do nothing;
      continue;
    end if;

    v_body := array_to_string(v_titles, ', ');
    if v_overdue > 0 then
      v_body := trim(v_body || ' (' || v_overdue || ' überfällig)');
    end if;
    perform private.enqueue(p.household_id, p.id, 'due', v_key, null,
      'Heute fällig: ' || cardinality(v_titles), v_body);
  end loop;
  perform private.kick_dispatch();
end $$;

create function private.cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.notification_log where created_at < now() - interval '90 days';
  delete from public.sync_ops where applied_at < now() - interval '90 days';
  -- FCM verwirft Android-Registrierungen nach 270 Tagen Inaktivitaet.
  delete from public.device_tokens where last_seen_at < now() - interval '270 days';
$$;

-- ---------------------------------------------------------------- Sync

create function private.apply_todo(
  p_id uuid, p_fields jsonb, p_at timestamptz, p_profile uuid, p_household uuid
) returns void
language plpgsql set search_path = '' as $$
declare
  v_row public.todos;
  v_merged jsonb := '{}';
  v_versions jsonb;
  v_key text;
  v_value jsonb;
  v_exists boolean;
  v_status text;
begin
  select * into v_row from public.todos where id = p_id for update;
  v_exists := found;
  if v_exists and v_row.household_id <> p_household then
    raise exception 'foreign todo';
  end if;
  v_versions := coalesce(v_row.field_versions, '{}');

  -- Last-write-wins pro Feld.
  for v_key, v_value in select * from jsonb_each(p_fields) loop
    continue when v_key not in ('title', 'description', 'category_id', 'due_date',
      'assignee_id', 'effort_minutes', 'status', 'deleted_at');
    if v_versions ->> v_key is null or (v_versions ->> v_key)::timestamptz <= p_at then
      v_merged := v_merged || jsonb_build_object(v_key, v_value);
      v_versions := v_versions || jsonb_build_object(v_key, p_at);
    end if;
  end loop;

  if v_merged ? 'category_id' and v_merged ->> 'category_id' is not null
     and not exists (select 1 from public.categories
       where id = (v_merged ->> 'category_id')::uuid and household_id = p_household) then
    raise exception 'foreign category';
  end if;
  if v_merged ? 'assignee_id' and v_merged ->> 'assignee_id' is not null
     and not exists (select 1 from public.profiles
       where id = (v_merged ->> 'assignee_id')::uuid and household_id = p_household) then
    raise exception 'foreign assignee';
  end if;

  if not v_exists then
    v_status := coalesce(v_merged ->> 'status', 'open');
    insert into public.todos (id, household_id, title, description, category_id, due_date,
      assignee_id, effort_minutes, status, done_at, done_by, created_by, last_changed_by,
      field_versions, created_at, deleted_at)
    values (p_id, p_household, v_merged ->> 'title', coalesce(v_merged ->> 'description', ''),
      (v_merged ->> 'category_id')::uuid, (v_merged ->> 'due_date')::date,
      (v_merged ->> 'assignee_id')::uuid, (v_merged ->> 'effort_minutes')::integer, v_status,
      case when v_status = 'done' then p_at end, case when v_status = 'done' then p_profile end,
      p_profile, p_profile, v_versions, p_at, (v_merged ->> 'deleted_at')::timestamptz);
    return;
  end if;

  if v_merged = '{}' then return; end if;

  v_status := coalesce(v_merged ->> 'status', v_row.status);
  update public.todos set
    title = case when v_merged ? 'title' then v_merged ->> 'title' else title end,
    description = case when v_merged ? 'description' then coalesce(v_merged ->> 'description', '') else description end,
    category_id = case when v_merged ? 'category_id' then (v_merged ->> 'category_id')::uuid else category_id end,
    due_date = case when v_merged ? 'due_date' then (v_merged ->> 'due_date')::date else due_date end,
    assignee_id = case when v_merged ? 'assignee_id' then (v_merged ->> 'assignee_id')::uuid else assignee_id end,
    effort_minutes = case when v_merged ? 'effort_minutes' then (v_merged ->> 'effort_minutes')::integer else effort_minutes end,
    status = v_status,
    -- erledigt_von kommt immer vom Server, nie aus dem Client-Payload.
    done_at = case when v_status = 'open' then null when status = 'open' then p_at else done_at end,
    done_by = case when v_status = 'open' then null when status = 'open' then p_profile else done_by end,
    deleted_at = case when v_merged ? 'deleted_at' then (v_merged ->> 'deleted_at')::timestamptz else deleted_at end,
    last_changed_by = p_profile,
    field_versions = v_versions
  where id = p_id;
end $$;

-- Wendet die Outbox eines Geraets an. Eine fehlerhafte Operation landet in "rejected"
-- und blockiert die folgenden nicht.
create function public.sync_push(p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid := private.current_profile_id();
  v_household uuid := private.current_household_id();
  v_op jsonb;
  v_op_id uuid;
  v_at timestamptz;
  v_id uuid;
  v_fields jsonb;
  v_applied uuid[] := '{}';
  v_rejected jsonb := '[]';
begin
  if v_profile is null then raise exception 'no profile' using errcode = '42501'; end if;

  for v_op in select * from jsonb_array_elements(p_ops) loop
    v_op_id := (v_op ->> 'op_id')::uuid;
    begin
      insert into public.sync_ops (op_id, user_id) values (v_op_id, auth.uid())
      on conflict (op_id) do nothing;
      if found then
        v_at := least((v_op ->> 'changed_at')::timestamptz, now());
        v_id := (v_op ->> 'id')::uuid;
        v_fields := v_op -> 'fields';
        case v_op ->> 'entity'
          when 'todo' then
            perform private.apply_todo(v_id, v_fields, v_at, v_profile, v_household);
          when 'category' then
            insert into public.categories (id, household_id, name, sort_order, client_changed_at, deleted_at)
            values (v_id, v_household, v_fields ->> 'name', coalesce((v_fields ->> 'sort_order')::integer, 0),
              v_at, (v_fields ->> 'deleted_at')::timestamptz)
            on conflict (id) do update set
              name = case when excluded.name is not null then excluded.name else public.categories.name end,
              sort_order = case when v_fields ? 'sort_order' then excluded.sort_order else public.categories.sort_order end,
              deleted_at = case when v_fields ? 'deleted_at' then excluded.deleted_at else public.categories.deleted_at end,
              client_changed_at = excluded.client_changed_at
            where public.categories.household_id = v_household
              and public.categories.client_changed_at <= excluded.client_changed_at;
          when 'subtask' then
            if not exists (select 1 from public.todos
                where id = (v_fields ->> 'todo_id')::uuid and household_id = v_household) then
              raise exception 'foreign todo';
            end if;
            insert into public.subtasks (id, household_id, todo_id, title, is_done, sort_order, client_changed_at, deleted_at)
            values (v_id, v_household, (v_fields ->> 'todo_id')::uuid, v_fields ->> 'title',
              coalesce((v_fields ->> 'is_done')::boolean, false),
              coalesce((v_fields ->> 'sort_order')::integer, 0), v_at, (v_fields ->> 'deleted_at')::timestamptz)
            on conflict (id) do update set
              title = excluded.title, is_done = excluded.is_done, sort_order = excluded.sort_order,
              deleted_at = excluded.deleted_at, client_changed_at = excluded.client_changed_at
            where public.subtasks.household_id = v_household
              and public.subtasks.client_changed_at <= excluded.client_changed_at;
          when 'comment' then
            if not exists (select 1 from public.todos
                where id = (v_fields ->> 'todo_id')::uuid and household_id = v_household) then
              raise exception 'foreign todo';
            end if;
            -- Kommentare sind unveraenderlich; nur der Autor kann sie loeschen.
            insert into public.comments (id, household_id, todo_id, author_id, body, created_at, deleted_at)
            values (v_id, v_household, (v_fields ->> 'todo_id')::uuid, v_profile, v_fields ->> 'body', v_at,
              (v_fields ->> 'deleted_at')::timestamptz)
            on conflict (id) do update set deleted_at = excluded.deleted_at
            where public.comments.author_id = v_profile;
          else
            raise exception 'unknown entity';
        end case;
      end if;
      v_applied := v_applied || v_op_id;
    exception when others then
      v_rejected := v_rejected || jsonb_build_object('op_id', v_op_id, 'error', sqlerrm);
    end;
  end loop;

  perform private.kick_dispatch();
  return jsonb_build_object('applied', to_jsonb(v_applied), 'rejected', v_rejected);
end $$;

create function public.sync_pull(p_cursor bigint) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'cursor', greatest(p_cursor,
      coalesce((select max(server_seq) from public.todos), 0),
      coalesce((select max(server_seq) from public.subtasks), 0),
      coalesce((select max(server_seq) from public.comments), 0),
      coalesce((select max(server_seq) from public.categories), 0),
      coalesce((select max(server_seq) from public.profiles), 0)),
    'todos', coalesce((select jsonb_agg(to_jsonb(t) - 'field_versions') from public.todos t where t.server_seq > p_cursor), '[]'),
    'subtasks', coalesce((select jsonb_agg(to_jsonb(s)) from public.subtasks s where s.server_seq > p_cursor), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c)) from public.comments c where c.server_seq > p_cursor), '[]'),
    'categories', coalesce((select jsonb_agg(to_jsonb(k)) from public.categories k where k.server_seq > p_cursor), '[]'),
    'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from public.profiles p where p.server_seq > p_cursor), '[]')
  )
$$;

create function public.register_device(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid := private.current_profile_id();
begin
  if v_profile is null then raise exception 'no profile' using errcode = '42501'; end if;
  -- Ein Token gehoert immer dem zuletzt angemeldeten Nutzer des Geraets.
  insert into public.device_tokens (token, profile_id, household_id)
  values (p_token, v_profile, private.current_household_id())
  on conflict (token) do update set
    profile_id = excluded.profile_id, household_id = excluded.household_id,
    last_seen_at = now(), updated_at = now();
end $$;

create function public.unregister_device(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.device_tokens where token = p_token and profile_id = private.current_profile_id()
$$;

-- Fuer den Keep-alive-Job: eine echte Abfrage, die keine Daten preisgibt.
create function public.keepalive() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) >= 0 from public.todos
$$;

-- Nur fuer die Edge Function (service_role).
create function public.claim_notifications(p_limit integer default 100)
returns setof public.notification_log
language sql security definer set search_path = '' as $$
  update public.notification_log set claimed_at = now(), attempts = attempts + 1
  where id in (
    select id from public.notification_log
    where sent_at is null and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by id
    for update skip locked
    limit p_limit
  )
  returning *
$$;

revoke all on function public.sync_push(jsonb), public.sync_pull(bigint),
  public.register_device(text), public.unregister_device(text),
  public.keepalive(), public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.sync_push(jsonb), public.sync_pull(bigint),
  public.register_device(text), public.unregister_device(text) to authenticated;
grant execute on function public.keepalive() to anon;
grant execute on function public.claim_notifications(integer) to service_role;

-- Einmalig nach dem Anlegen der beiden Konten ausfuehren (siehe docs/EINRICHTUNG.md).
create function private.bootstrap_household(
  p_name text, p_email_1 text, p_name_1 text, p_email_2 text, p_name_2 text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid;
begin
  insert into public.households (name) values (p_name) returning id into v_household;
  insert into public.profiles (user_id, household_id, display_name)
  select u.id, v_household, x.display_name
  from (values (p_email_1, p_name_1), (p_email_2, p_name_2)) as x (email, display_name)
  join auth.users u on lower(u.email) = lower(x.email);
  if (select count(*) from public.profiles where household_id = v_household) <> 2 then
    raise exception 'Beide Konten muessen existieren';
  end if;
  insert into public.categories (id, household_id, name, sort_order)
  values (gen_random_uuid(), v_household, 'Handwerkliches', 1),
         (gen_random_uuid(), v_household, 'Haushaltstätigkeit', 2),
         (gen_random_uuid(), v_household, 'Garten', 3);
  return v_household;
end $$;

revoke all on all functions in schema private from public;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.current_profile_id() to authenticated;

select cron.schedule('zahnwerk-reminders', '*/15 * * * *', 'select private.run_reminders()');
select cron.schedule('zahnwerk-cleanup', '17 3 * * *', 'select private.cleanup()');
