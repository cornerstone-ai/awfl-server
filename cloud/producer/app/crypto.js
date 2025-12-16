// AES-256-GCM helpers with compact envelope { v, n, ct, tag }
// - v: scheme version (a256gcm:v1)
// - n: nonce (base64, 12 bytes)
// - ct: ciphertext (base64)
// - tag: auth tag (base64, 16 bytes)
// AAD is bound to routing attributes to prevent cross-context replay.

import crypto from 'node:crypto';

const SCHEME = 'a256gcm:v1';

function b64ToBuf(b64) {
  return Buffer.from(b64, 'base64');
}
function bufToB64(buf) {
  return Buffer.from(buf).toString('base64');
}

function getKeyFromB64(b64) {
  if (!b64) throw new Error('enc_key_missing');
  const key = b64ToBuf(b64);
  if (key.length !== 32) throw new Error('enc_key_len_invalid');
  return key;
}

// Canonicalize AAD as a stable, ordered JSON string and return Buffer
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

export function encryptJson(payload, encKeyB64, attrsForAad = {}) {
  const key = getKeyFromB64(encKeyB64);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const aad = aadBytes(attrsForAad);
  if (aad && aad.length) cipher.setAAD(aad);
  const pt = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: SCHEME, n: bufToB64(iv), ct: bufToB64(ct), tag: bufToB64(tag) };
}

export function decryptToJson(envelope, encKeyB64, attrsForAad = {}) {
  if (!envelope) throw new Error('enc_envelope_missing');
  const { v, n, ct, tag } = envelope;
  if (v !== SCHEME) throw new Error('enc_scheme_unsupported');
  const key = getKeyFromB64(encKeyB64);
  const iv = b64ToBuf(n);
  const ciphertext = b64ToBuf(ct);
  const authTag = b64ToBuf(tag);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  const aad = aadBytes(attrsForAad);
  if (aad && aad.length) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  const pt = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const json = pt.toString('utf8');
  return JSON.parse(json);
}

export function scheme() { return SCHEME; }

// Minimal self-test when executed directly
if (process.argv[1] && process.argv[1].endsWith('crypto.js') && process.env.CRYPTO_SELFTEST === '1') {
  const key = crypto.randomBytes(32).toString('base64');
  const attrs = { user_id: 'u', project_id: 'p', session_id: 's', channel: 'req', type: 'tool', seq: 1 };
  const obj = { hello: 'world', n: 42 };
  const env = encryptJson(obj, key, attrs);
  const out = decryptToJson(env, key, attrs);
  if (JSON.stringify(obj) !== JSON.stringify(out)) {
    console.error('crypto self-test FAILED');
    process.exit(1);
  }
  console.log('crypto self-test OK');
}
