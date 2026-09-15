import assert from 'node:assert/strict';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../../db';
import { workerAvatarsRouter } from '../workerAvatars';
import { ensureWorkerAvatars } from '../../services/workerAvatars';
const database=new PGlite();
await database.exec(`CREATE TABLE users(id VARCHAR PRIMARY KEY); INSERT INTO users VALUES('matt'),('evan');`);
(pool as any).query=async(text:string,values?:any[])=>values?database.query(text,values):database.exec(text).then(results=>results.at(-1));
await ensureWorkerAvatars();
const app=express();app.use(express.json());app.use('/avatar',workerAvatarsRouter((req:any,res,next)=>{if(!req.headers['x-test-worker'])return res.sendStatus(403);req.marketingActor={id:req.headers['x-test-worker']};next();}));
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}/avatar`;
try {
  assert.equal((await fetch(base)).status,403);
  const preset={character:'robot',color:'violet',accessory:'glasses'};
  assert.equal((await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json','x-test-worker':'matt'},body:JSON.stringify({...preset,userId:'evan'})})).status,400,'cannot supply another worker ID');
  assert.equal((await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json','x-test-worker':'matt'},body:JSON.stringify(preset)})).status,200);
  assert.deepEqual((await (await fetch(base,{headers:{'x-test-worker':'matt'}})).json()).preset,preset);
  assert.equal((await (await fetch(base,{headers:{'x-test-worker':'evan'}})).json()).preset.character,'mover');
  const id='00000000-0000-4000-8000-000000000001';
  await database.query('UPDATE worker_avatars SET draft_id=$1,draft_image=$2 WHERE user_id=$3',[id,new Uint8Array([1,2,3]),'matt']);
  assert.equal((await fetch(`${base}/preview/${id}`,{headers:{'x-test-worker':'evan'}})).status,404,'other workers cannot read a private photo preview');
  const own=await fetch(`${base}/preview/${id}`,{headers:{'x-test-worker':'matt'}});
  assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'private, no-store');
  assert.equal((await fetch(`${base}/approve`,{method:'POST',headers:{'Content-Type':'application/json','x-test-worker':'evan'},body:JSON.stringify({draftId:id})})).status,409,'other workers cannot publish someone else’s preview');
  console.log('Avatar save, ownership, input validation and private preview integration passed');
} finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await database.close();}
