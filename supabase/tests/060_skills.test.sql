begin;
select plan(5);

select col_not_null('public', 'user_skills', 'description', 'skills require a description');
select col_is_null('public', 'user_skills', 'when_to_use', 'usage guidance is optional');

insert into auth.users (id, instance_id, aud, role, email) values
  ('99999999-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'skill-shape@example.test');

select lives_ok(
  $$ insert into user_skills (id, user_id, name, description, body)
     values ('usr_shape', '99999999-0000-4000-8000-000000000001', 'Terse', 'Shorten prose.', 'Use short sentences.') $$,
  'a standard skill saves without usage guidance');
select is((select description from user_skills where id = 'usr_shape'),
          'Shorten prose.', 'the description is stored separately');
select throws_ok(
  $$ insert into user_skills (user_id, name, body)
     values ('99999999-0000-4000-8000-000000000001', 'Missing description', 'Body.') $$,
  '23502', null, 'a description is required when storing a skill');

select * from finish();
rollback;
