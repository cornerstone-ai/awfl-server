// AES-256-GCM compact envelope helpers for consumer
// Envelope: { v, n, ct, tag }
// AAD is derived from routing attributes in a stable JSON shape with fixed field order:
//   { user_id, project_id, session_id, channel, type, seq: String(seq) }
// Encoding: standard base64 for n, ct, tag (12-byte nonce, 16-byte tag)

import crypto from 'crypto';

const SCHEME = 'a256gcm:v1';

export function scheme() { return SCHEME; }

function b64ToBuf(b64) {
  return Buffer.from(String(b64 || ''), 'base64');
}
function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}

// Canonicalize AAD exactly like the producer: stable JSON with fixed fields and stringified seq
export function aadBytes(attrs = {}) {
  const obj = {
    user_id: attrs.user_id || '',
    project_id: attrs.project_id || '',
    session_id: attrs.session_id || '',
    channel: attrs.channel || '',
    type: attrs.type || '',
    seq: String(attrs.seq ?? ''),
  };
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8');
}

function getKey(keyB64) {
  const key = Buffer.from(String(keyB64 || ''), 'base64');
  if (key.length !== 32) throw new Error('ENC_KEY_B64 must be 32 bytes (base64)');
  return key;
}

export function encryptJson(obj, keyB64, attrs) {
  const key = getKey(keyB64);
  const iv = crypto.randomBytes(12);
  const aad = aadBytes(attrs);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  if (aad && aad.length) cipher.setAAD(aad);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: scheme(),
    n: bufToB64(iv),
    ct: bufToB64(ct),
    tag: bufToB64(tag),
  };
}

export function decryptToJson(env, keyB64, attrs) {
  if (!env || typeof env !== 'object') throw new Error('env_missing');
  if (env.v !== SCHEME) throw new Error('enc_scheme_unsupported');
  const key = getKey(keyB64);
  const iv = b64ToBuf(env.n);
  const ct = b64ToBuf(env.ct);
  const tag = b64ToBuf(env.tag);
  const aad = aadBytes(attrs);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  if (aad && aad.length) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  const txt = pt.toString('utf8');
  return JSON.parse(txt);
}
