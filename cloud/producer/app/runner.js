import axios from 'axios';
import { createParser } from 'eventsource-parser';
import { GoogleAuth } from 'google-auth-library';
import { ensureWorkRoot } from './storage.js';

// Env config
const WORKFLOWS_BASE_URL = process.env.WORKFLOWS_BASE_URL || '';
const WORKFLOWS_AUDIENCE = process.env.WORKFLOWS_AUDIENCE || WORKFLOWS_BASE_URL;
const CONSUMER_BASE_URL = process.env.CONSUMER_BASE_URL || '';
const SERVICE_AUTH_TOKEN = process.env.SERVICE_AUTH_TOKEN || '';

// Context
const X_USER_ID = process.env.X_USER_ID || process.env.USER_ID || '';
const X_PROJECT_ID = process.env.X_PROJECT_ID || process.env.PROJECT_ID || '';
const X_WORKSPACE_ID = process.env.X_WORKSPACE_ID || process.env.WORKSPACE_ID || '';
const X_SESSION_ID = process.env.X_SESSION_ID || process.env.SESSION_ID || '';
const SINCE_ID = process.env.SINCE_ID || '';
const SINCE_TIME = process.env.SINCE_TIME || '';
const CONSUMER_ID = process.env.CONSUMER_ID || '';

const EVENTS_HEARTBEAT_MS = Number(process.env.EVENTS_HEARTBEAT_MS || 15000);
const RECONNECT_BACKOFF_MS = Number(process.env.RECONNECT_BACKOFF_MS || 1000);

if (!WORKFLOWS_BASE_URL) {
  console.error('[producer] WORKFLOWS_BASE_URL is required');
  process.exit(2);
}
if (!CONSUMER_BASE_URL) {
  console.error('[producer] CONSUMER_BASE_URL is required');
  process.exit(2);
}
if (!X_USER_ID || !X_PROJECT_ID) {
  console.error('[producer] X_USER_ID and X_PROJECT_ID are required');
  process.exit(2);
}

const auth = new GoogleAuth();
async function getWorkflowsIdTokenHeaders(aud) {
  const audience = aud || WORKFLOWS_AUDIENCE || WORKFLOWS_BASE_URL;
  try {
    const client = await auth.getIdTokenClient(audience);
    const headers = await client.getRequestHeaders(audience);
    return headers; // Authorization Bearer token
  } catch {
    return {};
  }
}

function consumerHeaders() {
  const h = {
    'Content-Type': 'application/x-ndjson',
    'X-User-Id': X_USER_ID,
    'X-Project-Id': X_PROJECT_ID,
  };
  if (X_WORKSPACE_ID) h['X-Workspace-Id'] = X_WORKSPACE_ID;
  if (X_SESSION_ID) h['X-Session-Id'] = X_SESSION_ID;
  if (SERVICE_AUTH_TOKEN) h['Authorization'] = `Bearer ${SERVICE_AUTH_TOKEN}`;
  return h;
}

function contextHeaders() {
  const h = {
    'X-User-Id': X_USER_ID,
    'X-Project-Id': X_PROJECT_ID,
  };
  if (X_WORKSPACE_ID) h['X-Workspace-Id'] = X_WORKSPACE_ID;
  return h;
}

async function postCallback(callbackId, payload) {
  const url = `${WORKFLOWS_BASE_URL.replace(/\/$/, '')}/callbacks/${encodeURIComponent(callbackId)}`;
  const authz = await getWorkflowsIdTokenHeaders();
  const headers = {
    'Content-Type': 'application/json',
    ...contextHeaders(),
    ...authz,
  };

  const maxAttempts = 3;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      await axios.post(url, payload, { headers, timeout: 20000 });
      return;
    } catch (err) {
      const backoff = 300 * attempt + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, backoff));
      if (attempt >= maxAttempts) throw err;
    }
  }
}

async function postCursor({ eventId, timestamp }) {
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
      await axios.post(url, body, { headers, timeout: 15000 });
      return;
    } catch (err) {
      const backoff = 250 * attempt + Math.floor(Math.random() * 150);
      await new Promise((r) => setTimeout(r, backoff));
      if (attempt >= maxAttempts) {
        console.warn('[producer] failed to update project cursor after retries', err?.message || err);
        return;
      }
    }
  }
}

async function getProjectCursor() {
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
    const resp = await axios.get(url, {
      headers,
      params: { projectId: X_PROJECT_ID, target: 'project' },
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    const data = resp?.data || {};
    const cursor = data.cursor || data;
    if (cursor && (cursor.eventId || cursor.since_id || cursor.timestamp || cursor.since_time)) {
      return {
        eventId: cursor.eventId || cursor.since_id || undefined,
        timestamp: cursor.timestamp || cursor.since_time || undefined,
      };
    }
  } catch (err) {
    console.warn('[producer] could not fetch project cursor; starting from env/defaults', err?.message || err);
  }
  return null;
}

function parseToolArgs(maybe) {
  if (maybe == null) return {};
  if (typeof maybe === 'string') {
    try { const p = JSON.parse(maybe); return typeof p === 'object' ? p : { raw: maybe }; } catch { return { raw: maybe }; }
  }
  if (typeof maybe === 'object') return maybe;
  return { value: maybe };
}

async function processEventViaConsumer(evt) {
  const url = `${CONSUMER_BASE_URL.replace(/\/$/, '')}/sessions/stream`;

  const line = JSON.stringify(evt);
  const headers = consumerHeaders();

  // Use Node http/https via axios request with stream request body
  // We'll send a single line and end; then read the response lines
  const resp = await axios.post(url, line + '\n', {
    headers,
    responseType: 'stream',
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  // Parse NDJSON response; pick the last object that contains result/error
  return new Promise((resolve, reject) => {
    let lastPayload = null;
    let error = null;
    resp.data.setEncoding('utf8');
    let buf = '';
    resp.data.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && (Object.prototype.hasOwnProperty.call(obj, 'result') || Object.prototype.hasOwnProperty.call(obj, 'error'))) {
            lastPayload = obj;
          }
          if (obj && obj.type === 'error') {
            error = new Error(obj.message || 'consumer_error');
          }
        } catch (_) {
          // ignore
        }
      }
    });
    resp.data.on('end', () => {
      if (error) return reject(error);
      resolve(lastPayload);
    });
    resp.data.on('error', (e) => reject(e));
  });
}

