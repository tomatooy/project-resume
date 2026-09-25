-- A binding pointer must name this binding's own attempt, even for direct RLS writes.
create function check_tailor_binding_pointer() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.current_operation_id is not null and not exists(
    select 1 from tailor_operations o where o.id=new.current_operation_id
      and o.binding_id=new.id and o.user_id=new.user_id
      and o.resume_id=new.resume_id and o.job_target_id=new.job_target_id
  ) then raise exception 'Invalid attempt link' using errcode='23503'; end if;
  return new;
end $$;
create constraint trigger tailor_binding_pointer after insert or update on job_resume_bindings
  deferrable initially deferred for each row execute function check_tailor_binding_pointer();
revoke all on function check_tailor_binding_pointer() from public,anon;
