-- Row Level Security is the authorization boundary. Enabled on every table,
-- with no exceptions and no service-role bypass in the request path.
--
-- Ownership on child tables is expressed as a join back to `resumes` or
-- `conversations` rather than a denormalised user_id, so there is exactly one
-- place that says who owns what.
--
-- `conversations` is the exception that proves it: it carries a user_id so
-- that `messages` and `memory_summaries` need only a one-level join. That
-- column does not certify itself. A row naming its own inserter as owner still
-- has to point at a resume that inserter owns, or anyone could take the single
-- `unique (resume_id)` slot on somebody else's resume and lock the owner out
-- of their own conversation for good.
--
-- Soft-deleted resumes (deleted_at is not null) are filtered in queries, not
-- in policies: a deleted resume is still the user's, and hiding it in the
-- policy would break the 30-day hard-delete job.

alter table resumes enable row level security;
create policy resumes_owner on resumes
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table resume_versions enable row level security;
create policy versions_owner on resume_versions
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));

alter table conversations enable row level security;
create policy conversations_owner on conversations
  for all using (user_id = auth.uid()
                 and exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (user_id = auth.uid()
                 and exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));

alter table messages enable row level security;
create policy messages_owner on messages
  for all using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check   (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));

alter table memory_summaries enable row level security;
create policy summaries_owner on memory_summaries
  for all using (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check   (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));

alter table agent_runs enable row level security;
create policy runs_owner on agent_runs
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));

alter table suggestions enable row level security;
create policy suggestions_owner on suggestions
  for all using (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()))
  with check   (exists (select 1 from resumes r where r.id = resume_id and r.user_id = auth.uid()));
