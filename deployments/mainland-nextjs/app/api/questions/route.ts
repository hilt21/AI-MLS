import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
import { unauthorized,bad } from '@/lib/http';
export async function GET() {
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const {data,error}=await db.from('questions').select('id,title,question_markdown,solution_markdown,correct_answer,student_wrong_answer,stage,grade,knowledge_points,error_type,image_required,recognition_notes,status,created_at,updated_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(150);
  if(error)return bad('读取错题失败',503);
  return NextResponse.json({questions:data}, {headers:{'Cache-Control':'no-store'}});
}
