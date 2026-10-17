import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
import { unauthorized, bad } from '@/lib/http';
export async function GET() {
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {data,error}=await db.from('ingestion_jobs').select('id,question_id,status,attempts,last_error,created_at,updated_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(20);
  if(error)return bad('读取识别任务失败',503);
  return NextResponse.json({jobs:data}, {headers:{'Cache-Control':'no-store'}});
}
