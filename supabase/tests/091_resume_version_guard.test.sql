begin;
select plan(3);
insert into auth.users(id) values ('91100000-0000-4000-8000-0000000000f1');
insert into resumes(id,user_id,title,data) values
('91100000-0000-4000-8000-000000000001','91100000-0000-4000-8000-0000000000f1','Base','{"schemaVersion":1,"basics":{"name":"Ada"},"sections":[]}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"91100000-0000-4000-8000-0000000000f1","role":"authenticated"}',true);
select lives_ok($$select create_resume_version('91100000-0000-4000-8000-000000000001', '{"schemaVersion":1,"basics":{"name":"A"},"sections":[]}', 1, 'h1', 'Saved version', 'user', null, true, 1)$$, 'the current revision passes');
select throws_ok($$select create_resume_version('91100000-0000-4000-8000-000000000001', '{"schemaVersion":1,"basics":{"name":"B"},"sections":[]}', 1, 'h2', 'Saved version', 'user', null, true, 0)$$, 'P0409', null, 'a stale revision is refused');
select lives_ok($$select create_resume_version('91100000-0000-4000-8000-000000000001', '{"schemaVersion":1,"basics":{"name":"C"},"sections":[]}', 1, 'h3')$$, 'no revision keeps the old behavior');
reset role;
select * from finish();
rollback;
