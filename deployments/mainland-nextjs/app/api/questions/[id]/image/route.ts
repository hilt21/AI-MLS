import { NextRequest,NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
import { unauthorized,bad } from '@/lib/http';
export async function GET(_req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {id}=await params;
  const {data:question}=await db.from('questions').select('source_path').eq('id',id).eq('owner_id',user.id).single();
  if(!question)return bad('图片不存在',404);
  const {data,error}=await db.storage.from('mistake-originals').download(question.source_path);
  if(error||!data)return bad('获取原图失败',503);
  return new NextResponse(await data.arrayBuffer(),{
    headers:{'Content-Type':data.type||'application/octet-stream','Content-Disposition':'inline', 'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'},
  });
}
