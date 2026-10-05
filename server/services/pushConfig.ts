import { createECDH, createHash } from 'node:crypto';

export function inspectPushConfig(env: NodeJS.ProcessEnv = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || '';
  const subject = env.VAPID_EMAIL?.trim() || 'mailto:upmichiganstatemovers@gmail.com';
  const blockers: string[] = [];
  if (!publicKey) blockers.push('VAPID_PUBLIC_KEY is missing.');
  if (!privateKey) blockers.push('VAPID_PRIVATE_KEY is missing.');
  if (publicKey && privateKey) {
    try {
      if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) throw new Error();
      const pair = createECDH('prime256v1');
      pair.setPrivateKey(Buffer.from(privateKey, 'base64url'));
      if (pair.getPublicKey().toString('base64url') !== publicKey) {
        blockers.push('VAPID public/private keys do not match. Configure the same generated pair.');
      }
    } catch {
      blockers.push('VAPID keys must be valid base64url P-256 keys.');
    }
  }
  try {
    const url = new URL(subject);
    if (!((url.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(url.pathname)) ||
      (url.protocol === 'https:' && !!url.hostname))) throw new Error();
  } catch {
    blockers.push('VAPID_EMAIL must be a mailto contact or HTTPS URL.');
  }
  const warnings: string[] = [];
  if (env.VITE_VAPID_PUBLIC_KEY) warnings.push('VITE_VAPID_PUBLIC_KEY is obsolete and ignored; browsers use the runtime public-key endpoint.');
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    publicKeyFingerprint: publicKey ? createHash('sha256').update(publicKey).digest('hex').slice(0, 16) : null,
    publicKeySource: '/api/notifications/vapid-public-key',
  };
}

// One startup snapshot shared by readiness, subscription setup, and sending.
export const pushConfig = {
  ...inspectPushConfig(),
  publicKey: process.env.VAPID_PUBLIC_KEY?.trim() || '',
  privateKey: process.env.VAPID_PRIVATE_KEY?.trim() || '',
  subject: process.env.VAPID_EMAIL?.trim() || 'mailto:upmichiganstatemovers@gmail.com',
};

export function getPushReadiness() {
  const { publicKey, privateKey, subject, ...diagnostics } = pushConfig;
  return diagnostics;
}
