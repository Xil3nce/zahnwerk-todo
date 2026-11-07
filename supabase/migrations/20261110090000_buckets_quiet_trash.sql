-- Version 1.0.6:
-- * important: "Wichtig"-Markierung.
-- * due_window: Zeitfenster statt Stichtag ("irgendwann diese Woche", "bis Monatsende").
--   due_date bleibt das Ende des Fensters (Sonntag bzw. Monatsletzter); so funktionieren
--   Ueberfaellig, Ansichten und taegliche Erinnerung unveraendert. Folgeaufgaben rasten aufs Fensterende ein.
-- * bucket: 'later' = Spaeter-Ablage (ohne Datum), 'idea' = Ideen-Parkplatz; null = normale Aufgabe.
-- * Ruhezeiten 22 bis 7 Uhr (Europe/Berlin): keine Pushes; was nachts anfaellt, kommt morgens gesammelt.
-- * Papierkorb: geloeschte Aufgaben bleiben 30 Tage wiederherstellbar, danach entfernt sie der Cleanup.

alter table public.todos
  add column important boolean not null default false,
  add column due_window text check (due_window in ('week', 'month')),
  add column bucket text check (bucket in ('later', 'idea'));

alter table public.profiles add column quiet_hours boolean not null default true;
grant update (quiet_hours) on public.profiles to authenticated;

alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('done', 'new', 'changed', 'comment', 'due', 'due_skipped', 'remind', 'digest'));
-- Eintraege, die in einer Morgen-Sammelmeldung aufgegangen sind, zeigen auf diese.
alter table public.notification_log add column digest_id bigint references public.notification_log (id) on delete set null;

-- ---------------------------------------------------------------- Zeitfenster

-- Ende des Fensters, in dem p_date liegt: Sonntag der Woche (Mo-So) bzw. Monatsletzter.
create function private.snap_window(p_date date, p_window text) returns date
language sql immutable set search_path = '' as $$
  select case p_window
    when 'week' then p_date + (7 - extract(isodow from p_date)::integer)
    when 'month' then (date_trunc('month', p_date) + interval '1 month - 1 day')::date
    else p_date
  end
$$;

create function private.next_due_windowed(r jsonb, p_due date, p_done date, p_window text) returns date
language sql immutable set search_path = '' as $$
  select private.snap_window(private.next_due(r, p_due, p_done), p_window)
$$;

-- Wie in 20261108090000_todo_reminder.sql; neu: Fenster einrasten, Wichtig/Fenster/Ablage uebernehmen.
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

  v_due := private.next_due_windowed(v_row.recurrence, v_row.due_date,
    (v_row.done_at at time zone 'Europe/Berlin')::date, v_row.due_window);
  if v_row.remind_at is not null then
    v_remind := case
      when v_row.due_date is not null then
        ((v_row.remind_at at time zone 'Europe/Berlin') + (v_due - v_row.due_date) * interval '1 day') at time zone 'Europe/Berlin'
      else (v_due + (v_row.remind_at at time zone 'Europe/Berlin')::time) at time zone 'Europe/Berlin'
    end;
  end if;

  insert into public.todos (id, household_id, title, description, category_id, due_date,
    assignee_id, effort_minutes, recurrence, remind_at, important, due_window, bucket,
    recurred_from, created_by, last_changed_by)
  values (v_new, v_row.household_id, v_row.title, v_row.description, v_row.category_id, v_due,
    v_row.assignee_id, v_row.effort_minutes, v_row.recurrence, v_remind, v_row.important,
    v_row.due_window, v_row.bucket, v_row.id, p_profile, p_profile);

  -- Unteraufgaben kommen offen wieder mit.
  insert into public.subtasks (id, household_id, todo_id, title, is_done, sort_order)
  select gen_random_uuid(), s.household_id, v_new, s.title, false, s.sort_order
  from public.subtasks s where s.todo_id = p_id and s.deleted_at is null;

  update public.todos set spawned_id = v_new where id = p_id;
end $$;

