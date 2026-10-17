import { NextRequest,NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminDb } from '@/lib/supabase';
import { recognizeImage } from '@/lib/recognition';
import { requireEnv } from '@/lib/env';
export const runtime='nodejs';
export const maxDuration=80;
function auth(req:NextRequest){
  const actual=Buffer.from(req.headers.get('authorization')?.replace(/^Bearer /,'')??'');
  const expected=Buffer.from(requireEnv('WORKER_SECRET'));
  return expected.length>=32&&actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export async function POST(req:NextRequest){
  if(!auth(req))return NextResponse.json({error:'unauthorized'},{status:401});
  const admin=adminDb();
  const {data:jobs,error:claimError}=await admin.rpc('claim_ingestion_job');
  if(claimError)return NextResponse.json({error:'job claim failed'},{status:503});
  const job=jobs?.[0];
  if(!job)return NextResponse.json({ok:true,processed:0});
  try{
    const {data:image,error:imageError}=await admin.storage.from('mistake-originals').download(job.source_path);
    if(imageError||!image)throw new Error('原图下载失败');
    const mime=image.type;
    if(!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('原图格式不支持');
    const draft=await recognizeImage(new Uint8Array(await image.arrayBuffer()),mime);
    const {error:saveError}=await admin.from('questions').update({...draft,status:'draft',updated_at:new Date().toISOString()}).eq('id',job.question_id).eq('owner_id',job.owner_id).eq('status','draft');
    if(saveError)throw new Error('保存题目识别结果失败');
    await admin.from('ingestion_jobs').update({status:'done',last_error:null,updated_at:new Date().toISOString()}).eq('id',job.id);
    return NextResponse.json({ok:true,processed:1,jobId:job.id});
  }catch(e){
    const msg=e instanceof Error?e.message:'unknown error';
    await admin.from('ingestion_jobs').update({status:job.attempts>=3?'failed':'queued',locked_at:null,last_error:msg.slice(0,300),updated_at:new Date().toISOString()}).eq('id',job.id);
    return NextResponse.json({ok:false,processed:1,jobId:job.id,error:'processing failed'},{status:200});
  }
}
