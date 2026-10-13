create table public.autofill_scoped_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index autofill_scoped_answers_owner on public.autofill_scoped_answers(user_id, updated_at desc);
alter table public.autofill_scoped_answers enable row level security;
create policy autofill_scoped_answer_owner on public.autofill_scoped_answers
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.autofill_scoped_answers from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.autofill_scoped_answers to authenticated;

create function public.autofill_scoped_answer_revision() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.id <> old.id or new.user_id <> old.user_id then
      raise exception 'Answer identity cannot change' using errcode = '42501';
    end if;
    new.revision := old.revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger autofill_scoped_answer_revision before insert or update
  on public.autofill_scoped_answers for each row
  execute function public.autofill_scoped_answer_revision();
revoke all on function public.autofill_scoped_answer_revision() from public, anon, service_role;
