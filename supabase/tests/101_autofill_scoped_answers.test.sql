begin;
select plan(12);
insert into auth.users(id,instance_id,aud,role,email) values
 ('b0000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','answers-a@example.test'),
 ('b0000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','answers-b@example.test');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into autofill_scoped_answers(id,user_id,data,revision) values('b0000000-0000-4000-8000-000000000003',auth.uid(),'{}',99)$$,'owner creates a scoped answer');
select is((select revision::int from autofill_scoped_answers),1,'database controls initial revision');
select lives_ok($$update autofill_scoped_answers set data='{"value":"no"}',revision=99 where revision=1$$,'owner updates current revision');
select is((select revision::int from autofill_scoped_answers),2,'database increments revision');
with changed as (update autofill_scoped_answers set data='{}' where revision=1 returning *) select is((select count(*)::int from changed),0,'stale expected revision cannot update');
with changed as (delete from autofill_scoped_answers where revision=1 returning *) select is((select count(*)::int from changed),0,'stale expected revision cannot delete');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from autofill_scoped_answers),0,'other account cannot read answers');
with changed as (update autofill_scoped_answers set data='{}' returning *) select is((select count(*)::int from changed),0,'other account cannot update answers');
select throws_ok($$insert into autofill_scoped_answers(user_id,data) values('b0000000-0000-4000-8000-000000000001','{}')$$,'42501',null,'other account cannot create answers for owner');
set local role anon;
select throws_ok($$select * from autofill_scoped_answers$$,'42501',null,'anonymous reads denied');
select throws_ok($$insert into autofill_scoped_answers(user_id,data) values('b0000000-0000-4000-8000-000000000001','{}')$$,'42501',null,'anonymous writes denied');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
with changed as (delete from autofill_scoped_answers where revision=2 returning *) select is((select count(*)::int from changed),1,'owner deletes current revision');
select * from finish();
rollback;
