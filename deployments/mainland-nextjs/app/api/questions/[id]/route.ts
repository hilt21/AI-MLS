import { NextRequest,NextResponse } from 'next/server';
import { QuestionEditSchema } from '@/lib/contracts';
import { adminDb,currentUser } from '@/lib/supabase';
import { requestGuard,unauthorized,bad } from '@/lib/http';
export async function PATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const guard=requestGuard(req);if(guard)return guard;
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {id}=await params;
  const input=QuestionEditSchema.safeParse(await req.json().catch(()=>null));if(!input.success)return bad('题目字段校验失败');
  const {data:before,error:readError}=await db.from('questions').select('id,status').eq('id',id).eq('owner_id',user.id).single();
  if(readError||!before)return bad('题目不存在',404);
  // A confirmed question can be corrected; it keeps its review history.
  const {error}=await adminDb().from('questions').update({...input.data,status:'confirmed',updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id);
  if(error)return bad('保存失败',503);
  // Only backend has the service key; idempotent initialization does not overwrite an existing schedule.
  if(before.status==='draft') {
    const {error:initError}=await adminDb().from('review_states').upsert({question_id:id,owner_id:user.id,fsrs_card:{},due_at:new Date().toISOString(),version:0},{onConflict:'question_id',ignoreDuplicates:true});
    if(initError)return bad('题目已保存，但复习任务创建失败，请联系管理员',503);
  }
  return NextResponse.json({ok:true});
}
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const guard=requestGuard(req);if(guard)return guard;
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {id}=await params;
  const {data:question}=await db.from('questions').select('source_path').eq('id',id).eq('owner_id',user.id).single();
  if(!question)return bad('题目不存在',404);
  const {error:storageError}=await adminDb().storage.from('mistake-originals').remove([question.source_path]);
  if(storageError)return bad('删除原图失败，题目尚未删除',503);
  const {error}=await adminDb().from('questions').delete().eq('id',id).eq('owner_id',user.id);
  if(error)return bad('删除题目失败',503);
  return NextResponse.json({ok:true});
}