async function run() {
  console.log('[producer] starting with context', { X_USER_ID, X_PROJECT_ID, X_WORKSPACE_ID, X_SESSION_ID, SINCE_ID, SINCE_TIME, CONSUMER_ID });

  // Ensure project-scoped work root exists (for mounted storage); non-fatal if it fails
  try {
    const workRoot = await ensureWorkRoot({ userId: X_USER_ID, projectId: X_PROJECT_ID, workspaceId: X_WORKSPACE_ID, sessionId: X_SESSION_ID });
    console.log('[producer] work root ready at', workRoot);
  } catch (err) {
    console.warn('[producer] work root not available (continuing without persistence):', err?.message || err);
  }

  // Fetch persisted project-wide cursor (best effort)
  let initialSinceId = SINCE_ID || undefined;
  let initialSinceTime = SINCE_TIME || undefined;
  try {
    const cursor = await getProjectCursor();
    if (cursor?.eventId) initialSinceId = cursor.eventId;
    else if (cursor?.timestamp) initialSinceTime = cursor.timestamp;
    if (initialSinceId || initialSinceTime) {
      console.log('[producer] starting from persisted cursor', { initialSinceId, initialSinceTime });
    }
  } catch (_) {
    // ignore; will fall back to env/defaults
  }

  let lastEventId = undefined;
  let reconnectDelay = RECONNECT_BACKOFF_MS;
  const reconnectCap = 30000;

  async function connect() {
    const params = new URLSearchParams();
    // Always include projectId; optionally narrow by workspace
    params.set('projectId', X_PROJECT_ID);
    if (X_WORKSPACE_ID) params.set('workspaceId', X_WORKSPACE_ID);

    if (lastEventId || initialSinceId) params.set('since_id', lastEventId || initialSinceId);
    else if (initialSinceTime) params.set('since_time', initialSinceTime);

    const url = `${WORKFLOWS_BASE_URL.replace(/\/$/, '')}/events/stream?${params.toString()}`;
    const authz = await getWorkflowsIdTokenHeaders();

    console.log('[producer] connecting to', url);

    let cancelSource = axios.CancelToken.source();

    const parser = createParser((event) => {
      if (event.type === 'event' || event.type === 'message') {
        if (event.id) lastEventId = event.id;
        if (!event.data) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        handleEvent(data).catch((err) => {
          console.warn('[producer] handleEvent error', err?.message || err);
        });
      }
    });

    try {
      const response = await axios.get(url, {
        headers: {
          Accept: 'text/event-stream',
          ...authz,
          ...contextHeaders(),
        },
        responseType: 'stream',
        timeout: 0,
        cancelToken: cancelSource.token,
      });

      response.data.on('data', (chunk) => parser.feed(chunk.toString()));
      response.data.on('end', () => scheduleReconnect('end'));
      response.data.on('error', (e) => scheduleReconnect(e?.message || 'error'));
    } catch (err) {
      scheduleReconnect(err?.message || 'connect_error');
    }

    function scheduleReconnect(reason) {
      const jitter = Math.floor(Math.random() * 250);
      const delay = Math.min(reconnectDelay + jitter, reconnectCap);
      console.log('[producer] reconnect in', delay, 'ms due to', reason);
      setTimeout(connect, delay);
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectCap);
    }
  }

  async function handleEvent(evt) {
    const tool = evt?.tool_call?.function?.name;
    if (!tool) return; // ignore
    const args = parseToolArgs(evt?.tool_call?.function?.arguments);

    // Prepare a minimal event to send to consumer
    const forwardEvt = { ...evt, tool_call: { function: { name: tool, arguments: args } } };

    let payload = null;
    try {
      payload = await processEventViaConsumer(forwardEvt);
    } catch (_) {
      // ignore; payload stays null
    }

    // Derive tool result only; ignore metadata and errors per policy
    let toolResult = null;
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')) {
      toolResult = payload.result;
    } else if (payload !== undefined) {
      toolResult = payload; // in case consumer already returns raw result
    }

    // Post callback if requested, passing only the tool result
    if (evt?.callback_id) {
      try {
        await postCallback(evt.callback_id, toolResult);
      } catch (err) {
        console.warn('[producer] callback post failed', err?.message || err);
      }
    }

    // Update project-wide cursor
    const cursorTs = evt.create_time || evt.time || Date.now();
    await postCursor({ eventId: evt.id || lastEventId || '', timestamp: cursorTs });
  }

  await connect();
}

run().catch((err) => {
  console.error('[producer] fatal', err);
  process.exit(1);
});
