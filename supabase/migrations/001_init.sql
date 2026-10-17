-- China-mainland student MVP. Apply with Supabase SQL editor or migration tooling.
-- Never run this migration on a database that contains unrelated user data.
create extension if not exists pgcrypto;

create table if not exists public.student_consents (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  guardian_consent_record_id text not null,
  verified_by text not null,
  verified_at timestamptz not null,
  processing_rules_version text not null,
  created_at timestamptz not null default now()
);
-- Consent is administrative metadata and is not exposed to students.
alter table public.student_consents enable row level security;
revoke all on public.student_consents from anon, authenticated;

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  source_path text not null,
  title text not null default '待识别题目',
  question_markdown text not null default '',
  solution_markdown text not null default '',
  correct_answer text not null default '',
  student_wrong_answer text not null default '',
  stage text not null default 'primary' check (stage in ('primary','junior')),
  grade integer not null default 4 check (grade between 1 and 9),
  knowledge_points jsonb not null default '[]'::jsonb,
  error_type text not null default 'unknown' check (error_type in ('unknown','concept','calculation','reading','method','careless')),
  image_required boolean not null default false,
  recognition_notes text not null default '',
  status text not null default 'draft' check (status in ('draft','confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Immutable question revisions: keep source-level evidence for debugging and content corrections.
create table if not exists public.question_versions (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  revision integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(question_id, revision)
);
alter table public.question_versions enable row level security;
create policy "student own question versions" on public.question_versions for select to authenticated
  using (owner_id = (select auth.uid()));
create or replace function public.snapshot_question()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.question_versions(owner_id,question_id,revision,snapshot)
  values(NEW.owner_id,NEW.id,(select coalesce(max(revision),0)+1 from public.question_versions where question_id=NEW.id),to_jsonb(NEW));
  return NEW;
end $$;
create trigger question_snapshot after insert or update on public.questions
for each row execute function public.snapshot_question();

create index if not exists questions_user_recent on public.questions(owner_id, created_at desc);
alter table public.questions enable row level security;
create policy "student questions select" on public.questions for select to authenticated using (owner_id = (select auth.uid()));

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  question_id uuid not null unique references public.questions(id) on delete cascade,
  source_path text not null,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  attempts integer not null default 0,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_created on public.ingestion_jobs(status, created_at);
alter table public.ingestion_jobs enable row level security;
create policy "student job view" on public.ingestion_jobs for select to authenticated using (owner_id = (select auth.uid()));
-- Students cannot mutate processing state directly; only authenticated server-side routes use service key.

create table if not exists public.review_states (
  question_id uuid primary key references public.questions(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  fsrs_card jsonb not null default '{}'::jsonb,
  due_at timestamptz not null default now(),
  version integer not null default 0,
  algorithm_version text not null default 'ts-fsrs@5.4.2:retention0.90',
  updated_at timestamptz not null default now()
);
create index if not exists reviews_owner_due on public.review_states(owner_id,due_at);
alter table public.review_states enable row level security;
create policy "student review state view" on public.review_states for select to authenticated using (owner_id = (select auth.uid()));

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  submission_id uuid not null,
  raw_answer text not null default '',
  self_report_correct boolean not null,
  used_hint boolean not null,
  self_rating text not null check(self_rating in ('again','hard','good','easy')),
  applied_rating smallint not null check(applied_rating between 1 and 4),
  evidence_type text not null default 'self_report' check (evidence_type = 'self_report'),
  algorithm_version text not null,
  previous_card jsonb not null,
  next_card jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_id, submission_id)
);
create index if not exists attempts_owner_time on public.attempts(owner_id, created_at desc);
alter table public.attempts enable row level security;
create policy "student attempt history" on public.attempts for select to authenticated using (owner_id = (select auth.uid()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('mistake-originals','mistake-originals',false,6291456,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=6291456, allowed_mime_types=excluded.allowed_mime_types;
create policy "student read own image" on storage.objects for select to authenticated
using (bucket_id='mistake-originals' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Atomic server-only job claim. Invoked using the backend service credential.
create or replace function public.claim_ingestion_job()
returns table(id uuid, owner_id uuid, question_id uuid, source_path text, attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  -- A worker can crash on its final claim; eventually mark exhausted leases failed.
  update public.ingestion_jobs j
  set status='failed', last_error='Worker timed out after three attempts', locked_at=null, updated_at=now()
  where j.status='processing' and j.attempts >= 3 and j.locked_at < now()-interval '10 minutes';
  return query
  with candidate as (
    select j.id from public.ingestion_jobs j
    where (j.status='queued' or (j.status='processing' and j.locked_at < now() - interval '10 minutes'))
      and j.attempts < 3
    order by j.created_at
    for update skip locked limit 1
  ), updated as (
    update public.ingestion_jobs j
    set status='processing', locked_at=now(), attempts=j.attempts+1, updated_at=now()
    from candidate c where j.id=c.id
    returning j.id, j.owner_id, j.question_id, j.source_path, j.attempts
  )
  select u.id,u.owner_id,u.question_id,u.source_path,u.attempts from updated u;
end $$;
revoke all on function public.claim_ingestion_job() from public, anon, authenticated;
grant execute on function public.claim_ingestion_job() to service_role;

-- A transactionally idempotent commit; the API computes the FSRS card with ts-fsrs.
create or replace function public.commit_student_review(
  p_owner_id uuid, p_question_id uuid, p_submission_id uuid, p_expected_version integer,
  p_raw_answer text, p_self_report_correct boolean, p_used_hint boolean,
  p_self_rating text, p_applied_rating smallint, p_next_card jsonb,
  p_due_at timestamptz, p_algorithm_version text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.review_states%rowtype;
begin
  if not exists(select 1 from public.questions where id=p_question_id and owner_id=p_owner_id and status='confirmed') then
    raise exception 'question not found or not confirmed';
  end if;
  select * into previous from public.review_states
    where owner_id=p_owner_id and question_id=p_question_id for update;
  if not found then raise exception 'review state missing'; end if;
  if exists (select 1 from public.attempts where owner_id=p_owner_id and submission_id=p_submission_id) then
    return jsonb_build_object('ok',true,'duplicate',true,'due_at',previous.due_at,'version',previous.version);
  end if;
  if previous.version <> p_expected_version then
    raise exception 'stale review state';
  end if;
  if length(coalesce(p_raw_answer,'')) > 5000 or p_self_rating not in ('again','hard','good','easy') or p_applied_rating not between 1 and 4 then
    raise exception 'invalid review input';
  end if;
  insert into public.attempts(owner_id,question_id,submission_id,raw_answer,self_report_correct,used_hint,self_rating,applied_rating,algorithm_version,previous_card,next_card)
  values(p_owner_id,p_question_id,p_submission_id,p_raw_answer,p_self_report_correct,p_used_hint,p_self_rating,p_applied_rating,p_algorithm_version,previous.fsrs_card,p_next_card);
  update public.review_states
  set fsrs_card=p_next_card, due_at=p_due_at, version=version+1,
      algorithm_version=p_algorithm_version, updated_at=now()
  where question_id=p_question_id;
  return jsonb_build_object('ok',true,'duplicate',false,'due_at',p_due_at,'version',previous.version+1);
end $$;
revoke all on function public.commit_student_review(uuid,uuid,uuid,integer,text,boolean,boolean,text,smallint,jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function public.commit_student_review(uuid,uuid,uuid,integer,text,boolean,boolean,text,smallint,jsonb,timestamptz,text) to service_role;
