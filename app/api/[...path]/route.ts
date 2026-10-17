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
 if(path==='auth/me')return json({authenticated:!!user});
 if(!user)return json({error:'请先登录'},401);
 if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'请求来源无效'},403);
 const db=env.DB;const bucket=env.BUCKET;if(!db||!bucket)return json({error:"存储服务尚未就绪"},503);const owner=user.userId;const now=new Date().toISOString();
 const rows=await db.prepare('SELECT * FROM questions WHERE owner=? ORDER BY created DESC').bind(owner).all<any>();
 const all=rows.results;const item=(q:any)=>({...JSON.parse(q.data),id:q.id,status:q.status,created_at:q.created});
 if(path==='questions'&&req.method==='GET')return json({questions:all.map(item)});
 if(path==='jobs')return json({jobs:[]});
 if(path==='reviews')return json({reviews:all.filter((q:any)=>q.status==='confirmed'&&q.due<=now).map((q:any)=>({question_id:q.id,version:q.version,due_at:q.due,question:item(q)}))});
 if(path==='progress'){const logs=await db.prepare('SELECT data FROM attempts WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner).all<any>();return json({questionCount:all.length,confirmedCount:all.filter((q:any)=>q.status==='confirmed').length,reviewCount:logs.results.length,independentCount:logs.results.filter((a:any)=>{const d=JSON.parse(a.data);return d.input.selfReportCorrect&&!d.input.usedHint}).length,dueCount:all.filter((q:any)=>q.status==='confirmed'&&q.due<=now).length,rateSource:'self_report'});}
 if(path==='upload'&&req.method==='POST'){
 const f=(await req.formData()).get('photo');if(!(f instanceof File)||!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>6*1024*1024)return json({error:'请选择不超过 6MB 的 JPG、PNG 或 WebP'},400);
 if(all.filter((q:any)=>q.created.slice(0,10)===now.slice(0,10)).length>=20)return json({error:'今日上传已达 20 张'},429);
 const id=crypto.randomUUID(),key=`${owner}/${id}`;const bytes=new Uint8Array(await f.arrayBuffer());
 let draft:any={title:'新错题 · 待整理',question_markdown:'请对照原图填写题目。',solution_markdown:'',correct_answer:'',student_wrong_answer:'',stage:'primary',grade:5,knowledge_points:[],error_type:'unknown',image_required:true,recognition_notes:'模型尚未配置，请手动核对整理。'};
 if(process.env.MODEL_API_KEY){try{draft=await recognizeImage(bytes,f.type)}catch{draft.recognition_notes='识别失败，原图已保留，请手动整理或重新上传。'}}
 await bucket.put(key,bytes,{httpMetadata:{contentType:f.type}});
 try{await db.prepare('INSERT INTO questions(id,owner,data,status,image,created) VALUES(?,?,?,?,?,?)').bind(id,owner,JSON.stringify(draft),'draft',key,now).run()}catch(e){await bucket.delete(key);throw e}return json({id});}
 const match=path.match(/^questions\/([^/]+)(\/image)?$/);
 if(match){const q=all.find((q:any)=>q.id===match[1]);if(!q)return json({error:'题目不存在'},404);
 if(match[2]){const image=await bucket.get(q.image);return image?new Response(image.body,{headers:{'Content-Type':image.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}):json({error:'图片不存在'},404)}
 if(req.method==='PATCH'){const data=QuestionEditSchema.parse(await req.json());await db.prepare("UPDATE questions SET data=?,status='confirmed',due=COALESCE(due,?),version=version+1 WHERE id=? AND owner=?").bind(JSON.stringify(data),now,q.id,owner).run();return json({ok:true})}
 if(req.method==='DELETE'){await db.batch([db.prepare('DELETE FROM attempts WHERE question=? AND owner=?').bind(q.id,owner),db.prepare('DELETE FROM questions WHERE id=? AND owner=?').bind(q.id,owner)]);if(q.image)await bucket.delete(q.image);return json({ok:true})}}
 if(path==='reviews/submit'&&req.method==='POST'){
 const input=ReviewInputSchema.parse(await req.json());const previous=await db.prepare('SELECT * FROM attempts WHERE id=? AND owner=?').bind(input.submissionId,owner).first<any>();if(previous){if(previous.question!==input.questionId)return json({error:'提交标识冲突'},409);return json({ok:true})}
 const q=all.find((q:any)=>q.id===input.questionId&&q.status==='confirmed');if(!q)return json({error:'题目不存在'},404);
 const next=nextReview(q.card?JSON.parse(q.card):null,effectiveRating(input),new Date(now));
 await db.batch([db.prepare('INSERT INTO attempts(id,owner,question,data,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM questions WHERE id=? AND owner=? AND version=?)').bind(input.submissionId,owner,q.id,JSON.stringify({input,before:q.card,after:next,algorithm:ALGORITHM_VERSION}),now,q.id,owner,q.version),db.prepare('UPDATE questions SET card=?,due=?,version=version+1 WHERE id=? AND owner=? AND version=? AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND owner=?)').bind(JSON.stringify(next.nextCard),next.dueAt,q.id,owner,q.version,input.submissionId,owner)]);
 const saved=await db.prepare('SELECT id FROM attempts WHERE id=? AND owner=?').bind(input.submissionId,owner).first();return saved?json({ok:true}):json({error:'题目已更新，请刷新后重试'},409);}
 return json({error:'接口不存在'},404);
 }catch(e){if(e instanceof Error&&e.name==='ZodError')return json({error:'输入内容格式不正确'},400);console.error('API failure',e instanceof Error?e.name:'unknown');return json({error:'暂时无法完成操作，请稍后重试'},500)}
}
export {handler as GET,handler as POST,handler as PATCH,handler as DELETE};
