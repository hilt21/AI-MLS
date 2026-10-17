import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/supabase';
import { bad,unauthorized } from '@/lib/http';
export async function GET(){
  const {db,user}=await currentUser();if(!user)return unauthorized();
  const [qs,attempts,states]=await Promise.all([
    db.from('questions').select('id,status',{count:'exact'}).eq('owner_id',user.id),
    db.from('attempts').select('self_report_correct,used_hint,created_at').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100),
    db.from('review_states').select('due_at').eq('owner_id',user.id),
  ]);
  if(qs.error||attempts.error||states.error)return bad('获取学习统计失败',503);
  const list=attempts.data??[];
  const independent=list.filter(a=>a.self_report_correct&&!a.used_hint).length;
  const due=(states.data??[]).filter(s=>new Date(s.due_at).getTime()<=Date.now()).length;
  return NextResponse.json({questionCount:qs.count??0,confirmedCount:(qs.data??[]).filter(x=>x.status==='confirmed').length,reviewCount:list.length,independentCount:independent,dueCount:due,rateSource:'self_report'},{headers:{'Cache-Control':'no-store'}});
}
