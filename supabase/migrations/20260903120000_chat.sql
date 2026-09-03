-- Chat phase: memory consolidation and the rate-limit index.

-- Records a consolidated memory and makes it the conversation's active one.
--
-- Two writes in one function for the same reason as `create_resume_version`:
-- a summary row that exists but is not active would be silently ignored by
-- the next run, and an active pointer at a row that failed to insert is a
-- broken foreign key. `security invoker`, so RLS on both tables still applies
-- and a caller who does not own the conversation is refused at the insert.
create or replace function create_memory_summary(
  p_conversation_id uuid,
  p_summary         jsonb,
  p_summary_text    text,
  p_from_seq        bigint,
  p_to_seq          bigint,
  p_model           text
) returns memory_summaries
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row memory_summaries;
begin
  insert into memory_summaries
    (conversation_id, summary, summary_text, source_from_seq, source_to_seq, model)
  values
    (p_conversation_id, p_summary, p_summary_text, p_from_seq, p_to_seq, p_model)
  returning * into v_row;

  update conversations
     set active_summary_id = v_row.id
   where id = p_conversation_id;
  if not found then
    -- Cannot happen for an owner, since the insert above already passed the
    -- same ownership check. Kept so a future policy change fails loudly.
    raise exception 'conversation % not found', p_conversation_id
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function create_memory_summary(uuid, jsonb, text, bigint, bigint, text) from public;
grant execute on function create_memory_summary(uuid, jsonb, text, bigint, bigint, text) to authenticated;

-- The hourly AI limit is a count of the caller's runs in the last hour. RLS
-- narrows the rows to the caller's resumes; this index narrows them to the
-- hour, so the count does not walk every run the user ever made.
create index agent_runs_created on agent_runs (created_at desc);
