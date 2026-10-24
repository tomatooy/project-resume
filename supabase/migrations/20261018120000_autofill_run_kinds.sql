-- Autofill calls are AI runs with their own hourly quota. They belong to no
-- conversation, so `conversation_id` is required only for chat runs.
create type run_kind as enum ('chat', 'autofill');

alter table agent_runs add column kind run_kind not null default 'chat';
alter table agent_runs alter column conversation_id drop not null;
alter table agent_runs add constraint agent_runs_conversation_kind
  check (kind = 'autofill' or conversation_id is not null);

-- Each kind has its own 60 per hour. One admission lock per user still
-- serializes every insert, so two tabs cannot both take the last unit.
create or replace function reserve_agent_quota() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,241));
  if (select count(*) from agent_runs a join resumes r on r.id=a.resume_id where r.user_id=auth.uid() and a.kind=new.kind and a.created_at > now()-interval '1 hour') >= 60 then
    raise exception 'Hourly AI limit' using errcode='P0429';
  end if;
  return new;
end $$;

drop function agent_usage_since(timestamptz);
create function agent_usage_since(p_since timestamptz, p_kind run_kind default 'chat') returns jsonb
language sql stable security invoker set search_path=public as $$
  select jsonb_build_object('count',count(*),'oldest',min(a.created_at))
  from agent_runs a join resumes r on r.id=a.resume_id
  where r.user_id=auth.uid() and a.kind=p_kind and a.created_at >= p_since;
$$;
revoke all on function agent_usage_since(timestamptz, run_kind) from public, anon;
grant execute on function agent_usage_since(timestamptz, run_kind) to authenticated;
