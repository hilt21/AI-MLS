import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const file = (path) => readFileSync(join(process.cwd(),path),'utf8');
test('model credentials never use NEXT_PUBLIC env prefix', () => {
  const p=file('lib/recognition.ts');
  assert.match(p,/MODEL_API_KEY/);
  assert.doesNotMatch(p,/NEXT_PUBLIC_MODEL/);
});
test('student read RLS policies are enabled on all primary learning tables',()=>{
 const sql=file('supabase/migrations/001_init.sql');
 for(const table of ['questions','ingestion_jobs','review_states','attempts','question_versions']){
   assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
 }
 assert.match(sql,/storage\.buckets \(id,name,public/);
 assert.match(sql,/mistake-originals','mistake-originals',false/);
});
test('learning feedback is always logged transactionally and deduplicated',()=>{
 const sql=file('supabase/migrations/001_init.sql');
 assert.match(sql,/unique\(owner_id, submission_id\)/);
 assert.match(sql,/for update;/);
 assert.match(sql,/stale review state/);
 assert.match(sql,/insert into public\.attempts/);
 assert.match(sql,/update public\.review_states/);
 assert.match(sql,/grant execute on function public\.commit_student_review/);
});
test('school stages and error contracts are present',()=>{
 const schema=file('lib/contracts.ts');
 assert.match(schema,/primary.*junior/);
 assert.match(schema,/min\(1\)\.max\(9\)/);
 assert.match(schema,/concept.*calculation.*reading.*method.*careless/);
});
test('AI returns draft and UI requires explicit student confirmation',()=>{
 const worker=file('app/api/internal/process-job/route.ts');
 assert.match(worker,/status:'draft'/);
 const editor=file('app/page.tsx');
 assert.match(editor,/确认并加入复习/);
});
