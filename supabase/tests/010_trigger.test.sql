-- The revision trigger on `resumes`.
--
-- pg_prove wraps each file in a single transaction, and `now()` is the
-- transaction timestamp, so `updated_at` cannot be observed moving between two
-- statements here. The row is therefore inserted with an `updated_at` an hour
-- in the past, and each assertion checks the trigger stamped it back to
-- `now()`. Movement across real transactions is covered by the same four
-- properties in supabase/tests/README.md.

begin;
select plan(7);

set local role postgres;

insert into auth.users (id, instance_id, aud, role, email)
values ('11111111-1111-4111-8111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'trigger@example.test');

insert into resumes (id, user_id, title, data, updated_at)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'CV',
        '{"schemaVersion":1,"basics":{"id":"basics","name":"Ada","links":[]},"sections":[]}',
        now() - interval '1 hour');

-- A rename must not move the concurrency token, or every autosave after a
-- rename would be a conflict the user never caused. This is drift #1.
update resumes set title = 'Renamed'
 where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select revision from resumes where id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'rename leaves revision alone'
);
select is(
  (select updated_at from resumes where id = '22222222-2222-4222-8222-222222222222'),
  now(),
  'rename stamps updated_at'
);

update resumes set data = '{"schemaVersion":1,"basics":{"id":"basics","name":"Grace","links":[]},"sections":[]}'
 where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select revision from resumes where id = '22222222-2222-4222-8222-222222222222'),
  2::bigint,
  'a data write bumps revision'
);
select is(
  (select updated_at from resumes where id = '22222222-2222-4222-8222-222222222222'),
  now(),
  'a data write stamps updated_at'
);

-- PostgREST would happily pass a client-supplied revision through. The trigger
-- is what makes that harmless.
update resumes set revision = 9999, title = 'Forged'
 where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select revision from resumes where id = '22222222-2222-4222-8222-222222222222'),
  2::bigint,
  'a client-supplied revision is ignored on a metadata write'
);

update resumes
   set revision = 9999,
       data = '{"schemaVersion":1,"basics":{"id":"basics","name":"Alan","links":[]},"sections":[]}'
 where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select revision from resumes where id = '22222222-2222-4222-8222-222222222222'),
  3::bigint,
  'a client-supplied revision is ignored on a data write too'
);

-- Autosave can re-send an identical document. That must not invalidate the
-- token the client is holding.
update resumes set data = (select data from resumes where id = '22222222-2222-4222-8222-222222222222')
 where id = '22222222-2222-4222-8222-222222222222';

select is(
  (select revision from resumes where id = '22222222-2222-4222-8222-222222222222'),
  3::bigint,
  'writing identical data leaves revision alone'
);

select * from finish();
rollback;
