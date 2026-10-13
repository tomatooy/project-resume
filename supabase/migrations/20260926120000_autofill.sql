create table public.autofill_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.autofill_profiles enable row level security;
create policy autofill_profile_owner on public.autofill_profiles for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.autofill_profiles from public, anon, authenticated, service_role;
grant select, insert, update on public.autofill_profiles to authenticated;

create function public.autofill_profile_revision() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := now();
  else
    if new.user_id <> old.user_id then raise exception 'Owner cannot change' using errcode = '42501'; end if;
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger autofill_profile_revision before insert or update on public.autofill_profiles for each row execute function public.autofill_profile_revision();
revoke all on function public.autofill_profile_revision() from public, anon, service_role;

create table public.autofill_quota_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan', 'jev')),
  created_at timestamptz not null default clock_timestamp()
);
create index autofill_quota_window on public.autofill_quota_events(user_id, kind, created_at);
alter table public.autofill_quota_events enable row level security;
create policy autofill_quota_owner on public.autofill_quota_events for select to authenticated using (user_id = auth.uid());
revoke all on public.autofill_quota_events from public, anon, authenticated, service_role;

-- Only this bounded operation can alter quota counters.
create function public.autofill_reserve_quota(p_kind text) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  cutoff timestamptz;
  ceiling integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_kind not in ('plan', 'jev') then raise exception 'Invalid quota' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 926));
  cutoff := clock_timestamp() - case when p_kind = 'plan' then interval '1 minute' else interval '1 hour' end;
  ceiling := case when p_kind = 'plan' then 20 else 120 end;
  delete from public.autofill_quota_events where user_id = actor and created_at < clock_timestamp() - interval '1 hour';
  if (select count(*) from public.autofill_quota_events where user_id = actor and kind = p_kind and created_at > cutoff) >= ceiling then return false; end if;
  insert into public.autofill_quota_events(user_id, kind) values (actor, p_kind);
  return true;
end;
$$;
revoke all on function public.autofill_reserve_quota(text) from public, anon, service_role;
grant execute on function public.autofill_reserve_quota(text) to authenticated;
