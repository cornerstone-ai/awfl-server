import axios from 'axios';
import { createParser } from 'eventsource-parser';
import { ensureWorkRoot } from './storage.js';
import { getDownscopedToken, renderPrefixTemplate as renderGcsPrefixTemplate } from './gcs-downscope.js';

// Config and helpers
import {
  WORKFLOWS_BASE_URL,
  GCS_TOKEN_ENV,
  GCS_BUCKET,
  GCS_PREFIX_TEMPLATE,
  GCS_DEBUG,
  X_USER_ID,
  X_PROJECT_ID,
  X_WORKSPACE_ID,
  X_SESSION_ID,
  SINCE_ID,
  SINCE_TIME,
  CONSUMER_ID,
  EVENTS_HEARTBEAT_MS,
  RECONNECT_BACKOFF_MS,
  IDLE_SHUTDOWN_MS,
  consumerHeaders,
  contextHeaders,
} from './config.js';

import { getWorkflowsIdTokenHeaders } from './auth.js';
import { postCallback } from './callbacks.js';
import { getProjectCursor, postCursor } from './cursors.js';
import { createPersistentConsumerClient } from './consumer.js';
import { gracefulShutdown, registerShutdownHook } from './shutdown.js';
import { startProjectLockClient } from './lock.js';

if (!WORKFLOWS_BASE_URL) {
  console.error('[producer] WORKFLOWS_BASE_URL is required');
  process.exit(2);
}
if (!process.env.CONSUMER_BASE_URL) {
  console.error('[producer] CONSUMER_BASE_URL is required');
  process.exit(2);
}
if (!X_USER_ID || !X_PROJECT_ID) {
  console.error('[producer] X_USER_ID and X_PROJECT_ID are required');
  process.exit(2);
}

function parseToolArgs(maybe) {
  if (maybe == null) return {};
  if (typeof maybe === 'string') {
    try { const p = JSON.parse(maybe); return typeof p === 'object' ? p : { raw: maybe }; } catch { return { raw: maybe }; }
  }
  if (typeof maybe === 'object') return maybe;
  return { value: maybe };
}

