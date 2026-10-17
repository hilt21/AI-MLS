import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('drizzle/0000_empty_lockheed.sql','utf8'));
class Statement{constructor(sql){this.sql=sql;this.args=[]}bind(...args){this.args=args;return this}async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}async first(){return sqlite.prepare(this.sql).get(...this.args)||null}async run(){return sqlite.prepare(this.sql).run(...this.args)}}
const objects=new Map();globalThis.__testEnv={DB:{prepare:s=>new Statement(s),batch:async list=>{sqlite.exec('BEGIN');try{const r=[];for(const s of list)r.push(await s.run());sqlite.exec('COMMIT');return r}catch(e){sqlite.exec('ROLLBACK');throw e}}},BUCKET:{put:async(k,b,o)=>objects.set(k,{body:b,httpMetadata:o.httpMetadata}),get:async k=>objects.get(k),delete:async k=>objects.delete(k)}};
const output=mkdtempSync(tmpdir()+'/aimls-')+'/api.mjs';
await build({entryPoints:['app/api/[...path]/route.ts'],outfile:output,bundle:true,platform:'node',format:'esm',plugins:[{name:'isolated-test-boundaries',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__testEnv':'export async function getChatGPTUser(){return globalThis.__testUser}'}))}}]});
const api=await import(output);let passes=0;async function check(name,fn){await fn();passes++;console.log('PASS',name)}
async function call(path,method='GET',body,origin='https://qa.test'){let headers={origin};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';return api[method](new Request('https://qa.test/api/'+path,{method,headers,body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined}))}
globalThis.__testUser=null;
await check('anonymous access is rejected',async()=>assert.equal((await call('questions')).status,401));
globalThis.__testUser={userId:'student-a',email:'a@example.test'};
await check('cross-origin mutation rejected',async()=>assert.equal((await call('upload','POST',{},'https://evil.test')).status,403));
const form=new FormData();form.append('photo',new File([new Uint8Array([255,216,255,217])],'test.jpg',{type:'image/jpeg'}));
let id;await check('upload creates durable draft with explicit model unavailable state',async()=>{const r=await call('upload','POST',form);assert.equal(r.status,200);id=(await r.json()).id;assert.equal(objects.size,1);const q=(await (await call('questions')).json()).questions[0];assert.equal(q.status,'draft');assert.match(q.recognition_notes,/模型尚未配置/)});
globalThis.__testUser={userId:'student-b',email:'b@example.test'};
await check('other student cannot list, edit, delete or read image',async()=>{assert.equal((await (await call('questions')).json()).questions.length,0);for(const method of ['GET','PATCH','DELETE'])assert.equal((await call('questions/'+id,method,method==='PATCH'?{}:undefined)).status,404);assert.equal((await call('questions/'+id+'/image')).status,404)});
globalThis.__testUser={userId:'student-a',email:'a@example.test'};
await check('invalid stage/grade rejected',async()=>assert.equal((await call('questions/'+id,'PATCH',{title:'题目',question_markdown:'题干',stage:'junior',grade:2})).status,400));
await check('confirm makes question due',async()=>{assert.equal((await call('questions/'+id,'PATCH',{title:'解方程',question_markdown:'$x+2=5$',correct_answer:'3',stage:'primary',grade:5})).status,200);assert.equal((await (await call('reviews')).json()).reviews.length,1)});
const submission={questionId:id,submissionId:crypto.randomUUID(),rawAnswer:'3',selfReportCorrect:true,usedHint:true,selfRating:'easy'};
await check('hint-assisted success becomes Again with preserved algorithm event',async()=>{assert.equal((await call('reviews/submit','POST',submission)).status,200);const log=JSON.parse(sqlite.prepare('SELECT data FROM attempts').get().data);assert.equal(log.after.log.rating,1);assert.match(log.algorithm,/ts-fsrs/)});
await check('duplicate submission leaves exactly one event and one schedule update',async()=>{const version=sqlite.prepare('SELECT version FROM questions').get().version;assert.equal((await call('reviews/submit','POST',submission)).status,200);assert.equal(sqlite.prepare('SELECT count(*) as n FROM attempts').get().n,1);assert.equal(sqlite.prepare('SELECT version FROM questions').get().version,version)});
await check('progress reports self assessment honestly',async()=>{const p=await (await call('progress')).json();assert.equal(p.reviewCount,1);assert.equal(p.independentCount,0);assert.equal(p.rateSource,'self_report')});
await check('delete removes question, review records and private image',async()=>{assert.equal((await call('questions/'+id,'DELETE')).status,200);assert.equal(objects.size,0);assert.equal(sqlite.prepare('SELECT count(*) as n FROM attempts').get().n,0)});
console.log(`${passes} API tests passed (SQLite database; mocked identity and R2; no live model)`);
