#!/usr/bin/env node
/**
 * Admin-only: provision a student after verified guardian consent has been recorded externally.
 * No student-facing public registration is provided in this MVP.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
const [username] = process.argv.slice(2);
function required(name) { const value=process.env[name]; if(!value)throw new Error(`Missing ${name}`);return value; }
if(!username||!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username))throw new Error('Usage: npm run provision -- student_name (3-30 lowercase letters/numbers/_/-)');
const consentId=required('CONSENT_RECORD_ID');
const verifiedBy=required('CONSENT_VERIFIED_BY');
const verifiedAt=required('CONSENT_VERIFIED_AT');
const rulesVersion=required('PROCESSING_RULES_VERSION');
if(Number.isNaN(Date.parse(verifiedAt)))throw new Error('CONSENT_VERIFIED_AT must be ISO timestamp');
const domain=required('STUDENT_LOGIN_DOMAIN');
const email=`${username}@${domain}`;
const password=randomBytes(18).toString('base64url');
const client=createClient(required('NEXT_PUBLIC_SUPABASE_URL'),required('SUPABASE_SECRET_KEY'),{auth:{autoRefreshToken:false,persistSession:false}});
const {data,error}=await client.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{role:'student'}});
if(error||!data.user)throw new Error(`Provision failed: ${error?.message}`);
const {error:consentError}=await client.from('student_consents').insert({owner_id:data.user.id,guardian_consent_record_id:consentId,verified_by:verifiedBy,verified_at:verifiedAt,processing_rules_version:rulesVersion});
if(consentError){await client.auth.admin.deleteUser(data.user.id);throw new Error(`Consent metadata failed; account rolled back: ${consentError.message}`);}
console.log('Student account created. Deliver the temporary credentials through a secure offline channel.');
console.log(`Username: ${username}`);
console.log(`Initial password (shown once): ${password}`);
console.log('Do not store this console output in issue trackers or public logs.');