-- Wie in 20261108090000_todo_reminder.sql, ergaenzt um important, due_window und bucket.
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
      'assignee_id', 'effort_minutes', 'status', 'deleted_at', 'recurrence', 'remind_at',
      'important', 'due_window', 'bucket');
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
      assignee_id, effort_minutes, recurrence, remind_at, important, due_window, bucket,
      status, done_at, done_by, created_by, last_changed_by, field_versions, created_at, deleted_at)
    values (p_id, p_household, v_merged ->> 'title', coalesce(v_merged ->> 'description', ''),
      (v_merged ->> 'category_id')::uuid, (v_merged ->> 'due_date')::date,
      (v_merged ->> 'assignee_id')::uuid, (v_merged ->> 'effort_minutes')::integer,
      nullif(v_merged -> 'recurrence', 'null'::jsonb), (v_merged ->> 'remind_at')::timestamptz,
      coalesce((v_merged ->> 'important')::boolean, false), v_merged ->> 'due_window', v_merged ->> 'bucket',
      v_status,
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
    important = case when v_merged ? 'important' then coalesce((v_merged ->> 'important')::boolean, false) else important end,
    due_window = case when v_merged ? 'due_window' then v_merged ->> 'due_window' else due_window end,
    bucket = case when v_merged ? 'bucket' then v_merged ->> 'bucket' else bucket end,
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

-- Wie in 20261109090000_done_push_next.sql; neu: Wiederherstellen aus dem Papierkorb, Ideen,
-- Wichtig/Zeitfenster/Ablage als Aenderung, naechster Termin mit eingerastetem Fenster.
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
    v_body := coalesce(v_actor_name, '') || case when new.bucket = 'idea'
      then ' hat eine neue Idee geparkt' else ' hat eine neue Aufgabe angelegt' end;
  elsif new.deleted_at is not null and old.deleted_at is null then
    v_kind := 'changed';
    v_body := coalesce(v_actor_name, '') || ' hat die Aufgabe gelöscht';
  elsif new.deleted_at is not null then
    return null;
  elsif old.deleted_at is not null then
    v_kind := 'changed';
    v_body := coalesce(v_actor_name, '') || ' hat die Aufgabe wiederhergestellt';
  elsif new.status = 'done' and old.status = 'open' then
    v_kind := 'done';
    v_body := 'Erledigt von ' || coalesce(v_actor_name, '');
    -- Bei Wiederholungen den naechsten Termin nennen (nur beim ersten Erledigen, wenn die
    -- Folgeaufgabe entsteht); gleiche Rechnung wie in spawn_next.
    if new.recurrence is not null and new.spawned_id is null then
      v_body := v_body || ', nächste fällig am ' || to_char(private.next_due_windowed(new.recurrence, new.due_date,
        (new.done_at at time zone 'Europe/Berlin')::date, new.due_window), 'DD.MM.');
    end if;
  else
    if new.status = 'open' and old.status = 'done' then v_changes := array_append(v_changes, 'wieder geöffnet'); end if;
    if new.title is distinct from old.title then v_changes := array_append(v_changes, 'Titel'); end if;
    if new.description is distinct from old.description then v_changes := array_append(v_changes, 'Beschreibung'); end if;
    if new.category_id is distinct from old.category_id then v_changes := array_append(v_changes, 'Kategorie'); end if;
    if new.due_date is distinct from old.due_date or new.due_window is distinct from old.due_window then
      v_changes := array_append(v_changes, 'Fälligkeit');
    end if;
    if new.assignee_id is distinct from old.assignee_id then v_changes := array_append(v_changes, 'Zuständigkeit'); end if;
    if new.effort_minutes is distinct from old.effort_minutes then v_changes := array_append(v_changes, 'Zeitaufwand'); end if;
    if new.recurrence is distinct from old.recurrence then v_changes := array_append(v_changes, 'Wiederholung'); end if;
    if new.remind_at is distinct from old.remind_at then v_changes := array_append(v_changes, 'Erinnerung'); end if;
    if new.important is distinct from old.important then
      v_changes := array_append(v_changes, case when new.important then 'als wichtig markiert' else 'nicht mehr wichtig' end);
    end if;
    if new.bucket is distinct from old.bucket then
      v_changes := array_append(v_changes, case new.bucket when 'later' then 'nach „Später“ verschoben'
        when 'idea' then 'zu den Ideen verschoben' else 'eingeplant' end);
    end if;
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

-- ---------------------------------------------------------------- Ruhezeiten

create function private.in_quiet_hours(p_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select extract(hour from p_at at time zone 'Europe/Berlin') >= 22
      or extract(hour from p_at at time zone 'Europe/Berlin') < 7
$$;

-- Morgens: Was ein Empfaenger mit Ruhezeiten nachts angesammelt hat, wird zu einer Meldung.
-- Ein einzelner Eintrag geht unveraendert raus.
create function private.collect_digests(p_now timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_id bigint;
begin
  if private.in_quiet_hours(p_now) then return; end if;
  for r in
    select n.recipient_id, n.household_id, count(*)::integer c, array_agg(n.id order by n.id) ids,
      string_agg(distinct coalesce(nullif(n.title, ''), n.body), ', ') titles
    from public.notification_log n
    join public.profiles p on p.id = n.recipient_id
    where n.sent_at is null and n.claimed_at is null and n.attempts = 0
      and n.kind <> 'digest' and p.quiet_hours and private.in_quiet_hours(n.created_at)
    group by n.recipient_id, n.household_id
    having count(*) > 1
  loop
    insert into public.notification_log (household_id, recipient_id, kind, dedupe_key, title, body)
    values (r.household_id, r.recipient_id, 'digest', 'digest:' || r.recipient_id || ':' || r.ids[1],
      'Seit gestern Abend: ' || r.c || ' Neuigkeiten', left(r.titles, 400))
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    update public.notification_log set sent_at = p_now, digest_id = v_id where id = any (r.ids);
  end loop;
end $$;

-- Wie in 20261102090000_schema.sql; neu: Ruhezeiten des Empfaengers und Sammelmeldung am Morgen.
-- p_now nur fuer Tests; die Edge Function uebergibt es nicht.
drop function public.claim_notifications(integer);
create function public.claim_notifications(p_limit integer default 100, p_now timestamptz default now())
returns setof public.notification_log
language plpgsql security definer set search_path = '' as $$
begin
  perform private.collect_digests(p_now);
  return query
  update public.notification_log l set claimed_at = p_now, attempts = l.attempts + 1
  where l.id in (
    select n.id from public.notification_log n
    join public.profiles p on p.id = n.recipient_id
    where n.sent_at is null and n.attempts < 5
      and (n.claimed_at is null or n.claimed_at < p_now - interval '5 minutes')
      and not (p.quiet_hours and private.in_quiet_hours(p_now))
    order by n.id
    for update of n skip locked
    limit p_limit
  )
  returning l.*;
end $$;
revoke all on function public.claim_notifications(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer, timestamptz) to service_role;

-- Wie in 20261102090000_schema.sql; weckt die Edge Function nur, wenn jemand ausserhalb
-- der Ruhezeit etwas bekommt. Um 7 Uhr stoesst der 15-Minuten-Job der Erinnerungen den Versand an.
create or replace function private.kick_dispatch() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'zahnwerk_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'zahnwerk_push_secret';
  if v_url is null or v_secret is null then return; end if;
  if not exists (
    select 1 from public.notification_log n join public.profiles p on p.id = n.recipient_id
    where n.sent_at is null and n.attempts < 5 and not (p.quiet_hours and private.in_quiet_hours(now()))
  ) then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := '{}'::jsonb
  );
end $$;

-- ---------------------------------------------------------------- Papierkorb

-- Wie in 20261102090000_schema.sql; neu: Aufgaben, die seit mehr als 30 Tagen im Papierkorb
-- liegen, endgueltig entfernen (mit Unteraufgaben und Kommentaren).
create or replace function private.cleanup() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  delete from public.notification_log where created_at < now() - interval '90 days';
  delete from public.sync_ops where applied_at < now() - interval '90 days';
  -- FCM verwirft Android-Registrierungen nach 270 Tagen Inaktivitaet.
  delete from public.device_tokens where last_seen_at < now() - interval '270 days';

  select coalesce(array_agg(id), '{}') into v_ids from public.todos
  where deleted_at is not null and deleted_at < now() - interval '30 days';
  if cardinality(v_ids) = 0 then return; end if;
  update public.notification_log set todo_id = null where todo_id = any (v_ids);
  delete from public.comments where todo_id = any (v_ids);
  delete from public.subtasks where todo_id = any (v_ids);
  delete from public.todos where id = any (v_ids);
end $$;

revoke all on all functions in schema private from public;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.current_profile_id() to authenticated;
