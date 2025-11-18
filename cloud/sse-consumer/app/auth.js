import { SERVICE_AUTH_TOKEN, WORKFLOWS_AUDIENCE } from './config.js';

// Inbound auth: enforce a shared secret if configured. Returns true if allowed; else writes 401 and returns false.
export function checkInboundAuth(req, res) {
  // If no token configured, allow all (useful for local dev)
  if (!SERVICE_AUTH_TOKEN) return true;

  const hdr = req.headers['x-service-auth'] || req.headers['authorization'] || '';
  const token = String(hdr || '')
    .replace(/^Bearer\s+/i, '')
    .trim();

  if (token && token === SERVICE_AUTH_TOKEN) return true;

  res.status(401).json({ error: 'unauthorized' });
  return false;
}

// Outbound auth: optionally fetch a Google identity token for the given audience (origin or full audience).
export async function getIdTokenHeader(audience) {
  const aud = WORKFLOWS_AUDIENCE || audience || '';
  if (!aud) return {};

  try {
    // GCE/GKE/Cloud Run metadata server
    const metaUrl = `http://metadata/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(aud)}`;
    const resp = await fetch(metaUrl, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!resp.ok) return {};
    const token = await resp.text();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    // Local or metadata unavailable
    return {};
  }
}
