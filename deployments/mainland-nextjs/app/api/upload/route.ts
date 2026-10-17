import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { requestGuard, bad, unauthorized } from '@/lib/http';
import { adminDb, currentUser } from '@/lib/supabase';
export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_BYTES = 6 * 1024 * 1024;
function detectMime(buffer: Buffer): { mime: string; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return {mime:'image/jpeg',extension:'jpg'};
  if (buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {mime:'image/png',extension:'png'};
  if (buffer.length >= 12 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP') return {mime:'image/webp',extension:'webp'};
  return null;
}
export async function POST(req: NextRequest) {
  const guard=requestGuard(req); if(guard)return guard;
  const { db, user }=await currentUser(); if (!user)return unauthorized();
  const length=Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES + 25000) return bad('图片过大，最多 6MB',413);
  const form=await req.formData().catch(()=>null);
  const file=form?.get('photo');
  if (!(file instanceof File) || file.size < 20 || file.size > MAX_BYTES) return bad('请上传 20B～6MB 的 PNG/JPEG/WebP 图片');
  const buffer=Buffer.from(await file.arrayBuffer());
  const format=detectMime(buffer);
  if (!format) return bad('仅支持 JPEG、PNG、WebP 格式');
  // Per student, at most 20 new jobs per UTC day (rate-limiting gateway still required for login).
  const dayStart = new Date();dayStart.setUTCHours(0,0,0,0);
  const { count, error: countError }=await db.from('ingestion_jobs').select('id',{count:'exact',head:true}).eq('owner_id',user.id).gte('created_at',dayStart.toISOString());
  // The ingestion table deliberately forbids student SELECT of other users; own rows only.
  if(countError) return bad('上传额度检查失败',503);
  if((count??0)>=20) return bad('今日已达到 20 张图片额度',429);
  // Normalize orientation; strip EXIF/GPS/location/device metadata before storing or sending to AI.
  // No .withMetadata(): sharp drops ancillary metadata by default.
  let safeImage: Buffer;
  try {
    safeImage=await sharp(buffer,{limitInputPixels:40000000,animated:false})
      .rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true})
      .webp({quality:93,effort:4}).toBuffer();
  }catch {return bad('图片无法安全解码，请重新拍摄');}
  if (safeImage.length > MAX_BYTES) return bad('处理后的图片过大，请裁剪后上传',413);
  const path=`${user.id}/${randomUUID()}.webp`;
  const admin=adminDb();
  const {error: uploadError}=await admin.storage.from('mistake-originals').upload(path,safeImage,{contentType:'image/webp',upsert:false,cacheControl:'private, max-age=0'});
  if(uploadError) return bad('图片保存失败，请重试',503);
  const {data:question,error:questionError}=await admin.from('questions').insert({owner_id:user.id,source_path:path,title:'等待 AI 识别',status:'draft'}).select('id').single();
  if(questionError||!question) {
    await admin.storage.from('mistake-originals').remove([path]);
    return bad('创建题目失败，请重试',503);
  }
  const {data:job,error:jobError}=await admin.from('ingestion_jobs').insert({owner_id:user.id,question_id:question.id,source_path:path,status:'queued'}).select('id').single();
  if(jobError||!job){
    await admin.from('questions').delete().eq('id',question.id);
    await admin.storage.from('mistake-originals').remove([path]);
    return bad('识别任务创建失败',503);
  }
  return NextResponse.json({jobId:job.id,questionId:question.id,status:'queued'}, {status:202});
}
