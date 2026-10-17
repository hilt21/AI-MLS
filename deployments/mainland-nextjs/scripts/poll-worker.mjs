#!/usr/bin/env node
const origin=process.env.APP_ORIGIN||'http://localhost:3000';
const secret=process.env.WORKER_SECRET;
if(!secret||secret.length<32)throw new Error('WORKER_SECRET must be at least 32 characters');
console.log('Starting worker poller (single instance recommended for pilot). Press Ctrl-C to stop.');
let keepRunning=true;
process.on('SIGINT',()=>keepRunning=false);
while(keepRunning){
  try{
    const response=await fetch(`${origin}/api/internal/process-job`,{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(90000)});
    const body=await response.json();
    if(!response.ok)console.error('Worker API status',response.status,body.error);
    else if(body.processed)console.log(new Date().toISOString(),'Processed',body.jobId,body.ok?'ok':'retry/failed');
  }catch(e){console.error('Worker call failed:',e.message);}
  await new Promise(r=>setTimeout(r,12000));
}
