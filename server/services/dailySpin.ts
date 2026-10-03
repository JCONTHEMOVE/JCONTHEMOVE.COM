import type { Pool } from '@neondatabase/serverless';

export const DAILY_SPIN_SCHEMA=`CREATE TABLE IF NOT EXISTS daily_spin_claims (
  user_id VARCHAR NOT NULL REFERENCES users(id),day DATE NOT NULL,entitlement_id INTEGER NOT NULL UNIQUE REFERENCES reward_entitlements(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,day)
);`;
export async function consumeSpinCredit(client:Pick<Pool,'query'>,userId:string,id:number,redemptionId?:number){
  const result=await client.query(`UPDATE reward_entitlements
    SET value_json=jsonb_set(COALESCE(value_json,'{}'::jsonb),'{spins}',to_jsonb(GREATEST(0,COALESCE((value_json->>'spins')::int,1)-1))),
      status=CASE WHEN COALESCE((value_json->>'spins')::int,1)<=1 THEN 'used' ELSE status END,
      consumed_at=CASE WHEN COALESCE((value_json->>'spins')::int,1)<=1 THEN NOW() ELSE consumed_at END
    WHERE id=$1 AND user_id=$2 AND entitlement_type='spin_credit' AND status='active'
      AND (expires_at IS NULL OR expires_at>NOW()) AND COALESCE((value_json->>'spins')::int,1)>0
      AND ($3::int IS NULL OR redemption_id=$3) RETURNING id`,[id,userId,redemptionId||null]);
  return result.rows.length===1;
}
export function createDailySpin(pool:Pool) {
  const dates=async(client:Pick<Pool,'query'>)=>(await client.query(`SELECT (NOW() AT TIME ZONE 'America/Chicago')::date::text AS day,
    (((NOW() AT TIME ZONE 'America/Chicago')::date+1)::timestamp AT TIME ZONE 'America/Chicago') AS reset_at`)).rows[0];
  return {
    async status(userId:string){
      const today=await dates(pool);
      const claim=(await pool.query(`SELECT e.id,e.status,e.value_json FROM daily_spin_claims c JOIN reward_entitlements e ON e.id=c.entitlement_id WHERE c.user_id=$1 AND c.day=$2`,[userId,today.day])).rows[0];
      const config=(await pool.query(`SELECT setting_value FROM spin_config WHERE setting_key='spin_wheel_enabled'`)).rows[0];
      return {enabled:config?.setting_value!=='false',canClaim:!claim,entitlementId:claim?.id||null,available:claim?.status==='active'&&Number(claim.value_json?.spins)>0,nextResetAt:today.reset_at};
    },
    async claim(userId:string){
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`,[userId]);
        const config=(await client.query(`SELECT setting_value FROM spin_config WHERE setting_key='spin_wheel_enabled'`)).rows[0];
        if(config?.setting_value==='false')throw new Error('Quantum Spin is temporarily unavailable');
        const today=await dates(client as any);
        const existing=(await client.query(`SELECT c.entitlement_id,e.status FROM daily_spin_claims c JOIN reward_entitlements e ON e.id=c.entitlement_id WHERE c.user_id=$1 AND c.day=$2`,[userId,today.day])).rows[0];
        if(existing){await client.query('COMMIT');return {entitlementId:existing.entitlement_id,alreadyClaimed:true,available:existing.status==='active',nextResetAt:today.reset_at};}
        const entitlement=(await client.query(`INSERT INTO reward_entitlements(user_id,entitlement_type,value_json,status,expires_at)
          VALUES($1,'spin_credit','{"spins":1,"source":"daily_free_spin"}'::jsonb,'active',$2) RETURNING id`,[userId,today.reset_at])).rows[0];
        await client.query(`INSERT INTO daily_spin_claims(user_id,day,entitlement_id) VALUES($1,$2,$3)`,[userId,today.day,entitlement.id]);
        await client.query('COMMIT');return {entitlementId:entitlement.id,alreadyClaimed:false,available:true,nextResetAt:today.reset_at};
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
  };
}
