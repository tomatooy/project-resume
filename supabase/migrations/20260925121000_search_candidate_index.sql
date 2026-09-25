create schema if not exists private;
grant usage on schema private to authenticated;
create index resumes_search_unicode on resumes(user_id,updated_at desc,id desc) where deleted_at is null and search_unicode;

-- LIKE cannot use a trigram index across an RLS security barrier. This helper
-- returns only caller-owned candidate IDs; document reads still enforce RLS.
create function private.resume_search_ids(p_tokens text[],p_phase text,p_before_at timestamptz,p_before_id uuid)
returns table(id uuid,updated_at timestamptz)
language plpgsql stable security definer set search_path=pg_catalog,public,extensions as $$
declare needle text; patterns text[]; owner_id uuid := auth.uid();
begin
  if owner_id is null then return; end if;
  if p_phase not in ('title','body') then raise exception 'Invalid search phase' using errcode='22023'; end if;
  select token into needle from unnest(p_tokens) token where token ~ '^[a-z0-9]{3,}$' order by length(token) desc limit 1;
  if not exists(select 1 from unnest(p_tokens) token where token !~ '^[a-z0-9]{3,}$') then
    select array_agg('%' || token || '%') into patterns from unnest(p_tokens) token;
  end if;
  if (p_phase='title' and patterns is null) or (p_phase='body' and needle is null) then
    return query select r.id,r.updated_at from public.resumes r
    where r.user_id=owner_id and r.deleted_at is null
      and (p_before_at is null or (r.updated_at,r.id)<(p_before_at,p_before_id))
    order by r.updated_at desc,r.id desc limit 51;
  elsif p_phase='title' then
    return query select c.id,c.updated_at from (
      select r.id,r.updated_at from public.resumes r where r.user_id=owner_id and r.deleted_at is null and lower(r.title collate "C") like any(patterns)
      union
      select r.id,r.updated_at from public.resumes r where r.user_id=owner_id and r.deleted_at is null and octet_length(r.title)<>char_length(r.title)
    ) c where p_before_at is null or (c.updated_at,c.id)<(p_before_at,p_before_id)
    order by c.updated_at desc,c.id desc limit 51;
  else
    return query select c.id,c.updated_at from (
      select r.id,r.updated_at from public.resumes r where r.user_id=owner_id and r.deleted_at is null and r.search_text like '%' || needle || '%'
      union
      select r.id,r.updated_at from public.resumes r where r.user_id=owner_id and r.deleted_at is null and r.search_unicode
    ) c where p_before_at is null or (c.updated_at,c.id)<(p_before_at,p_before_id)
    order by c.updated_at desc,c.id desc limit 51;
  end if;
end $$;
revoke all on function private.resume_search_ids(text[],text,timestamptz,uuid) from public,anon;
grant execute on function private.resume_search_ids(text[],text,timestamptz,uuid) to authenticated;

create or replace function resume_search_candidates(p_tokens text[],p_phase text,p_before_at timestamptz default null,p_before_id uuid default null)
returns setof resumes language sql stable security invoker set search_path=pg_catalog,public as $$
  select r.* from private.resume_search_ids(p_tokens,p_phase,p_before_at,p_before_id) c
  join public.resumes r on r.id=c.id
  where r.user_id=auth.uid() and r.deleted_at is null
  order by r.updated_at desc,r.id desc;
$$;