async function run() {
  console.log('[producer] starting with context', { X_USER_ID, X_PROJECT_ID, X_WORKSPACE_ID, X_SESSION_ID, SINCE_ID, SINCE_TIME, CONSUMER_ID });
  console.log('[producer] configuration', { CONSUMER_BASE_URL: process.env.CONSUMER_BASE_URL, EVENTS_HEARTBEAT_MS, RECONNECT_BACKOFF_MS, IDLE_SHUTDOWN_MS });

  // Ensure project-scoped work root exists (for mounted storage); non-fatal if it fails
  try {
    const workRoot = await ensureWorkRoot({ userId: X_USER_ID, projectId: X_PROJECT_ID, workspaceId: X_WORKSPACE_ID, sessionId: X_SESSION_ID });
    console.log('[producer] work root ready at', workRoot);
  } catch (err) {
    console.warn('[producer] work root not available (continuing without persistence):', err?.message || err);
  }

  // Compute downscoped GCS token (mint if not provided via env)
  let gcsTokenToUse = GCS_TOKEN_ENV;
  let gcsPrefix = '';
  if (!gcsTokenToUse && GCS_BUCKET) {
    try {
      gcsPrefix = renderGcsPrefixTemplate(GCS_PREFIX_TEMPLATE, { userId: X_USER_ID, projectId: X_PROJECT_ID, workspaceId: X_WORKSPACE_ID, sessionId: X_SESSION_ID });
      const token = await getDownscopedToken({ bucket: GCS_BUCKET, prefix: gcsPrefix });
      gcsTokenToUse = token;
      console.log('[producer] minted downscoped GCS token', { bucket: GCS_BUCKET, prefix: gcsPrefix });
    } catch (err) {
      console.warn('[producer] failed to mint downscoped GCS token; continuing without header', err?.message || err);
      if (GCS_DEBUG) console.warn('[producer] gcs mint debug', { stack: err?.stack, details: err?.details });
    }
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

  // Create persistent consumer client
  const headers = consumerHeaders({ gcsToken: gcsTokenToUse });
  const consumer = createPersistentConsumerClient(headers);
  registerShutdownHook(() => consumer.close());

  // Start consumer lock client (acquire + refresh loop)
  const lockClient = startProjectLockClient({ onConflict: () => gracefulShutdown(0, 'lock_conflict') });
  registerShutdownHook(() => lockClient.stop());

  // Idle shutdown timer
  let idleTimer = null;
  function resetIdleTimer(reason = 'event') {
    try { if (idleTimer) clearTimeout(idleTimer); } catch {}
    if (!Number.isFinite(IDLE_SHUTDOWN_MS) || IDLE_SHUTDOWN_MS <= 0) return;
    idleTimer = setTimeout(() => {
      console.log('[producer] idle timeout reached, shutting down', { idleMs: IDLE_SHUTDOWN_MS });
      gracefulShutdown(0, 'idle_timeout');
    }, IDLE_SHUTDOWN_MS);
    console.log('[producer] idle timer reset', { reason, idleMs: IDLE_SHUTDOWN_MS });
  }
  registerShutdownHook(() => { try { if (idleTimer) clearTimeout(idleTimer); } catch {}; idleTimer = null; });
  resetIdleTimer('start');

  // Event stream connection
  let eventsAbortController = null;
  async function connectEvents() {
    const params = new URLSearchParams();
    // Always include projectId; optionally narrow by workspace
    params.set('projectId', X_PROJECT_ID);
    if (X_WORKSPACE_ID) params.set('workspaceId', X_WORKSPACE_ID);

    if (lastEventId || initialSinceId) params.set('since_id', lastEventId || initialSinceId);
    else if (initialSinceTime) params.set('since_time', initialSinceTime);

    const url = `${WORKFLOWS_BASE_URL.replace(/\/$/, '')}/events/stream?${params.toString()}`;
    const authz = await getWorkflowsIdTokenHeaders();

    console.log('[producer] connecting to', url);

    const parser = createParser((event) => {
      if (event.type === 'event' || event.type === 'message') {
        if (event.id) lastEventId = event.id;
        if (!event.data) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        // Minimal visibility into events being forwarded
        const toolName = data?.tool_call?.function?.name;
        const evMeta = { id: data?.id || event.id, tool: toolName, create_time: data?.create_time || data?.time, workspaceId: X_WORKSPACE_ID };
        console.log('[producer] event received', evMeta);
        resetIdleTimer('event');
        handleEvent(data).catch((err) => {
          console.warn('[producer] handleEvent error', err?.message || err);
        });
      }
    });

    eventsAbortController = new AbortController();
    try {
      const response = await axios.get(url, {
        headers: {
          Accept: 'text/event-stream',
          ...authz,
          ...contextHeaders(),
        },
        responseType: 'stream',
        timeout: 0,
        signal: eventsAbortController.signal,
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
      setTimeout(connectEvents, delay);
      reconnectDelay = Math.min(reconnectDelay * 2, reconnectCap);
    }
  }
  registerShutdownHook(() => { try { eventsAbortController?.abort(); } catch {}; eventsAbortController = null; });

  async function handleEvent(evt) {
    const tool = evt?.tool_call?.function?.name;
    if (!tool) return; // ignore
    const args = parseToolArgs(evt?.tool_call?.function?.arguments);

    // Prepare a minimal event to send to consumer
    const forwardEvt = { ...evt, tool_call: { function: { name: tool, arguments: args } } };

    console.log('[producer] -> consumer send', { id: evt.id, tool, hasCallback: !!evt?.callback_id });

    let payload = null;
    try {
      payload = await consumer.send(forwardEvt, { timeoutMs: Math.max(15000, EVENTS_HEARTBEAT_MS * 2) });
      console.log('[producer] <- consumer result', { id: evt.id, ok: true, hasResult: payload != null });
    } catch (err) {
      console.warn('[producer] consumer send failed', { id: evt.id, error: err?.message || err });
    }

    // Derive tool result only; ignore metadata and errors per policy
    let toolResult = null;
    if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')) {
      toolResult = payload.result;
    } else if (payload !== undefined) {
      toolResult = payload; // in case consumer already returns raw result
    }

    // Post callback if requested, passing only the tool result (with compatibility fallback)
    if (evt?.callback_id) {
      try {
        await postCallback(evt.callback_id, toolResult);
        console.log('[producer] callback posted', { id: evt.id, callbackId: evt.callback_id });
      } catch (err) {
        console.warn('[producer] callback post failed', { id: evt.id, callbackId: evt.callback_id, error: err?.message || err });
      }
    }

    // Update project-wide cursor AFTER consumer response and callback attempt
    const cursorTs = evt.create_time || evt.time || Date.now();
    await postCursor({ eventId: evt.id || lastEventId || '', timestamp: cursorTs });
  }

  await connectEvents();
}

run().catch((err) => {
  console.error('[producer] fatal', err);
  gracefulShutdown(1, 'fatal');
});
