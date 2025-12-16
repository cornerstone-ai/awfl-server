import { getAccessToken } from './utils.js';

export async function pubsubRequest(path, { method = 'GET', body } = {}) {
  const token = await getAccessToken();
  const url = `https://pubsub.googleapis.com/v1/${path.replace(/^\//, '')}`;
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// Minimum allowed by Pub/Sub for expirationPolicy.ttl is 24h (86400 seconds)
const MIN_EXPIRATION_TTL_SEC = 86400;

export async function ensureSubscription({
  gcpProject,
  name,
  topic,
  filter,
  ackDeadlineSeconds = 20,
  // Note: if provided and > 0 but below the service minimum, we will clamp to 24h
  // Pass 0/undefined to disable expiration (never expire)
  ttlSeconds = 86400,
}) {
  const subPath = `projects/${encodeURIComponent(gcpProject)}/subscriptions/${encodeURIComponent(name)}`;

  // Normalize TTL: allow 0/undefined for no expiration; otherwise clamp to service minimum
  const ttlNum = Number(ttlSeconds);
  const ttlProvided = Number.isFinite(ttlNum) ? Math.max(0, Math.floor(ttlNum)) : 0;
  const ttlClamped = ttlProvided === 0 ? 0 : Math.max(MIN_EXPIRATION_TTL_SEC, ttlProvided);

  const makeBody = (ttl) => ({
    topic: `projects/${gcpProject}/topics/${topic}`,
    ackDeadlineSeconds,
    expirationPolicy: ttl > 0 ? { ttl: `${ttl}s` } : undefined,
    filter: filter || undefined,
  });

  // First attempt with normalized/clamped TTL
  let create = await pubsubRequest(subPath, { method: 'PUT', body: makeBody(ttlClamped) });

  // If the API rejects due to a too-small TTL (defensive), retry once with the minimum
  if (!create.ok && create.status === 400) {
    const msg = (create.data && (create.data.message || create.data.error?.message)) || '';
    if (msg && /expiration duration is too small/i.test(msg)) {
      console.warn('[pubsubAdmin] ensureSubscription: TTL too small; retrying with 24h', { name });
      create = await pubsubRequest(subPath, { method: 'PUT', body: makeBody(MIN_EXPIRATION_TTL_SEC) });
    }
  }

  if (create.ok || create.status === 409) return { ok: true, name };
  return create;
}

export async function getIamPolicy({ gcpProject, subscription }) {
  const path = `projects/${encodeURIComponent(gcpProject)}/subscriptions/${encodeURIComponent(subscription)}:getIamPolicy`;
  return await pubsubRequest(path, { method: 'POST', body: {} });
}

export async function setIamPolicy({ gcpProject, subscription, policy }) {
  const path = `projects/${encodeURIComponent(gcpProject)}/subscriptions/${encodeURIComponent(subscription)}:setIamPolicy`;
  return await pubsubRequest(path, { method: 'POST', body: { policy } });
}

export function mergeBinding(policy, role, member) {
  const p = policy && typeof policy === 'object' ? policy : { bindings: [] };
  const bindings = Array.isArray(p.bindings) ? [...p.bindings] : [];
  const idx = bindings.findIndex(b => b.role === role);
  if (idx >= 0) {
    const members = new Set([...(bindings[idx].members || []), member]);
    bindings[idx] = { role, members: Array.from(members) };
  } else {
    bindings.push({ role, members: [member] });
  }
  return { ...p, bindings };
}

export async function addSubscriberBinding({ gcpProject, subscription, saEmail }) {
  if (!saEmail) return { ok: false, skipped: true, reason: 'missing serviceAccount email' };
  const member = `serviceAccount:${saEmail}`;
  const cur = await getIamPolicy({ gcpProject, subscription });
  const policy = mergeBinding(cur.data || {}, 'roles/pubsub.subscriber', member);
  const set = await setIamPolicy({ gcpProject, subscription, policy });
  return set;
}

export async function deleteSubscription({ gcpProject, name }) {
  const path = `projects/${encodeURIComponent(gcpProject)}/subscriptions/${encodeURIComponent(name)}`;
  const del = await pubsubRequest(path, { method: 'DELETE' });
  // 404 is fine (already deleted)
  if (del.ok || del.status === 404) return { ok: true };
  return del;
}
