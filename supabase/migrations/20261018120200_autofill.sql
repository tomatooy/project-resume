-- Autofill keeps three things per user: a Profile (structured answers),
-- Notes (free text the AI reads), and the last 20 snapshots of the Notes for
-- History and Undo. It also remembers which resume went to which posting.

create type note_version_reason as enum ('merge', 'edit', 'restore');

create table autofill_profiles (
  user_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data           jsonb not null check (jsonb_typeof(data) = 'object'),
  schema_version int not null,
  revision       bigint not null default 1,
  updated_at     timestamptz not null default now()
);

create table autofill_notes (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  content    text not null default '' check (char_length(content) <= 10000),
  revision   bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- clock_timestamp, not now: a restore snapshots and writes in one
-- transaction, and History must still order those rows.
create table autofill_note_versions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content    text not null,
  reason     note_version_reason not null,
  created_at timestamptz not null default clock_timestamp()
);
create index autofill_note_versions_user_created on autofill_note_versions (user_id, created_at desc);

create table autofill_applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vendor            text not null check (char_length(vendor) between 1 and 40),
  posting_key       text not null check (char_length(posting_key) <= 300),
  org_slug          text,
  url               text not null,
  company           text,
  title             text,
  resume_id         uuid references resumes(id) on delete set null,
  resume_version_id uuid references resume_versions(id) on delete set null,
  job_target_id     uuid references job_targets(id) on delete set null,
  counts            jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, vendor, posting_key)
);
create trigger autofill_applications_updated_at
  before update on autofill_applications
  for each row execute function set_updated_at();

-- Same rule as `resumes`: the revision is the concurrency token and moves only
-- when the content does, and a client cannot set it through PostgREST.
create function autofill_profiles_revision() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.revision = 1;
    new.updated_at = now();
  elsif new.data is distinct from old.data then
    new.revision = old.revision + 1;
    new.updated_at = now();
  else
    new.revision = old.revision;
    new.updated_at = old.updated_at;
  end if;
  return new;
end $$;
create trigger autofill_profiles_revision
  before insert or update on autofill_profiles
  for each row execute function autofill_profiles_revision();

create function autofill_notes_revision() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.revision = 1;
    new.updated_at = now();
  elsif new.content is distinct from old.content then
    new.revision = old.revision + 1;
    new.updated_at = now();
  else
    new.revision = old.revision;
    new.updated_at = old.updated_at;
  end if;
  return new;
end $$;
create trigger autofill_notes_revision
  before insert or update on autofill_notes
  for each row execute function autofill_notes_revision();

