import crypto from 'node:crypto';

export function requireEnvKey() {
  const secret = process.env.ENCRYPTION_SECRET_KEY;
  if (!secret || String(secret).trim().length < 8) {
    throw new Error('Server missing ENCRYPTION_SECRET_KEY (min length 8)');
  }
  return String(secret);
}

export function deriveKey(secret) {
  // Derive a 32-byte key using scrypt for AES-256-GCM
  return crypto.scryptSync(secret, 'workflows-creds-v1', 32);
}

export function encryptString(plaintext) {
  const secret = requireEnvKey();
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
    v: 1,
  };
}

export function decryptString(enc) {
  if (!enc || enc.alg !== 'aes-256-gcm') throw new Error('Unsupported encryption payload');
  const secret = requireEnvKey();
  const key = deriveKey(secret);
  const iv = Buffer.from(enc.iv, 'base64');
  const tag = Buffer.from(enc.tag, 'base64');
  const ct = Buffer.from(enc.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
