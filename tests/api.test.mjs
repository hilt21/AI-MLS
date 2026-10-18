import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_empty_lockheed.sql','utf8'));sqlite.exec(readFileSync('drizzle/0001_upload_budget.sql','utf8'));
class Statement{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}async first(){return sqlite.prepare(this.sql).get(...this.args)||null}async run(){const r=sqlite.prepare(this.sql).run(...this.args);return {...r,meta:{changes:Number(r.changes)}}}}
const objects=new Map();globalThis.__testEnv={DB:{prepare:s=>new Statement(s),batch:async list=>{sqlite.exec('BEGIN');try{const r=[];for(const s of list)r.push(await s.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}},BUCKET:{put:async(k,b,o)=>objects.set(k,{body:b,httpMetadata:o.httpMetadata}),get:async k=>objects.get(k),delete:async k=>objects.delete(k)}};
const output=mkdtempSync(tmpdir()+'/aimls-')+'/api.mjs';
await build({entryPoints:['app/api/[...path]/route.ts'],outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated-test-boundaries',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__testEnv':'export async function getChatGPTUser(){return globalThis.__testUser}'}))}}]});
const api=await import(output);let passes=0;async function check(name,fn){await fn();passes++;console.log('PASS',name)}
async function call(path,method='GET',body,origin='https://qa.test'){let headers={origin};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';return api[method](new Request('https://qa.test/api/'+path,{method,headers,body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined}))}
globalThis.__testUser=null;
await check('anonymous access is rejected',async()=>{assert.equal((await call('questions')).status,401);assert.equal((await call('health')).status,401)});
globalThis.__testUser={userId:'student-a',email:'a@example.test'};
await check('cross-origin mutation rejected',async()=>assert.equal((await call('upload','POST',{},'https://evil.test')).status,403));
await check('authenticated health reads dependencies without returning user data',async()=>{
 const bucket=globalThis.__testEnv.BUCKET;bucket.list=async()=>({objects:[]});
 const r=await call('health');assert.equal(r.status,200);assert.deepEqual(await r.json(),{ready:true,checks:{database:true,images:true}});
 bucket.list=async()=>{throw new Error('private storage detail')};const bad=await call('health');assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{ready:false});
 bucket.list=async()=>({objects:[]});
});
const form=new FormData();form.append('photo',new File([new Uint8Array([255,216,255,217])],'test.jpg',{type:'image/jpeg'}));
let id;await check('upload creates durable draft with explicit model unavailable state',async()=>{const r=await call('upload','POST',form);assert.equal(r.status,200);id=(await r.json()).id;assert.equal(objects.size,1);const q=(await (await call('questions')).json()).questions[0];assert.equal(q.status,'draft');assert.match(q.recognition_notes,/模型尚未配置/)});
globalThis.__testUser={userId:'student-b',email:'b@example.test'};
await check('other student cannot list, edit, delete or read image',async()=>{assert.equal((await (await call('questions')).json()).questions.length,0);for(const method of ['GET','PATCH','DELETE'])assert.equal((await call('questions/'+id,method,method==='PATCH'?{}:undefined)).status,404);assert.equal((await call('questions/'+id+'/image')).status,404)});
globalThis.__testUser={userId:'student-a',email:'a@example.test'};
await check('invalid stage/grade rejected',async()=>assert.equal((await call('questions/'+id,'PATCH',{title:'题目',question_markdown:'题干',stage:'junior',grade:2,expectedVersion:0})).status,400));
await check('confirm makes question due',async()=>{assert.equal((await call('questions/'+id,'PATCH',{title:'解方程',question_markdown:'$x+2=5$',correct_answer:'3',stage:'primary',grade:5,expectedVersion:(await (await call('questions')).json()).questions.find(q=>q.id===id).version})).status,200);assert.equal((await (await call('reviews')).json()).reviews.length,1)});
await check('stale review and edit cannot change the newer question',async()=>{
 const seen=(await (await call('questions')).json()).questions[0];
 const edit={title:'新版题目',question_markdown:'$2+2=?$',correct_answer:'4',stage:'primary',grade:5,expectedVersion:seen.version};
 assert.equal((await call('questions/'+id,'PATCH',edit)).status,200);
 const before=await (await call('progress')).json();
 assert.equal((await call('reviews/submit','POST',{questionId:id,expectedVersion:seen.version,submissionId:crypto.randomUUID(),rawAnswer:'3',selfReportCorrect:true,usedHint:false,selfRating:'good'})).status,409);
 assert.equal((await call('questions/'+id,'PATCH',{...edit,title:'过期覆盖'})).status,409);
 assert.equal((await (await call('questions')).json()).questions[0].title,'新版题目');
 assert.equal((await (await call('progress')).json()).reviewCount,before.reviewCount);
});
const submission={expectedVersion:(await (await call('reviews')).json()).reviews[0].version,questionId:id,submissionId:crypto.randomUUID(),rawAnswer:'3',selfReportCorrect:true,usedHint:true,selfRating:'easy'};
await check('hint-assisted success becomes Again with preserved algorithm event',async()=>{assert.equal((await call('reviews/submit','POST',submission)).status,200);const log=JSON.parse(sqlite.prepare('SELECT data FROM attempts').get().data);assert.equal(log.after.log.rating,1);assert.match(log.algorithm,/ts-fsrs/)});
await check('duplicate submission leaves exactly one event and one schedule update',async()=>{const version=sqlite.prepare('SELECT version FROM questions').get().version;assert.equal((await call('reviews/submit','POST',submission)).status,200);assert.equal(sqlite.prepare('SELECT count(*) as n FROM attempts').get().n,1);assert.equal(sqlite.prepare('SELECT version FROM questions').get().version,version)});
await check('missing client versions fail closed; two submissions cannot use one seen version',async()=>{
 const seen=(await (await call('questions')).json()).questions.find(q=>q.id===id);
 const withoutVersion={...submission};delete withoutVersion.expectedVersion;
 assert.equal((await call('reviews/submit','POST',{...withoutVersion,submissionId:crypto.randomUUID()})).status,400);
 assert.equal((await call('questions/'+id,'PATCH',{title:'不能覆盖',question_markdown:'2+2',stage:'primary',grade:5})).status,400);
 const first={...submission,expectedVersion:seen.version,submissionId:crypto.randomUUID()};
 assert.equal((await call('reviews/submit','POST',first)).status,200);
 assert.equal((await call('reviews/submit','POST',{...first,submissionId:crypto.randomUUID()})).status,409);
 assert.equal((await (await call('progress')).json()).reviewCount,2);
});
await check('progress reports self assessment honestly',async()=>{const p=await (await call('progress')).json();assert.equal(p.reviewCount,2);assert.equal(p.independentCount,0);assert.equal(p.rateSource,'self_report')});
await check('delete removes question, review records and private image',async()=>{assert.equal((await call('questions/'+id,'DELETE')).status,200);assert.equal(objects.size,0);assert.equal(sqlite.prepare('SELECT count(*) as n FROM attempts').get().n,0)});

