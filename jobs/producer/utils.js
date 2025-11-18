import { GoogleAuth } from 'google-auth-library';

export function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export async function getAccessToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return typeof token === 'string' ? token : String(token || '');
}

export async function getIdTokenHeaders(audience) {
  try {
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(audience);
    return await client.getRequestHeaders();
  } catch {
    return {};
  }
}

export async function acquireProjectLock({ userId, projectId, consumerId, leaseMs = 600000, consumerType = 'CLOUD' }) {
  const baseUrl = requiredEnv('WORKFLOWS_BASE_URL').replace(/\/$/, '');
  const audience = process.env.WORKFLOWS_AUDIENCE || baseUrl;
  const url = `${baseUrl}/workflows/projects/${encodeURIComponent(projectId)}/consumer-lock/acquire`;
  const headers = await getIdTokenHeaders(audience);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      'X-Project-Id': projectId,
    },
    body: JSON.stringify({ consumerId, leaseMs, consumerType }),
  });

  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

export function randomId(prefix = 'prod') {
  const r = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return `${prefix}-${t}-${r}`;
}

export function splitArgs(str) {
  return String(str || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rewriteLocalhostForDocker(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (localHosts.has(u.hostname)) {
      const hostOverride = process.env.PRODUCER_LOCAL_HOST || 'host.docker.internal';
      u.hostname = hostOverride;
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function applyTemplate(input, ctx) {
  if (!input) return '';
  return String(input).replace(/\{(userId|projectId|workspaceId|sessionId)\}/g, (_, k) => ctx[k] || '');
}
