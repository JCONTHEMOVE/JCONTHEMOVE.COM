import assert from 'node:assert/strict';
import { deliverWithGmailFallback, type GmailApiOutcome } from '../gmailDelivery';
let smtpCalls=0;
for (const [outcome,expected,calls] of [["sent",true,0],["auth-rejected",true,1],["failed",false,0]] as const) {
  smtpCalls=0;
  assert.equal(await deliverWithGmailFallback({hasOAuth:true,hasSmtp:true,api:async()=>outcome as GmailApiOutcome,smtp:async()=>{smtpCalls++;return true;}}),expected);
  assert.equal(smtpCalls,calls);
}
assert.equal(await deliverWithGmailFallback({hasOAuth:true,hasSmtp:false,api:async()=>"auth-rejected",smtp:async()=>{throw Error('must not call');}}),false);
assert.equal(await deliverWithGmailFallback({hasOAuth:false,hasSmtp:true,api:async()=>{throw Error('must not call');},smtp:async()=>true}),true);
console.log('Gmail delivery fallback passed: auth rejection retries SMTP; accepted/ambiguous sends do not duplicate.');