const month=new Date().toISOString().slice(0,7);
await check('monthly upload budget is shared and blocks before R2 or model',async()=>{
 sqlite.prepare('UPDATE upload_budget SET used=500 WHERE month=?').run(month);
 const before=objects.size;
 assert.equal((await call('upload','POST',form)).status,429);
 globalThis.__testUser={userId:'student-b',email:'b@example.test'};
 assert.equal((await call('upload','POST',form)).status,429);
 globalThis.__testUser={userId:'student-a',email:'a@example.test'};
 assert.equal(objects.size,before);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM questions').get().n,0);
});
await check('last monthly slot succeeds and deleting does not refund the budget',async()=>{
 sqlite.prepare('UPDATE upload_budget SET used=499 WHERE month=?').run(month);
 const r=await call('upload','POST',form);assert.equal(r.status,200);const qid=(await r.json()).id;
 assert.equal(sqlite.prepare('SELECT used FROM upload_budget WHERE month=?').get(month).used,500);
 await call('questions/'+qid,'DELETE');
 assert.equal((await call('upload','POST',form)).status,429);
});
await check('global retained image cap blocks across owners',async()=>{
 sqlite.prepare('UPDATE upload_budget SET used=0 WHERE month=?').run(month);
 const insert=sqlite.prepare('INSERT INTO questions(id,owner,data,status,image,created) VALUES(?,?,?,?,?,?)');
 for(let n=0;n<500;n++)insert.run('capacity-'+n,'other-owner','{}','draft','fixture','2020-01-01T00:00:00.000Z');
 assert.equal((await call('upload','POST',form)).status,429);assert.equal(objects.size,0);
 sqlite.prepare("DELETE FROM questions WHERE owner='other-owner'").run();
});
await check('failed R2 write removes reserved question but consumes attempt budget',async()=>{
 const put=globalThis.__testEnv.BUCKET.put;globalThis.__testEnv.BUCKET.put=async()=>{throw new Error('simulated storage failure')};
 try{assert.equal((await call('upload','POST',form)).status,500)}finally{globalThis.__testEnv.BUCKET.put=put}
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM questions').get().n,0);
 assert.equal(sqlite.prepare('SELECT used FROM upload_budget WHERE month=?').get(month).used,1);
 assert.equal(objects.size,0);
});

