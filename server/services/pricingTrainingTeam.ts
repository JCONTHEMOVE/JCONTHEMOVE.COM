import { treasuryService } from './treasury';
import { parseJobEventWebhookUrls } from './jobEventBus';
import { createTrainingReward } from './pricingTrainingReward';

/** All writes use the caller's transaction, including the treasury debit. */
export const rewardTrainingContribution=createTrainingReward((tx,...args)=>treasuryService.distributeTokensInTransaction(tx as Parameters<typeof treasuryService.distributeTokensInTransaction>[0],...args));

export function trainingDiscordUrls(env:NodeJS.ProcessEnv=process.env){
  return parseJobEventWebhookUrls(env).filter(raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&['discord.com','discordapp.com'].includes(u.hostname)&&u.pathname.startsWith('/api/webhooks/');}catch{return false;}});
}
export function trainingThankYou(displayName:string,scenarioId:string){
  const name=displayName.replace(/[\r\n<>@*_`~\\]/g,'').slice(0,80)||'A coworker';
  return {username:'JC ON THE MOVE',content:`Thank you, ${name}, for contributing to our 500-request pricing training! Your input on ${scenarioId} helps us plan better jobs. Contributions earn 100 JCMOVES after owner approval, plus 50 for mostly correct or 100 for correct answers. Join in: https://www.jconthemove.com/crew/pricing-training`,allowed_mentions:{parse:[]}};
}
export async function thankTrainingContributor(name:string,scenarioId:string):Promise<'sent'|'unconfigured'|'failed'|'uncertain'>{
  // Use the first existing Discord destination, not unrelated Slack/webhook targets.
  const url=trainingDiscordUrls()[0];if(!url)return 'unconfigured';
  try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(trainingThankYou(name,scenarioId)),signal:AbortSignal.timeout(7000),redirect:'error'});return response.ok?'sent':response.status>=500?'uncertain':'failed';}
  catch{return 'uncertain';}
}
