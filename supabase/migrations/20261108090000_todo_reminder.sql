-- Erinnerung zu einer bestimmten Uhrzeit (einmalig pro Aufgabe).
-- Ein Cron-Job alle 5 Minuten verschickt faellige Erinnerungen an die Zustaendigen
-- (bei "Beide" an beide). Der dedupe_key enthaelt den Zeitpunkt: wird die Erinnerung
-- verschoben, kommt sie zur neuen Zeit erneut.

alter table public.todos add column remind_at timestamptz;
create index todos_remind on public.todos (remind_at)
  where remind_at is not null and status = 'open' and deleted_at is null;

alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('done', 'new', 'changed', 'comment', 'due', 'due_skipped', 'remind'));

create function private.run_todo_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.todos;
  r record;
begin
  for t in
    select * from public.todos
    where remind_at is not null and status = 'open' and deleted_at is null
      -- Nur juengst faellige: eine laengst vergangene Zeit (z. B. nach Ausfall) loest nichts mehr aus.
      and remind_at <= now() and remind_at > now() - interval '1 day'
  loop
    for r in
      select p.id from public.profiles p
      where p.household_id = t.household_id and p.deleted_at is null
        and (t.assignee_id is null or t.assignee_id = p.id)
    loop
      perform private.enqueue(t.household_id, r.id, 'remind',
        'remind:' || t.id || ':' || extract(epoch from t.remind_at)::bigint || ':' || r.id,
        t.id, t.title,
        'Erinnerung' || case when t.due_date is not null
          then ', fällig ' || to_char(t.due_date, 'DD.MM.') else '' end);
    end loop;
  end loop;
  perform private.kick_dispatch();
end $$;

-- Wie in 20261107090000_recurrence.sql, die Folgeaufgabe uebernimmt zusaetzlich die Erinnerung:
-- gleicher Abstand zur Faelligkeit, ohne Faelligkeit dieselbe Uhrzeit am neuen Termin.
create or replace function private.spawn_next(p_id uuid, p_profile uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_row public.todos;
  v_new uuid := gen_random_uuid();
  v_due date;
  v_remind timestamptz;
begin
  select * into v_row from public.todos where id = p_id;
  if v_row.recurrence is null or v_row.spawned_id is not null or v_row.deleted_at is not null
     or v_row.status <> 'done' then
    return;
  end if;

  v_due := private.next_due(v_row.recurrence, v_row.due_date, (v_row.done_at at time zone 'Europe/Berlin')::date);
  if v_row.remind_at is not null then
    v_remind := case
      when v_row.due_date is not null then
        ((v_row.remind_at at time zone 'Europe/Berlin') + (v_due - v_row.due_date) * interval '1 day') at time zone 'Europe/Berlin'
      else (v_due + (v_row.remind_at at time zone 'Europe/Berlin')::time) at time zone 'Europe/Berlin'
    end;
  end if;

  insert into public.todos (id, household_id, title, description, category_id, due_date,
    assignee_id, effort_minutes, recurrence, remind_at, recurred_from, created_by, last_changed_by)
  values (v_new, v_row.household_id, v_row.title, v_row.description, v_row.category_id, v_due,
    v_row.assignee_id, v_row.effort_minutes, v_row.recurrence, v_remind, v_row.id, p_profile, p_profile);

  -- Unteraufgaben kommen offen wieder mit.
  insert into public.subtasks (id, household_id, todo_id, title, is_done, sort_order)
  select gen_random_uuid(), s.household_id, v_new, s.title, false, s.sort_order
  from public.subtasks s where s.todo_id = p_id and s.deleted_at is null;

  update public.todos set spawned_id = v_new where id = p_id;
end $$;

-- Wie in 20261107090000_recurrence.sql, ergaenzt um "remind_at".
create or replace function private.apply_todo(
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
      'assignee_id', 'effort_minutes', 'status', 'deleted_at', 'recurrence', 'remind_at');
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
      assignee_id, effort_minutes, recurrence, remind_at, status, done_at, done_by, created_by, last_changed_by,
      field_versions, created_at, deleted_at)
    values (p_id, p_household, v_merged ->> 'title', coalesce(v_merged ->> 'description', ''),
      (v_merged ->> 'category_id')::uuid, (v_merged ->> 'due_date')::date,
      (v_merged ->> 'assignee_id')::uuid, (v_merged ->> 'effort_minutes')::integer,
      nullif(v_merged -> 'recurrence', 'null'::jsonb), (v_merged ->> 'remind_at')::timestamptz, v_status,
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
    recurrence = case when v_merged ? 'recurrence' then nullif(v_merged -> 'recurrence', 'null'::jsonb) else recurrence end,
    remind_at = case when v_merged ? 'remind_at' then (v_merged ->> 'remind_at')::timestamptz else remind_at end,
    status = v_status,
    -- erledigt_von kommt immer vom Server, nie aus dem Client-Payload.
    done_at = case when v_status = 'open' then null when status = 'open' then p_at else done_at end,
    done_by = case when v_status = 'open' then null when status = 'open' then p_profile else done_by end,
    deleted_at = case when v_merged ? 'deleted_at' then (v_merged ->> 'deleted_at')::timestamptz else deleted_at end,
    last_changed_by = p_profile,
    field_versions = v_versions
  where id = p_id;

  if v_status = 'done' and v_row.status = 'open' then
    perform private.spawn_next(p_id, p_profile);
  end if;
end $$;

-- Wie in 20261107090000_recurrence.sql, eine geaenderte Erinnerung wird genannt.
create or replace function private.on_todo_change() returns trigger
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
    if new.recurred_from is not null then return null; end if;
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
    if new.recurrence is distinct from old.recurrence then v_changes := array_append(v_changes, 'Wiederholung'); end if;
    if new.remind_at is distinct from old.remind_at then v_changes := array_append(v_changes, 'Erinnerung'); end if;
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

revoke all on all functions in schema private from public;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.current_profile_id() to authenticated;

select cron.schedule('zahnwerk-todo-reminders', '*/5 * * * *', 'select private.run_todo_reminders()');
