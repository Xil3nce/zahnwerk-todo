-- Vorlagen (1.0.8): wiederverwendbare Aufgaben mit Checkliste, z. B. "Urlaub packen".
-- Eine Vorlage wird als ganzer Datensatz synchronisiert (Last-write-wins wie Kategorien).
-- Beim Starten legt der Client eine normale Aufgabe mit Unteraufgaben an; der Server kennt
-- keine Verbindung zwischen Vorlage und Aufgabe.

-- Checkliste: Liste aus 0 bis 100 Texten mit je 1 bis 200 Zeichen.
create function private.valid_template_items(p_items jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) <= 100
    and not exists (
      select 1 from jsonb_array_elements(p_items) e
      where jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) not between 1 and 200
    )
$$;

create table public.templates (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  category_id uuid references public.categories (id),
  effort_minutes integer check (effort_minutes is null or effort_minutes between 1 and 100000),
  important boolean not null default false,
  items jsonb not null default '[]' check (private.valid_template_items(items)),
  client_changed_at timestamptz not null default now(),
  server_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index templates_household_seq on public.templates (household_id, server_seq);

create trigger stamp before insert or update on public.templates for each row execute function private.stamp_change();

alter table public.templates enable row level security;
create policy household_read on public.templates for select to authenticated
  using (household_id = private.current_household_id());
revoke all on public.templates from anon, authenticated;
grant select on public.templates to authenticated;
grant all on public.templates to service_role;

-- Wie in 20261104090000_category_color.sql; neu ist nur der Zweig "template".
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
          when 'template' then
            if v_fields ->> 'category_id' is not null and not exists (select 1 from public.categories
                where id = (v_fields ->> 'category_id')::uuid and household_id = v_household) then
              raise exception 'foreign category';
            end if;
            insert into public.templates (id, household_id, title, description, category_id, effort_minutes,
              important, items, client_changed_at, deleted_at)
            values (v_id, v_household, v_fields ->> 'title', coalesce(v_fields ->> 'description', ''),
              (v_fields ->> 'category_id')::uuid, (v_fields ->> 'effort_minutes')::integer,
              coalesce((v_fields ->> 'important')::boolean, false), coalesce(v_fields -> 'items', '[]'),
              v_at, (v_fields ->> 'deleted_at')::timestamptz)
            on conflict (id) do update set
              title = excluded.title, description = excluded.description, category_id = excluded.category_id,
              effort_minutes = excluded.effort_minutes, important = excluded.important, items = excluded.items,
              deleted_at = excluded.deleted_at, client_changed_at = excluded.client_changed_at
            where public.templates.household_id = v_household
              and public.templates.client_changed_at <= excluded.client_changed_at;
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

-- Wie in 20261102090000_schema.sql, zusaetzlich mit Vorlagen.
create or replace function public.sync_pull(p_cursor bigint) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'cursor', greatest(p_cursor,
      coalesce((select max(server_seq) from public.todos), 0),
      coalesce((select max(server_seq) from public.subtasks), 0),
      coalesce((select max(server_seq) from public.comments), 0),
      coalesce((select max(server_seq) from public.categories), 0),
      coalesce((select max(server_seq) from public.profiles), 0),
      coalesce((select max(server_seq) from public.templates), 0)),
    'todos', coalesce((select jsonb_agg(to_jsonb(t) - 'field_versions') from public.todos t where t.server_seq > p_cursor), '[]'),
    'subtasks', coalesce((select jsonb_agg(to_jsonb(s)) from public.subtasks s where s.server_seq > p_cursor), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c)) from public.comments c where c.server_seq > p_cursor), '[]'),
    'categories', coalesce((select jsonb_agg(to_jsonb(k)) from public.categories k where k.server_seq > p_cursor), '[]'),
    'profiles', coalesce((select jsonb_agg(to_jsonb(p)) from public.profiles p where p.server_seq > p_cursor), '[]'),
    'templates', coalesce((select jsonb_agg(to_jsonb(v)) from public.templates v where v.server_seq > p_cursor), '[]')
  )
$$;

revoke all on all functions in schema private from public;
grant execute on function private.current_household_id() to authenticated;
grant execute on function private.current_profile_id() to authenticated;
