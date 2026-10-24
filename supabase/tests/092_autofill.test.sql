begin;
select plan(31);
insert into auth.users(id) values
('92100000-0000-4000-8000-0000000000a1'),
('92100000-0000-4000-8000-0000000000b2'),
('92100000-0000-4000-8000-0000000000c3');
insert into resumes(id,user_id,title,data) values
('92100000-0000-4000-8000-000000000001','92100000-0000-4000-8000-0000000000a1','Base','{"schemaVersion":1,"basics":{"name":"Ada"},"sections":[]}');
insert into resume_versions(id,resume_id,version_no,content,schema_version,content_hash,created_by) values
('92100000-0000-4000-8000-000000000002','92100000-0000-4000-8000-000000000001',1,'{"schemaVersion":1,"basics":{"name":"Ada"},"sections":[]}',1,'h1','user');
insert into job_targets(id,user_id,raw_text) values
('92100000-0000-4000-8000-000000000003','92100000-0000-4000-8000-0000000000a1','Build payments.');
create temporary table res(step text, payload jsonb);
grant all on res to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"92100000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);

-- Profile
select is(save_autofill_profile('{"personal":{}}', 1, 0) ->> 'revision', '1', 'the first profile save starts at revision 1');
select is(save_autofill_profile('{"personal":{"firstName":"Ada"}}', 1, 1) ->> 'revision', '2', 'a changed profile moves the revision');
select is(save_autofill_profile('{"personal":{"firstName":"Ada"}}', 1, 2) ->> 'revision', '2', 'an identical profile keeps the revision');
select throws_ok($$select save_autofill_profile('{"personal":{}}', 1, 1)$$, 'P0409', null, 'a stale profile revision is refused');

-- Notes
insert into res select 'n1', save_autofill_notes('- a', 0);
select is((select payload ->> 'revision' from res where step = 'n1'), '1', 'the first notes save starts at revision 1');
insert into res select 'n2', save_autofill_notes('- b', 1, 'merge');
select is((select payload ->> 'revision' from res where step = 'n2'), '2', 'a merge moves the revision');
select is((select content || '|' || reason::text from autofill_note_versions where id = (select (payload ->> 'version_id')::uuid from res where step = 'n2')), '- a|merge', 'the merge snapshot holds the text it replaced');
insert into res select 'n3', save_autofill_notes('- a', 2);
insert into res select 'n4', save_autofill_notes('- c', 3, 'merge');
select is((select payload ->> 'version_id' from res where step = 'n4'), (select payload ->> 'version_id' from res where step = 'n2'), 'a snapshot of the same text as the latest one reuses it');
select is((select count(*)::int from autofill_note_versions), 1, 'the reused snapshot adds no row');
insert into res select 'n5', save_autofill_notes('- c', 4, 'merge');
select is((select payload ->> 'version_id' from res where step = 'n5'), null, 'saving identical notes takes no snapshot');
select is((select payload ->> 'revision' from res where step = 'n5'), '4', 'saving identical notes keeps the revision');
select throws_ok($$select save_autofill_notes('- d', 1)$$, 'P0409', null, 'a stale notes revision is refused');

-- The first merge on empty Notes, for a user with no Notes row yet.
select set_config('request.jwt.claims','{"sub":"92100000-0000-4000-8000-0000000000c3","role":"authenticated"}',true);
insert into res select 'c1', save_autofill_notes('- x', 0, 'merge');
select is((select content from autofill_note_versions where id = (select (payload ->> 'version_id')::uuid from res where step = 'c1')), '', 'the first merge on empty Notes stores an empty snapshot');
select set_config('request.jwt.claims','{"sub":"92100000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);

-- Snapshot pruning
do $$
declare r bigint;
begin
  for i in 1..25 loop
    select revision into r from autofill_notes where user_id = auth.uid();
    perform save_autofill_notes('- edit ' || i, r, 'edit');
  end loop;
end $$;
select is((select count(*)::int from autofill_note_versions), 20, '25 edits keep the newest 20 snapshots');
select throws_ok($$select save_autofill_notes(repeat('x', 10001), (select revision from autofill_notes where user_id = auth.uid()))$$, '23514', null, 'notes over 10,000 characters are refused');

-- Restore
insert into res select 'r1', restore_autofill_note_version((select id from autofill_note_versions where content = '- edit 10'), (select revision from autofill_notes where user_id = auth.uid()));
select is((select payload ->> 'content' from res where step = 'r1'), '- edit 10', 'restore returns the restored text');
select is((select content from autofill_notes where user_id = auth.uid()), '- edit 10', 'restore writes the snapshot back');
select is((select content || '|' || reason::text from autofill_note_versions order by created_at desc, id desc limit 1), '- edit 25|restore', 'restore snapshots the text it replaced');
select throws_ok($$select restore_autofill_note_version((select id from autofill_note_versions where content = '- edit 12'), (select revision from autofill_notes where user_id = auth.uid()) - 1)$$, 'P0409', null, 'a stale restore is refused');
select throws_ok($$select restore_autofill_note_version('00000000-0000-4000-8000-000000000000', (select revision from autofill_notes where user_id = auth.uid()))$$, 'P0002', null, 'an unknown snapshot is not found');

-- RLS
insert into autofill_applications(vendor, posting_key, url, company, title, resume_id)
values ('greenhouse', 'stripe/123', 'https://job-boards.greenhouse.io/stripe/jobs/123', 'Stripe', 'Software Engineer', '92100000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"92100000-0000-4000-8000-0000000000b2","role":"authenticated"}',true);
select is((select count(*)::int from autofill_profiles), 0, 'another user sees no profile');
select is((select count(*)::int from autofill_notes), 0, 'another user sees no notes');
select is((select count(*)::int from autofill_note_versions), 0, 'another user sees no snapshots');
select is((select count(*)::int from autofill_applications), 0, 'another user sees no applications');
select is_empty($$update autofill_notes set content = 'x' returning 1$$, 'another user cannot change notes');
select throws_ok($$insert into autofill_applications(vendor, posting_key, url, resume_id) values ('greenhouse', 'a/1', 'https://x.test', '92100000-0000-4000-8000-000000000001')$$, '42501', null, 'an application cannot point at another user''s resume');
select throws_ok($$insert into autofill_applications(vendor, posting_key, url, resume_version_id) values ('greenhouse', 'a/2', 'https://x.test', '92100000-0000-4000-8000-000000000002')$$, '42501', null, 'an application cannot point at another user''s resume version');
select throws_ok($$insert into autofill_applications(vendor, posting_key, url, job_target_id) values ('greenhouse', 'a/3', 'https://x.test', '92100000-0000-4000-8000-000000000003')$$, '42501', null, 'an application cannot point at another user''s job target');

-- The revision is the concurrency token, so only the triggers may set it.
insert into autofill_profiles(data, schema_version, revision) values ('{}', 1, 99);
update autofill_profiles set revision = 99;
select is((select revision from autofill_profiles), 1::bigint, 'a client cannot set the profile revision');
insert into autofill_notes(content, revision) values ('- y', 99);
update autofill_notes set revision = 99;
select is((select revision from autofill_notes), 1::bigint, 'a client cannot set the notes revision');

-- Applications
select set_config('request.jwt.claims','{"sub":"92100000-0000-4000-8000-0000000000a1","role":"authenticated"}',true);
select throws_ok($$insert into autofill_applications(vendor, posting_key, url) values ('greenhouse', 'stripe/123', 'https://job-boards.greenhouse.io/stripe/jobs/123')$$, '23505', null, 'one application row per posting');
reset role;
select * from finish();
rollback;
