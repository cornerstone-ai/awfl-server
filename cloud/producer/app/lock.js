import axios from 'axios';
import { getWorkflowsIdTokenHeaders } from './auth.js';
import { contextHeaders, WORKFLOWS_BASE_URL, X_PROJECT_ID, CONSUMER_ID, LOCK_LEASE_MS } from './config.js';

// Acquire and periodically refresh the project consumer lock
// Returns a stop() function to end the refresh loop.
export function startProjectLockClient({ onConflict } = {}) {
  let stopped = false;
  let timer = null;

  const base = WORKFLOWS_BASE_URL.replace(/\/$/, '');
  const url = `${base}/projects/${encodeURIComponent(X_PROJECT_ID)}/consumer-lock/acquire`;

  async function acquireOrRefresh(kind = 'acquire') {
    if (stopped) return;
    try {
      const authz = await getWorkflowsIdTokenHeaders();
      const headers = { 'Content-Type': 'application/json', ...contextHeaders(), ...authz, 'x-consumer-id': CONSUMER_ID };
      const leaseMs = Number.isFinite(LOCK_LEASE_MS) ? Math.max(30_000, Math.floor(LOCK_LEASE_MS)) : 10 * 60_000;
      const body = { consumerId: CONSUMER_ID, leaseMs };
      const resp = await axios.post(url, body, { headers, timeout: 5000, validateStatus: (s) => s < 500 });
      if (resp.status === 409 || resp?.data?.conflict) {
        console.warn('[producer] consumer lock conflict', { projectId: X_PROJECT_ID, consumerId: CONSUMER_ID, status: resp.status });
        if (onConflict) try { onConflict(); } catch {}
        stop();
        return;
      }
      if (resp.status < 200 || resp.status >= 300) {
        console.warn('[producer] consumer lock non-2xx', { status: resp.status, data: resp.data });
      } else {
        console.log('[producer] consumer lock ok', { kind, leaseMs });
      }
    } catch (err) {
      console.warn('[producer] consumer lock error', err?.message || err);
      // continue and try again next tick
    } finally {
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (stopped) return;
    const leaseMs = Number.isFinite(LOCK_LEASE_MS) ? Math.max(30_000, Math.floor(LOCK_LEASE_MS)) : 10 * 60_000;
    const baseDelay = Math.floor(leaseMs * 0.6);
    const jitter = Math.floor(Math.random() * Math.min(leaseMs * 0.1, 5_000));
    const delay = Math.max(15_000, baseDelay - jitter);
    if (timer) { try { clearTimeout(timer); } catch {} }
    timer = setTimeout(() => acquireOrRefresh('refresh'), delay);
    // For visibility
    console.log('[producer] scheduled lock refresh in', delay, 'ms');
  }

  function stop() {
    stopped = true;
    try { if (timer) clearTimeout(timer); } catch {}
    timer = null;
  }

  // Kick off initial acquire immediately
  acquireOrRefresh('acquire');

  return { stop };
}
