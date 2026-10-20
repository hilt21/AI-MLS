import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { QuestionEditSchema, ReviewInputSchema } from '@/lib/contracts';
import { effectiveRating,nextReview,ALGORITHM_VERSION } from '@/lib/fsrs';
import { recognizeImage } from '@/lib/recognition';
export const dynamic='force-dynamic';
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{'Cache-Control':'no-store'}});
async function handler(req:Request){
 try{
 const user=await getChatGPTUser();const path=new URL(req.url).pathname.replace('/api/','');
 if(path==='auth/me')return json({authenticated:!!user,userId:user?.userId,email:user?.email});
 if(!user)return json({error:'请先登录'},401);
 if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 const expectedAccount=req.headers.get('x-ai-mls-account');if(expectedAccount&&expectedAccount!==user.userId)return json({error:'账号已变化，请刷新后进入当前账号',code:'ACCOUNT_CHANGED'},409);
 const db=env.DB;const bucket=env.BUCKET;if(!db||!bucket)return json({error:"存储服务尚未就绪"},503);const owner=user.userId;const now=new Date().toISOString();
 if(path==='health'&&req.method==='GET'){try{await db.prepare('SELECT 1 AS ready').first();await bucket.list({limit:1});return json({ready:true,checks:{database:true,images:true}})}catch{return json({ready:false},503)}}
 const rows=await db.prepare('SELECT * FROM questions WHERE owner=? ORDER BY created DESC').bind(owner).all<any>();
 const all=rows.results;const reviewable=(q:any)=>q.status==='confirmed'&&JSON.parse(q.data).question_markdown!=='请对照原图填写题目。';const item=(q:any)=>({...JSON.parse(q.data),id:q.id,version:q.version,status:q.status,created_at:q.created});
 if(path==='questions'&&req.method==='GET')return json({questions:all.map(item)});
 if(path==='jobs')return json({jobs:all.slice(0,10).map((q:any)=>{const d=JSON.parse(q.data);return {id:q.id,question_id:q.id,status:d.recognition_status==='failed'?'failed':q.status==='confirmed'?'done':d.question_markdown==='请对照原图填写题目。'?'failed':'done',attempts:1,last_error:d.recognition_notes||null,created_at:q.created}})});
 if(path==='reviews')return json({reviews:all.filter((q:any)=>reviewable(q)&&q.due<=now).map((q:any)=>({question_id:q.id,version:q.version,due_at:q.due,question:item(q)}))});
 if(path==='progress'){const logs=await db.prepare('SELECT data FROM attempts WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner).all<any>();return json({questionCount:all.length,confirmedCount:all.filter(reviewable).length,reviewCount:logs.results.length,independentCount:logs.results.filter((a:any)=>{const d=JSON.parse(a.data);return d.input.selfReportCorrect&&!d.input.usedHint}).length,dueCount:all.filter((q:any)=>reviewable(q)&&q.due<=now).length,rateSource:'self_report'});}
 if(path==='upload'&&req.method==='POST'){
 const f=(await req.formData()).get('photo');if(!(f instanceof File)||!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>6*1024*1024)return json({error:'请选择不超过 6MB 的 JPG、PNG 或 WebP'},400);
 if(all.filter((q:any)=>q.created.slice(0,10)===now.slice(0,10)).length>=20)return json({error:'今日上传已达 20 张'},429);
 const id=crypto.randomUUID(),key=`${owner}/${id}`;const bytes=new Uint8Array(await f.arrayBuffer());
 let draft:any={title:'新错题 · 待整理',question_markdown:'请对照原图填写题目。',solution_markdown:'',correct_answer:'',student_wrong_answer:'',stage:'primary',grade:5,knowledge_points:[],error_type:'unknown',image_required:true,recognition_notes:'模型尚未配置，请手动核对整理。'};
 const initialDraft=JSON.stringify(draft);
 const month=now.slice(0,7);
 const reserved=await db.batch([
 db.prepare('INSERT INTO upload_budget(month,used) VALUES(?,0) ON CONFLICT(month) DO NOTHING').bind(month),
 db.prepare('INSERT INTO questions(id,owner,data,status,image,created) SELECT ?,?,?,?,?,? WHERE (SELECT used FROM upload_budget WHERE month=?)<500 AND (SELECT COUNT(*) FROM questions)<500').bind(id,owner,JSON.stringify(draft),'draft',key,now,month),
 db.prepare('UPDATE upload_budget SET used=used+1 WHERE month=? AND EXISTS(SELECT 1 FROM questions WHERE id=?)').bind(month,id)
 ]);
 if(reserved[1].meta.changes!==1)return json({error:'为保护免费额度，全站最多保留 500 张原图，每月最多尝试上传 500 次。请下月再试或联系管理员。'},429);
 try{await bucket.put(key,bytes,{httpMetadata:{contentType:f.type}})}catch(e){await bucket.delete(key);await db.prepare("DELETE FROM questions WHERE id=? AND owner=? AND status='draft' AND data=?").bind(id,owner,initialDraft).run();throw e}
 draft.recognition_status='unavailable';if(process.env.MODEL_API_KEY){try{draft={...await recognizeImage(bytes,f.type),recognition_status:'ready'}}catch{draft.recognition_status='failed';draft.recognition_notes='识别失败，原图已保留。请在错题库重试识别或手动整理。'}}
 const saved=await db.prepare("UPDATE questions SET data=? WHERE id=? AND owner=? AND status='draft' AND data=?").bind(JSON.stringify(draft),id,owner,initialDraft).run();if(saved.meta.changes!==1){const existing=await db.prepare('SELECT id FROM questions WHERE id=? AND owner=?').bind(id,owner).first();if(!existing){await bucket.delete(key);return json({error:'题目已被删除，请重新上传'},409)}}return json({id,recognitionStatus:draft.recognition_status,recognitionMessage:draft.recognition_notes});}
 const retry=path.match(/^questions\/([^/]+)\/recognize$/);
 if(retry&&req.method==='POST'){
 const q=all.find((q:any)=>q.id===retry[1]);if(!q)return json({error:'题目不存在'},404);
 const previous=JSON.parse(q.data);if(previous.question_markdown!=='请对照原图填写题目。')return json({error:'题目已有文字内容，请先保留并核对，不能覆盖重识别'},409);
 if(!process.env.MODEL_API_KEY)return json({error:'模型尚未配置，原图已保留'},503);
 const month=now.slice(0,7);await db.prepare('INSERT INTO upload_budget(month,used) VALUES(?,0) ON CONFLICT(month) DO NOTHING').bind(month).run();
 const budget=await db.prepare('UPDATE upload_budget SET used=used+1 WHERE month=? AND used<500').bind(month).run();if(budget.meta.changes!==1)return json({error:'本月识别尝试已达 500 次，请下月再试或联系管理员'},429);
 const image=await bucket.get(q.image);if(!image)return json({error:'原图不存在'},404);
 const bytes=new Uint8Array(await new Response(image.body).arrayBuffer());
 let draft:any;try{draft={...await recognizeImage(bytes,image.httpMetadata?.contentType||'image/jpeg'),recognition_status:'ready'}}catch{return json({error:'识别失败，原图与原有内容已保留。请稍后重试或手动整理。'},502)}
 const saved=await db.prepare("UPDATE questions SET data=?,status='draft',due=NULL,version=version+1 WHERE id=? AND owner=? AND version=? AND data=?").bind(JSON.stringify(draft),q.id,owner,q.version,q.data).run();
 if(saved.meta.changes!==1)return json({error:'题目在识别期间已修改或删除，请刷新，原有修改已保留'},409);
 return json({id:q.id,recognitionStatus:'ready'});
 }
 const match=path.match(/^questions\/([^/]+)(\/image)?$/);
 if(match){const q=all.find((q:any)=>q.id===match[1]);if(!q)return json({error:'题目不存在'},404);
 if(match[2]){const image=await bucket.get(q.image);return image?new Response(image.body,{headers:{'Content-Type':image.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):json({error:'图片不存在'},404)}
 if(req.method==='PATCH'){const {expectedVersion,...data}=QuestionEditSchema.parse(await req.json());if(data.question_markdown==='请对照原图填写题目。')return json({error:'题目尚未识别，请重试识别或填写真实题干后再入库'},400);const saved=await db.prepare("UPDATE questions SET data=?,status='confirmed',due=COALESCE(due,?),version=version+1 WHERE id=? AND owner=? AND version=?").bind(JSON.stringify(data),now,q.id,owner,expectedVersion).run();return saved.meta.changes===1?json({ok:true}):json({error:'题目已更新，请重新打开题目核对后保存；当前输入未覆盖云端内容'},409)}
 if(req.method==='DELETE'){await db.batch([db.prepare('DELETE FROM attempts WHERE question=? AND owner=?').bind(q.id,owner),db.prepare('DELETE FROM questions WHERE id=? AND owner=?').bind(q.id,owner)]);if(q.image)await bucket.delete(q.image);return json({ok:true})}}
 if(path==='reviews/submit'&&req.method==='POST'){
 const input=ReviewInputSchema.parse(await req.json());const previous=await db.prepare('SELECT * FROM attempts WHERE id=? AND owner=?').bind(input.submissionId,owner).first<any>();if(previous){if(previous.question!==input.questionId)return json({error:'提交标识冲突'},409);return json({ok:true})}
 const q=all.find((q:any)=>q.id===input.questionId&&reviewable(q));if(!q)return json({error:'题目不存在'},404);
 if(q.version!==input.expectedVersion)return json({error:'题目已更新，请同步后重新作答'},409);
 const next=nextReview(q.card?JSON.parse(q.card):null,effectiveRating(input),new Date(now));
 await db.batch([db.prepare('INSERT INTO attempts(id,owner,question,data,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM questions WHERE id=? AND owner=? AND version=?)').bind(input.submissionId,owner,q.id,JSON.stringify({input,before:q.card,after:next,algorithm:ALGORITHM_VERSION}),now,q.id,owner,q.version),db.prepare('UPDATE questions SET card=?,due=?,version=version+1 WHERE id=? AND owner=? AND version=? AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND owner=?)').bind(JSON.stringify(next.nextCard),next.dueAt,q.id,owner,q.version,input.submissionId,owner)]);
 const saved=await db.prepare('SELECT id FROM attempts WHERE id=? AND owner=?').bind(input.submissionId,owner).first();return saved?json({ok:true}):json({error:'题目已更新，请刷新后重试'},409);}
 return json({error:'接口不存在'},404);
 }catch(e){if(e instanceof Error&&e.name==='ZodError')return json({error:'输入内容格式不正确'},400);console.error('API failure',e instanceof Error?e.name:'unknown');return json({error:'暂时无法完成操作，请稍后重试'},500)}
}
export {handler as GET,handler as POST,handler as PATCH,handler as DELETE};
