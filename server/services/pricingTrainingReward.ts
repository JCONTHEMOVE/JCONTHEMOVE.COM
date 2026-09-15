import type { PoolClient } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

type Distribution=(tx:ReturnType<typeof drizzle>,amount:number,description:string,type:string,reference:string)=>Promise<{cashValue:number;transactionId:string}>;
/** The supplied treasury debit and all credits run on the caller's connection. */
export function createTrainingReward(distribute:Distribution){
  return async(client:PoolClient,userId:string,amount:number,reference:string,reviewerId:string)=>{
    const tx=drizzle(client as any);
    const daily=reference.startsWith('pricing-training-daily:');
    const distribution=await distribute(tx,amount,daily?'Daily scenario leaderboard prize':'Owner-approved pricing training contribution','pricing_training',reference);
    const {rows}=await client.query(`INSERT INTO wallet_accounts(user_id,token_balance,total_earned,last_activity) VALUES($1,$2,$2,now())
      ON CONFLICT(user_id) DO UPDATE SET token_balance=COALESCE(wallet_accounts.token_balance,0)+$2::numeric,
        total_earned=COALESCE(wallet_accounts.total_earned,0)+$2::numeric,last_activity=now() RETURNING token_balance`,[userId,amount]);
    await client.query(`INSERT INTO rewards(user_id,reward_type,token_amount,cash_value,status,reference_id,metadata)
      VALUES($1,'pricing_training',$2,$3,'confirmed',$4,$5::jsonb)`,[userId,amount,distribution.cashValue,reference,JSON.stringify({source:daily?'pricing_training_daily_prize':'pricing_training',reviewerId,baseAmount:daily?amount:100,bonusAmount:daily?0:amount-100,balanceAfter:rows[0].token_balance,treasuryTransactionId:distribution.transactionId})]);
  };
}
