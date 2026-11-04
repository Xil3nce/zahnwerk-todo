-- Kategorien bekommen eine optionale Farbe (#rrggbb, Kleinbuchstaben).
-- Aeltere App-Versionen schicken kein "color"; dann bleibt die gespeicherte Farbe erhalten.
alter table public.categories add column color text check (color ~ '^#[0-9a-f]{6}$');

-- Wie in 20261102090000_schema.sql, nur der Zweig "category" uebernimmt zusaetzlich die Farbe.
create or replace function public.sync_push(p_ops jsonb) returns jsonb
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
            insert into public.categories (id, household_id, name, sort_order, color, client_changed_at, deleted_at)
            values (v_id, v_household, v_fields ->> 'name', coalesce((v_fields ->> 'sort_order')::integer, 0),
              v_fields ->> 'color', v_at, (v_fields ->> 'deleted_at')::timestamptz)
            on conflict (id) do update set
              name = case when excluded.name is not null then excluded.name else public.categories.name end,
              sort_order = case when v_fields ? 'sort_order' then excluded.sort_order else public.categories.sort_order end,
              color = case when v_fields ? 'color' then excluded.color else public.categories.color end,
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
