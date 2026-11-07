-- Der Erledigt-Push nennt bei wiederkehrenden Aufgaben den naechsten Termin.
-- Wie in 20261108090000_todo_reminder.sql, nur der Zweig "done" ist ergaenzt.
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
    -- Bei Wiederholungen den naechsten Termin nennen (nur beim ersten Erledigen, wenn die
    -- Folgeaufgabe entsteht); gleiche Rechnung wie in spawn_next.
    if new.recurrence is not null and new.spawned_id is null then
      v_body := v_body || ', nächste fällig am ' || to_char(private.next_due(new.recurrence, new.due_date,
        (new.done_at at time zone 'Europe/Berlin')::date), 'DD.MM.');
    end if;
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

