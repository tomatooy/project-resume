"""Local-only contention checks; fixtures are removed even when an assertion fails."""
import concurrent.futures
import json
import os
import subprocess
import uuid

container = os.environ.get("SUPABASE_DB_CONTAINER", "supabase_db_project-resume")
user_id, resume_id, request_id = (str(uuid.uuid4()) for _ in range(3))


def sql(statement):
    return subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
        input=statement, text=True, capture_output=True, check=False,
    )


def owned(statement):
    return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{user_id}',true); {statement}; commit;")


try:
    setup = sql(f"""
    insert into auth.users(id) values('{user_id}');
    insert into resumes(id,user_id,title,data) values('{resume_id}','{user_id}','Concurrency fixture','{{"schemaVersion":1,"basics":{{"name":"Test"}},"sections":[]}}');
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','{user_id}',true);
    select tailor_admit(jsonb_build_object('platform','linkedin','externalJobId','888889','sourceResumeId','{resume_id}','sourceUrl','https://www.linkedin.com/jobs/view/888889','jobText',repeat('Description ',30),'idempotencyKey','{request_id}','expectedRevision',1,'document','{{"schemaVersion":1,"basics":{{"name":"Test"}},"sections":[]}}'::jsonb,'contentHash','test'));
    commit;
    """)
    if setup.returncode:
        raise RuntimeError(setup.stderr)
    operation = json.loads(setup.stdout.strip().splitlines()[-1])
    op_id = operation["id"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        leases = list(pool.map(lambda _: owned(f"select case when claim_tailor_dispatch('{op_id}') is null then 0 else 1 end"), range(50)))
    assert all(result.returncode == 0 for result in leases), "lease requests failed"
    assert sum(int(result.stdout.strip().splitlines()[-1]) for result in leases) == 1, "multiple dispatch leases granted"
    print("PASS: 50 concurrent dispatch requests grant exactly one lease")

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        reads = list(pool.map(lambda _: owned("select lookup_tailor_job('linkedin','888889')->'operation'->>'id'"), range(50)))
    assert all(result.returncode == 0 and result.stdout.strip().splitlines()[-1] == op_id for result in reads), "lookup mismatch"
    print("PASS: 50 concurrent lookups return the same saved operation")

    insert = f"insert into agent_runs(conversation_id,resume_id,hint_skill_id,model,status) select c.id,c.resume_id,'quota-test','stub','completed' from conversations c where c.resume_id='{operation['resume_id']}' returning 1"
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        admissions = list(pool.map(lambda _: owned(insert), range(70)))
    admitted = sum(result.returncode == 0 for result in admissions)
    rejected = [result for result in admissions if result.returncode != 0]
    assert admitted == 59, f"expected 59 available slots, got {admitted}"
    assert all("P0429" in result.stderr for result in rejected), "unexpected admission failure"
    print("PASS: 70 concurrent admissions fill 59 remaining slots and reject 11 at quota")
finally:
    cleanup = sql(f"delete from auth.users where id='{user_id}';")
    if cleanup.returncode:
        raise RuntimeError("Fixture cleanup failed: " + cleanup.stderr)
