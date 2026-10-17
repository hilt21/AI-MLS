import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
import { unauthorized,bad } from '@/lib/http';
export async function GET(){
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {data:states,error}=await db.from('review_states').select('question_id,due_at,version').eq('owner_id',user.id).lte('due_at',new Date().toISOString()).order('due_at',{ascending:true}).limit(30);
  if(error)return bad('获取今日复习任务失败',503);
  const ids=(states??[]).map(s=>s.question_id);
  if(!ids.length)return NextResponse.json({reviews:[]},{headers:{'Cache-Control':'no-store'}});
  const {data:questions,error:qError}=await db.from('questions').select('id,title,question_markdown,solution_markdown,correct_answer,image_required').eq('owner_id',user.id).eq('status','confirmed').in('id',ids);
  if(qError)return bad('读取复习题目失败',503);
  const lookup=new Map((questions??[]).map(q=>[q.id,q]));
  const reviews=(states??[]).map(s=>({...s,question:lookup.get(s.question_id)})).filter(s=>s.question);
  return NextResponse.json({reviews},{headers:{'Cache-Control':'no-store'}});
}
