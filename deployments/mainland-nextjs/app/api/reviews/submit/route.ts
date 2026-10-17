import { NextRequest,NextResponse } from 'next/server';
import { ReviewInputSchema } from '@/lib/contracts';
import { effectiveRating,nextReview,ALGORITHM_VERSION } from '@/lib/fsrs';
import { adminDb,currentUser } from '@/lib/supabase';
import { bad,requestGuard,unauthorized } from '@/lib/http';
export async function POST(req:NextRequest){
  const guard=requestGuard(req);if(guard)return guard;
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const parsed=ReviewInputSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return bad('复习反馈格式有误');
  const input=parsed.data;
  const {data:question}=await db.from('questions').select('id,status').eq('id',input.questionId).eq('owner_id',user.id).single();
  if(!question||question.status!=='confirmed')return bad('复习题目不存在',404);
  const {data:existing}=await db.from('attempts').select('id').eq('owner_id',user.id).eq('submission_id',input.submissionId).maybeSingle();
  if(existing)return NextResponse.json({ok:true,duplicate:true});
  const {data:state}=await db.from('review_states').select('fsrs_card,version,due_at').eq('question_id',input.questionId).eq('owner_id',user.id).single();
  if(!state)return bad('复习状态不存在',404);
  // Do not allow early reviews from untrusted clients; short learning steps remain schedulable.
  if(new Date(state.due_at).getTime() > Date.now()+10000)return bad('题目尚未到复习时间',409);
  const appliedRating=effectiveRating(input);
  const result=nextReview(state.fsrs_card,appliedRating);
  const {data,error}=await adminDb().rpc('commit_student_review',{
    p_owner_id:user.id, p_question_id:input.questionId,p_submission_id:input.submissionId,p_expected_version:state.version,
    p_raw_answer:input.rawAnswer,p_self_report_correct:input.selfReportCorrect,p_used_hint:input.usedHint,
    p_self_rating:input.selfRating,p_applied_rating:appliedRating,p_next_card:result.nextCard,p_due_at:result.dueAt,p_algorithm_version:ALGORITHM_VERSION,
  });
  if(error)return bad(error.message.includes('stale')?'复习任务已更新，请刷新重试':'保存学习反馈失败',error.message.includes('stale')?409:503);
  return NextResponse.json(data);
}