await check('concurrent edit during upload is preserved with its original image',async()=>{
 sqlite.prepare('UPDATE upload_budget SET used=0 WHERE month=?').run(month);
 const put=globalThis.__testEnv.BUCKET.put;
 globalThis.__testEnv.BUCKET.put=async(k,b,o)=>{await put(k,b,o);const qid=k.slice(k.lastIndexOf('/')+1);assert.equal((await call('questions/'+qid,'PATCH',{title:'保留人工校对',question_markdown:'$x=5$',correct_answer:'5',stage:'primary',grade:5,expectedVersion:(await (await call('questions')).json()).questions.find(q=>q.id===qid).version})).status,200)};
 let r;try{r=await call('upload','POST',form)}finally{globalThis.__testEnv.BUCKET.put=put}
 assert.equal(r.status,200);const qid=(await r.json()).id;const q=sqlite.prepare('SELECT * FROM questions WHERE id=?').get(qid);
 assert.equal(JSON.parse(q.data).title,'保留人工校对');assert.equal(q.status,'confirmed');assert.equal(objects.size,1);
 await call('questions/'+qid,'DELETE');
});

let failedId;const originalFetch=globalThis.fetch;
process.env.MODEL_API_KEY='fixture';process.env.MODEL_BASE_URL='https://api.minimax.cn/v1';process.env.MODEL_NAME='fixture';
let modelData={stage:'invalid'};globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(modelData)}}]});
await check('schema failure is explicit and original image remains retryable',async()=>{
 const r=await call('upload','POST',form);assert.equal(r.status,200);const body=await r.json();failedId=body.id;assert.equal(body.recognitionStatus,'failed');assert.match(body.recognitionMessage,/识别失败/);
 const jobs=(await (await call('jobs')).json()).jobs;assert.equal(jobs.find(j=>j.question_id===failedId).status,'failed');assert.equal((await call('questions/'+failedId+'/image')).status,200);
});
await check('placeholder cannot enter review through confirmation',async()=>{
 assert.equal((await call('questions/'+failedId,'PATCH',{title:'新错题 · 待整理',question_markdown:'请对照原图填写题目。',stage:'primary',grade:5,expectedVersion:(await (await call('questions')).json()).questions.find(q=>q.id===failedId).version})).status,400);
 assert.equal((await (await call('reviews')).json()).reviews.length,0);
});
await check('retry enforces ownership and consumes monthly budget before model',async()=>{
 globalThis.__testUser={userId:'student-b',email:'b@example.test'};assert.equal((await call('questions/'+failedId+'/recognize','POST')).status,404);globalThis.__testUser={userId:'student-a',email:'a@example.test'};
 sqlite.prepare('UPDATE upload_budget SET used=500 WHERE month=?').run(month);assert.equal((await call('questions/'+failedId+'/recognize','POST')).status,429);sqlite.prepare('UPDATE upload_budget SET used=0 WHERE month=?').run(month);
 assert.equal((await call('questions/'+failedId+'/recognize','POST')).status,502);assert.equal(sqlite.prepare('SELECT used FROM upload_budget WHERE month=?').get(month).used,1);
});
await check('retry fills same draft from preserved image without creating duplicates',async()=>{
 modelData={title:'恢复题目',question_markdown:'x+2=5',correct_answer:'3',stage:'primary',grade:5};const before=objects.size;
 assert.equal((await call('questions/'+failedId+'/recognize','POST')).status,200);const q=sqlite.prepare('SELECT * FROM questions WHERE id=?').get(failedId);assert.equal(q.status,'draft');assert.equal(JSON.parse(q.data).title,'恢复题目');assert.equal(objects.size,before);
 assert.equal((await call('questions/'+failedId+'/recognize','POST')).status,409);
 assert.equal((await call('questions/'+failedId,'PATCH',{...modelData,expectedVersion:(await (await call('questions')).json()).questions.find(q=>q.id===failedId).version})).status,200);await call('questions/'+failedId,'DELETE');
});
globalThis.fetch=originalFetch;delete process.env.MODEL_API_KEY;

console.log(`${passes} API tests passed (SQLite database; mocked identity and R2; no live model)`);
