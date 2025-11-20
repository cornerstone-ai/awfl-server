import axios from 'axios';
import { getWorkflowsIdTokenHeaders } from './auth.js';
import { WORKFLOWS_BASE_URL, X_PROJECT_ID } from './config.js';
import { contextHeaders } from './config.js';

export async function postCursor({ eventId, timestamp }) {
  // Always record project-wide cursor with simple retry/backoff
  const url = `${WORKFLOWS_BASE_URL.replace(/\/$/, '')}/events/cursors`;
  const authz = await getWorkflowsIdTokenHeaders();
  const headers = {
    'Content-Type': 'application/json',
    ...contextHeaders(),
    ...authz,
  };
  const body = {
    projectId: X_PROJECT_ID,
    eventId,
    timestamp,
    target: 'project',
  };
  const maxAttempts = 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      console.log('[producer] cursor update attempt', { projectId: X_PROJECT_ID, eventId, timestamp, attempt });
      const resp = await axios.post(url, body, { headers, timeout: 15000, validateStatus: (s) => s < 500 });
      if (resp.status >= 200 && resp.status < 300) {
        console.log('[producer] cursor updated', { projectId: X_PROJECT_ID, eventId, timestamp });
        return;
      }
      console.warn('[producer] cursor update non-2xx', { status: resp.status });
      throw new Error(`cursor_http_${resp.status}`);
    } catch (err) {
      const backoff = 250 * attempt + Math.floor(Math.random() * 150);
      console.warn('[producer] cursor update failed', err?.message || err);
      await new Promise((r) => setTimeout(r, backoff));
      if (attempt >= maxAttempts) {
        console.warn('[producer] failed to update project cursor after retries', err?.message || err);
        return;
      }
    }
  }
}

export async function getProjectCursor() {
  // Best-effort fetch of the persisted project-wide cursor
  const base = WORKFLOWS_BASE_URL.replace(/\/$/, '');
  const url = `${base}/events/cursors`;
  const authz = await getWorkflowsIdTokenHeaders();
  const headers = {
    Accept: 'application/json',
    ...contextHeaders(),
    ...authz,
  };
  try {
    console.log('[producer] fetching project cursor', { projectId: X_PROJECT_ID });
    const resp = await axios.get(url, {
      headers,
      params: { projectId: X_PROJECT_ID, target: 'project' },
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    const data = resp?.data || {};
    const cursor = data.cursor || data;
    const normalized = cursor && (cursor.eventId || cursor.since_id || cursor.timestamp || cursor.since_time)
      ? {
          eventId: cursor.eventId || cursor.since_id || undefined,
          timestamp: cursor.timestamp || cursor.since_time || undefined,
        }
      : null;
    console.log('[producer] fetched project cursor', { status: resp.status, projectId: X_PROJECT_ID, eventId: normalized?.eventId, timestamp: normalized?.timestamp });
    return normalized;
  } catch (err) {
    console.warn('[producer] could not fetch project cursor; starting from env/defaults', err?.message || err);
  }
  return null;
}
