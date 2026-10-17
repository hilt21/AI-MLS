#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
const userId=process.argv[2];
if(!/^[0-9a-f-]{36}$/i.test(userId??''))throw new Error('Usage: node scripts/delete-student.mjs <student-user-uuid>');
const needed=n=>{if(!process.env[n])throw new Error(`Missing ${n}`);return process.env[n]};
const db=createClient(needed('NEXT_PUBLIC_SUPABASE_URL'),needed('SUPABASE_SECRET_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
// Storage objects are not cascaded automatically with auth deletion.
for(let page=0;page<100;page++){
 const {data,error}=await db.storage.from('mistake-originals').list(userId,{limit:100,offset:0});
 if(error)throw new Error(error.message);
 if(!data?.length)break;
 const {error:removeError}=await db.storage.from('mistake-originals').remove(data.map(item=>`${userId}/${item.name}`));
 if(removeError)throw new Error(removeError.message);
}
const {error:deleteError}=await db.auth.admin.deleteUser(userId);
if(deleteError)throw new Error(deleteError.message);
console.log('Student account, private originals and cascaded app records removed. Verify backups and retention procedures separately.');