alter table autofill_profiles enable row level security;
alter table autofill_notes enable row level security;
alter table autofill_note_versions enable row level security;
alter table autofill_applications enable row level security;
create policy autofill_profile_owner on autofill_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy autofill_notes_owner on autofill_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy autofill_note_version_owner on autofill_note_versions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy autofill_application_owner on autofill_applications
  for all using (user_id = auth.uid()) with check (
    user_id = auth.uid()
    and (resume_id is null or exists(select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
    and (resume_version_id is null or exists(select 1 from resume_versions v join resumes r on r.id = v.resume_id where v.id = resume_version_id and r.user_id = auth.uid()))
    and (job_target_id is null or exists(select 1 from job_targets j where j.id = job_target_id and j.user_id = auth.uid()))
  );
grant select, insert, update, delete on autofill_profiles, autofill_notes, autofill_note_versions, autofill_applications to authenticated;
revoke all on autofill_profiles, autofill_notes, autofill_note_versions, autofill_applications from anon;

-- Expected revision 0 means "no row yet". Two first saves racing both see no
-- row; the insert lets one win and refuses the other, rather than letting the
-- second overwrite the first.
create function save_autofill_profile(p_data jsonb, p_schema_version int, p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_row autofill_profiles;
begin
  select * into v_row from autofill_profiles where user_id = auth.uid() for update;
  if coalesce(v_row.revision, 0) <> p_expected_revision then
    raise exception 'Profile changed' using errcode = 'P0409';
  end if;
  if v_row.user_id is null then
    insert into autofill_profiles(user_id, data, schema_version)
      values (auth.uid(), p_data, p_schema_version)
      on conflict (user_id) do nothing
      returning * into v_row;
    if not found then
      raise exception 'Profile changed' using errcode = 'P0409';
    end if;
  else
    update autofill_profiles set data = p_data, schema_version = p_schema_version
      where user_id = auth.uid()
      returning * into v_row;
  end if;
  return jsonb_build_object('revision', v_row.revision, 'updated_at', v_row.updated_at);
end $$;

-- The newest snapshot is reused when it already holds this text, so a merge
-- right after an edit snapshot does not store the same Notes twice. Only the
-- newest 20 are kept.
create function private.autofill_note_snapshot(p_content text, p_reason note_version_reason) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_latest autofill_note_versions;
  v_id     uuid;
begin
  select * into v_latest from autofill_note_versions
    where user_id = auth.uid()
    order by created_at desc, id desc
    limit 1;
  if found and v_latest.content = p_content then
    return v_latest.id;
  end if;
  insert into autofill_note_versions(user_id, content, reason)
    values (auth.uid(), p_content, p_reason)
    returning id into v_id;
  delete from autofill_note_versions
    where user_id = auth.uid()
      and id not in (
        select id from autofill_note_versions
          where user_id = auth.uid()
          order by created_at desc, id desc
          limit 20
      );
  return v_id;
end $$;

-- Writes the Notes for the caller, inserting the row on the first save. The
-- caller has already locked the row and checked the revision.
create function private.autofill_notes_write(p_exists boolean, p_content text) returns autofill_notes
language plpgsql security invoker set search_path = public as $$
declare
  v_row autofill_notes;
begin
  if p_exists then
    update autofill_notes set content = p_content
      where user_id = auth.uid()
      returning * into v_row;
  else
    insert into autofill_notes(user_id, content)
      values (auth.uid(), p_content)
      on conflict (user_id) do nothing
      returning * into v_row;
    if not found then
      raise exception 'Notes changed' using errcode = 'P0409';
    end if;
  end if;
  return v_row;
end $$;

create function save_autofill_notes(p_content text, p_expected_revision bigint, p_snapshot note_version_reason default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_row     autofill_notes;
  v_version uuid;
begin
  select * into v_row from autofill_notes where user_id = auth.uid() for update;
  if coalesce(v_row.revision, 0) <> p_expected_revision then
    raise exception 'Notes changed' using errcode = 'P0409';
  end if;
  if v_row.user_id is not null and v_row.content = p_content then
    return jsonb_build_object('revision', v_row.revision, 'updated_at', v_row.updated_at, 'version_id', null);
  end if;
  if p_snapshot is not null then
    v_version := private.autofill_note_snapshot(coalesce(v_row.content, ''), p_snapshot);
  end if;
  v_row := private.autofill_notes_write(v_row.user_id is not null, p_content);
  return jsonb_build_object('revision', v_row.revision, 'updated_at', v_row.updated_at, 'version_id', v_version);
end $$;

create function restore_autofill_note_version(p_version_id uuid, p_expected_revision bigint) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_row     autofill_notes;
  v_content text;
begin
  select * into v_row from autofill_notes where user_id = auth.uid() for update;
  if coalesce(v_row.revision, 0) <> p_expected_revision then
    raise exception 'Notes changed' using errcode = 'P0409';
  end if;
  select content into v_content from autofill_note_versions
    where id = p_version_id and user_id = auth.uid();
  if not found then
    raise exception 'Note version not found' using errcode = 'P0002';
  end if;
  perform private.autofill_note_snapshot(coalesce(v_row.content, ''), 'restore');
  v_row := private.autofill_notes_write(v_row.user_id is not null, v_content);
  return jsonb_build_object('revision', v_row.revision, 'updated_at', v_row.updated_at, 'content', v_row.content);
end $$;

revoke all on function
  save_autofill_profile(jsonb, int, bigint),
  save_autofill_notes(text, bigint, note_version_reason),
  restore_autofill_note_version(uuid, bigint),
  private.autofill_note_snapshot(text, note_version_reason),
  private.autofill_notes_write(boolean, text)
from public, anon;
grant execute on function
  save_autofill_profile(jsonb, int, bigint),
  save_autofill_notes(text, bigint, note_version_reason),
  restore_autofill_note_version(uuid, bigint),
  private.autofill_note_snapshot(text, note_version_reason),
  private.autofill_notes_write(boolean, text)
to authenticated;
