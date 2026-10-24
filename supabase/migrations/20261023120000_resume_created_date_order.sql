create index resumes_user_created_cursor
  on resumes (user_id, created_at desc, id desc)
  where deleted_at is null;
