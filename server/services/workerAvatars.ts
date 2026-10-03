import { pool } from '../db';
import { DEFAULT_WORKER_AVATAR, workerAvatarSchema } from '@shared/crewGrowth';

export async function ensureWorkerAvatars() {
  await pool.query(`CREATE TABLE IF NOT EXISTS worker_avatars (
    user_id VARCHAR PRIMARY KEY REFERENCES users(id), preset JSONB NOT NULL,
    image_url TEXT, draft_image BYTEA, draft_id UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE TABLE IF NOT EXISTS worker_avatar_generation_limits (
    user_id VARCHAR REFERENCES users(id), day DATE NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,day)
  )`);
}

export async function publicWorkerAvatars(userIds:string[]) {
  if (!userIds.length) return new Map();
  const rows=(await pool.query(`SELECT user_id,preset,image_url FROM worker_avatars WHERE user_id=ANY($1::varchar[])`,[userIds])).rows;
  return new Map(rows.map(row=>[row.user_id,{avatar:workerAvatarSchema.safeParse(row.preset).success?row.preset:DEFAULT_WORKER_AVATAR,avatarImageUrl:row.image_url}]));
}
